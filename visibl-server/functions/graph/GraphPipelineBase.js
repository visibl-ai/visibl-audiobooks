/* eslint-disable require-jsdoc */
import {
  getGraphFirestore,
  createGraph,
  updateGraphStatus,
  updateGraph,
  graphMarkChapterProcessing,
  normalizeChapter,
} from "../storage/firestore/graph.js";

import {
  queueAddEntries,
  graphQueueToUnique,
  queueDeleteGraphChapterEntries,
} from "../storage/firestore/queue.js";

import {
  catalogueGetRtdb,
  catalogueUpdateRtdbProperty,
} from "../storage/realtimeDb/catalogue.js";
import CatalogueProgressTracker from "../storage/realtimeDb/CatalogueProgressTracker.js";

import {
  aaxGetUsersBySkuFirestore,
} from "../storage/firestore/aax.js";

import {
  getFullTextTokens,
} from "./v0/graphV0logic.js";

import {
  dispatchTask,
} from "../util/dispatch.js";

import logger from "../util/logger.js";

import {
  sendNotifications,
} from "../util/notifications.js";

import {getInstance as getAnalytics} from "../analytics/bookPipelineAnalytics.js";

// Queue-param fields that must never be written back to the Graph doc from a step snapshot
const SNAPSHOT_FIELDS_NOT_WRITTEN_BACK = [
  "processingChapters",
  "completedChapters",
  "failedChapters",
  "retryCount",
  "forceRetryHandling",
];

/**
 * Abstract base class for graph pipeline implementations
 * This class defines the core interfaces and common functionality
 * that all graph pipeline versions must implement
 */
export default class GraphPipelineBase {
  constructor() {
    if (this.constructor === GraphPipelineBase) {
      throw new Error("GraphPipelineBase is an abstract class and cannot be instantiated directly");
    }
  }

  /**
   * Get the version identifier for this pipeline implementation
   * @abstract
   * @return {string} Version identifier (e.g., "v0", "v1")
   */
  getVersion() {
    throw new Error("getVersion() must be implemented by subclass");
  }

  /**
   * Get the pipeline steps configuration for this version
   * @abstract
   * @return {Object} Object containing step names as keys and step identifiers as values
   */
  getPipelineSteps() {
    throw new Error("getPipelineSteps() must be implemented by subclass");
  }

  /**
   * Execute a specific pipeline step
   * @abstract
   * @param {string} entryType - The type of pipeline step to execute
   * @param {Object} graphItem - The graph item being processed
   * @return {Promise<void>}
   */
  async executePipelineStep(entryType, graphItem) {
    throw new Error("executePipelineStep() must be implemented by subclass");
  }

  /**
   * Get the next step in the pipeline after the current one
   * @abstract
   * @param {string} currentStep - The current pipeline step
   * @return {string|null} The next step or null if pipeline is complete
   */
  getNextStep(currentStep) {
    throw new Error("getNextStep() must be implemented by subclass");
  }

  /**
   * Common method to generate a new graph
   * @param {Object} params - Parameters for creating a new graph
   * @return {Promise<Object>} The created graph object
   */
  async generateNewGraph({uid, sku, visibility, numChapters, startStep, startChapter, endChapter, isCatalogueDefault}) {
    const fullTextTokens = await getFullTextTokens({uid, sku, visibility});
    const version = this.getVersion();
    const newGraph = await createGraph({uid, sku, visibility, numChapters, fullTextTokens, version, isCatalogueDefault});
    logger.debug(`generateNewGraph: Created new graph ${newGraph.id} with ${fullTextTokens} tokens, version ${version}`);

    // Track graph generation started
    const analytics = getAnalytics();
    try {
      // Check if a graph already exists to determine generation type
      const catalogueItem = await catalogueGetRtdb({sku});
      const generationType = catalogueItem?.defaultGraphId ? "incremental" : "initial";

      await analytics.trackGraphGenerationStarted({
        uid,
        sku,
        graphId: newGraph.id,
        version,
        generationType,
      });
    } catch (analyticsError) {
      logger.warn(`Failed to track graph generation start: ${analyticsError.message}`);
    }

    // Set the starting chapter if provided
    if (startChapter !== undefined) {
      const chapter = normalizeChapter(startChapter);
      newGraph.chapter = chapter;
      logger.debug(`${newGraph.id} generateNewGraph: Starting at chapter ${chapter}`);

      await graphMarkChapterProcessing({graphId: newGraph.id, chapter});
      newGraph.processingChapters = [...new Set([...(newGraph.processingChapters || []), chapter])];
      logger.info(`${newGraph.id} Marked chapter ${chapter} as processing for new graph ${newGraph.id}`);
    }

    // Set the ending chapter if provided
    if (endChapter !== undefined) {
      newGraph.endChapter = normalizeChapter(endChapter);
      logger.debug(`${newGraph.id} generateNewGraph: Will end at chapter ${endChapter}`);
    }

    // if you want to start at a  specific step, you can pass it in as a parameter
    const firstStep = startStep || this.getFirstStep();
    await this.addItemToQueue({entryType: firstStep, graphItem: newGraph});

    // Initialize the graph progress in the catalogue
    await CatalogueProgressTracker.updateProgress(sku, {graphId: newGraph.id});
    return newGraph;
  }

  /**
   * Get the first step in the pipeline
   * @return {string} The first pipeline step
   */
  getFirstStep() {
    // Default implementation - can be overridden by subclasses
    const steps = this.getPipelineSteps();
    return steps.CHARACTERS || Object.values(steps)[0];
  }

  /**
   * Get every entry type a queue doc of this pipeline may carry, for looking up existing queue
   * docs by their deterministic IDs. Subclasses add steps that were removed from the pipeline.
   * @return {string[]} Queue entry types
   */
  getQueueEntryTypes() {
    return Object.values(this.getPipelineSteps());
  }

  /**
   * Continue processing a graph pipeline from a specific stage
   * @param {Object} params - Parameters including graphId and optional stage, startChapter, endChapter
   * @param {boolean} params.retry - Marks the call as a retry of a failed chapter; only affects
   *   logging. With a startChapter, that chapter's finished (complete/error) graph queue docs are
   *   always deleted first so their deterministic IDs do not block re-queuing, and the call is a
   *   no-op when the chapter already has pending or processing entries.
   * @return {Promise<void>}
   */
  async continueGraphPipeline({graphId, stage, startChapter, endChapter, retry = false}) {
    const graphItem = await getGraphFirestore({graphId});
    if (!graphItem || Object.keys(graphItem).length === 0) {
      throw new Error("Graph does not exist");
    }

    // Retry state belongs to a single queue entry; never carry it over from the Graph doc
    delete graphItem.retryCount;
    delete graphItem.forceRetryHandling;

    let nextStep = graphItem.nextGraphStep;
    if (!nextStep) {
      nextStep = this.getFirstStep();
    }
    if (stage) {
      nextStep = stage;
    }

    // Set the starting chapter if provided
    if (startChapter !== undefined) {
      const chapter = normalizeChapter(startChapter);
      graphItem.chapter = chapter;
      logger.debug(`${graphId} continueGraphPipeline: Starting at chapter ${chapter}`);

      // Queue doc IDs are deterministic per chapter and step, so finished docs from an earlier
      // run would make queueAddEntries skip the new entry. Concurrent progress events can both
      // dispatch this chapter; never delete or duplicate work that is pending or processing.
      const mode = retry ? "retry" : "continue";
      const {deletedIds, activeIds} = await queueDeleteGraphChapterEntries({
        graphId,
        chapter,
        legacyEntryTypes: this.getQueueEntryTypes(),
      });
      if (activeIds.length > 0) {
        logger.info(`${graphId} continueGraphPipeline: ${mode} skipped - chapter ${chapter} already has active queue entries [${activeIds.join(", ")}]`);
        return;
      }
      logger.info(`${graphId} continueGraphPipeline: ${mode} - deleted ${deletedIds.length} finished queue entries for chapter ${chapter}`);

      await graphMarkChapterProcessing({graphId, chapter});
      graphItem.processingChapters = [...new Set([...(graphItem.processingChapters || []).map(normalizeChapter), chapter])];
      logger.info(`${graphId} Marked chapter ${chapter} as processing for graph at pipeline start`);
    }

    // Set the ending chapter if provided
    if (endChapter !== undefined) {
      graphItem.endChapter = normalizeChapter(endChapter);
      logger.debug(`${graphId} continueGraphPipeline: Will end at chapter ${endChapter}`);
    }

    await this.addItemToQueue({entryType: nextStep, graphItem: graphItem});
    await dispatchTask({functionName: "graphPipeline", data: {}});
  }

  /**
   * Add an item to the processing queue
   * @param {Object} params - Queue parameters
   * @param {string} params.entryType - The type of pipeline step to execute
   * @param {Object} params.graphItem - The graph item data
   * @return {Promise<Array<Object>>} The added queue entries
   */
  async addItemToQueue({entryType, graphItem}) {
    // A new queue entry starts with a fresh retry budget; graphQueue copies the entry's
    // retryCount into the params it runs with, so it must not leak into the next step
    const entryParams = {...graphItem};
    delete entryParams.retryCount;
    return await queueAddEntries({
      types: ["graph"],
      entryTypes: [entryType],
      entryParams: [entryParams],
      uniques: [graphQueueToUnique({
        type: "graph",
        entryType: entryType,
        graphId: graphItem.id,
        chapter: graphItem.chapter,
      })],
    });
  }

  /**
   * Update graph status and add next step to queue
   * @param {Object} params - Parameters for updating graph status
   * @return {Promise<void>}
   */
  async updateGraphAndQueueNext({graphItem, currentStep, nextStep, statusValue = "complete"}) {
    // Track stage completion
    const analytics = getAnalytics();
    try {
      // Get current progress before updating
      const catalogueItem = await catalogueGetRtdb({sku: graphItem.sku});
      const progress = catalogueItem?.graphProgress?.completion || 0;

      await analytics.trackGraphPipelineStage({
        uid: graphItem.uid,
        sku: graphItem.sku,
        graphId: graphItem.id,
        stage: currentStep,
        status: "completed",
        progress,
        metadata: {
          chapter: graphItem.chapter,
          nextStep: nextStep || "complete",
        },
      });

      // Track complete graph generation when pipeline is done
      if (nextStep === "complete") {
        // Get catalogue item to determine generation type
        const catalogueItem = await catalogueGetRtdb({sku: graphItem.sku});

        // Determine generation type (initial vs incremental)
        // If this graph is the default graph, it was initial; otherwise incremental
        const generationType = graphItem.id === catalogueItem?.defaultGraphId ? "initial" : "incremental";

        // Track graph generation completed
        await analytics.trackGraphGenerationCompleted({
          uid: graphItem.uid,
          sku: graphItem.sku,
          graphId: graphItem.id,
          generationType,
          metadata: {
            numChapters: graphItem.numChapters,
            version: this.getVersion(),
          },
        });
      }
    } catch (analyticsError) {
      logger.warn(`Failed to track graph stage completion: ${analyticsError.message}`);
    }

    if (nextStep && nextStep !== "complete") {
      logger.debug(`${graphItem.id} ${currentStep} updateGraphAndQueueNext: Adding next step ${nextStep} to queue`);
      const addToQueueResult = await this.addItemToQueue({entryType: nextStep, graphItem});
      if (!addToQueueResult.success) {
        logger.error(`${graphItem.id} ${currentStep} updateGraphAndQueueNext: Failed to add next step ${nextStep} to queue`);
        return;
      }
    }

    // Chapter arrays and failure records are owned by atomic helpers; never write the queue
    // snapshot's copies back, or a concurrent release/completion would be clobbered.
    const graphData = Object.fromEntries(
        Object.entries(updateGraphStatus({
          graphItem,
          statusName: currentStep,
          statusValue,
          nextGraphStep: nextStep,
        })).filter(([key]) => !SNAPSHOT_FIELDS_NOT_WRITTEN_BACK.includes(key)),
    );
    await updateGraph({graphData});

    await CatalogueProgressTracker.updateProgress(graphItem.sku, {graphId: graphItem.id});
  }

  /**
   * Notify users when graph processing is complete
   * @param {Object} params - Parameters including graphItem
   * @return {Promise<void>}
   */
  async notifyUsersOfCompletion({graphItem}) {
    // We want to get any user who has this book in their imported private list
    const uids = await aaxGetUsersBySkuFirestore({sku: graphItem.sku});
    if (!uids || uids.length === 0) {
      logger.warn(`${graphItem.id} No users found for sku: ${graphItem.sku} - How did we get here!`);
      return;
    }

    const catalogueItem = await catalogueGetRtdb({sku: graphItem.sku});
    await sendNotifications({
      uids,
      title: `${catalogueItem.title} import complete!`,
      body: `Open Visibl to start your ${catalogueItem.title} journey!`,
    });
  }

  /**
   * Compose scene images for specific scenes
   * @abstract
   * @param {Object} params - Parameters for scene image composition
   * @param {string} params.graphId - The graph ID
   * @param {string} params.defaultSceneId - The scene ID for RTDB cache access
   * @param {Array<{chapter: number, scene: number}>} params.scenes - Array of scene identifiers, each object containing:
   *   - chapter: The chapter number (e.g., 0, 1, 2)
   *   - scene: The scene number within that chapter (e.g., 1, 2, 3)
   *   Example: [{chapter: 0, scene: 1}, {chapter: 0, scene: 2}, {chapter: 1, scene: 1}]
   * @return {Promise<Object>} Result of scene image composition
   */
  async composeSceneImages({graphId, defaultSceneId, scenes}) {
    throw new Error("composeSceneImages() must be implemented by subclass");
  }

  /**
   * Initialize graph generation for a catalogue item
   * @param {Object} params - Parameters including sku, uid, and replace flag
   * @return {Promise<void>}
   */
  async initGraphGeneration({sku, uid, replace = false}) {
    const catalogueItem = await catalogueGetRtdb({sku});
    if (!catalogueItem) {
      logger.error(`Catalogue item not found for ${sku}. How did we get here?`);
      return;
    }

    if (catalogueItem.defaultGraphId && replace === false) {
      logger.info(`Graph already generated for ${sku}. Skipping.`);
      return;
    }

    if (catalogueItem.fiction === true) {
      logger.info(`initGraphGeneration: Generating new graph for ${sku}.`);
      const defaultGraph = await this.generateNewGraph({
        uid: uid,
        catalogueId: catalogueItem.id,
        sku: sku,
        visibility: catalogueItem.visibility,
        numChapters: catalogueItem.numChapters,
      });

      catalogueItem.defaultGraphId = defaultGraph.id;
      await catalogueUpdateRtdbProperty({sku, property: "defaultGraphId", value: defaultGraph.id});
      // Initialize graphProgress status in catalogue
      await CatalogueProgressTracker.updateProgress(sku, {graphId: defaultGraph.id});

      logger.debug(`Generated new graph for ${sku}. DefaultGraphId: ${defaultGraph.id}. Launching queue.`);
      await dispatchTask({
        functionName: "graphPipeline",
        data: {},
      });
    } else {
      logger.warn(`Non-fiction book ${sku}. Should we be here? Skipping graph generation.`);
    }
  }
}
