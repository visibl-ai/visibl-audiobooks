import logger from "../../util/logger.js";
import {updateData} from "./database.js";
import {catalogueGetRtdb} from "./catalogue.js";
import {getGraphFirestore} from "../firestore/graph.js";
import {
  transcriptionSteps,
  transcriptionStatusMessages,
  pipelineStepsV01,
  graphStatusMessages,
} from "../../graph/config.js";


/**
 * CatalogueProgressTracker is a class that tracks the progress of a catalogue item's graph generation.
 * @param {string} sku - The SKU of the catalogue item.
 * @return {CatalogueProgressTracker} A new instance of CatalogueProgressTracker.
 */
class CatalogueProgressTracker {
  /**
   * Create a new CatalogueProgressTracker instance
   * @param {string} sku - The SKU of the catalogue item to track
   * @throws {Error} If SKU is not provided
   */
  constructor(sku) {
    if (!sku) {
      throw new Error("SKU is required to instantiate CatalogueProgressTracker");
    }
    this.sku = sku;
    this.catalogueItem = null;
    this.graphItem = null;
    this.graphId = null;

    // Weights for overall progress calculation
    this.TRANSCRIPTION_WEIGHT = 20;
    this.GRAPH_WEIGHT = 80;
  }

  /**
   * Initialize the tracker by loading catalogue and graph data
   * @return {Promise<CatalogueProgressTracker>} The initialized tracker instance
   */
  async init() {
    this.catalogueItem = await this.getCatalogueItem();
    if (this.catalogueItem?.defaultGraphId) {
      this.graphId = this.catalogueItem.defaultGraphId;
      this.graphItem = await getGraphFirestore({graphId: this.graphId});
    }
    return this;
  }

  /**
   * Get the catalogue item from the database
   * @return {Promise<Object|null>} The catalogue item or null if not found
   */
  async getCatalogueItem() {
    const item = await catalogueGetRtdb({sku: this.sku});
    if (!item) {
      logger.debug(`Catalogue item not found for ${this.sku}`);
      return null;
    }
    return item;
  }

  /**
   * Set the graph ID for this tracker
   * @param {string} graphId - The graph ID to set
   * @return {CatalogueProgressTracker} The tracker instance for chaining
   */
  setGraphId(graphId) {
    this.graphId = graphId;
    return this;
  }

  /**
   * Load the graph item from Firestore
   * @return {Promise<Object|null>} The graph item or null if not found
   */
  async loadGraphItem() {
    if (!this.graphId) {
      return null;
    }
    this.graphItem = await getGraphFirestore({graphId: this.graphId});
    return this.graphItem;
  }

  /**
   * Calculate transcription phase progress
   * @param {string} transcriptionStep - The current transcription step
   * @param {number} stepProgress - Progress within current step (0-100)
   * @return {Object} Object with progress percentage and description
   */
  calculateTranscriptionProgress(transcriptionStep, stepProgress = 0) {
    let progress = 0;
    let description = transcriptionStatusMessages.starting;

    if (transcriptionStep && transcriptionSteps[transcriptionStep]) {
      const steps = Object.entries(transcriptionSteps);
      let completedStepWeight = 0;

      for (const [stepName, stepInfo] of steps) {
        if (stepName === transcriptionStep) {
          completedStepWeight += (stepInfo.weight * stepProgress) / 100;
          description = stepInfo.description;
          break;
        }
        completedStepWeight += stepInfo.weight;
      }

      const totalStepWeight = Object.values(transcriptionSteps).reduce((sum, step) => sum + step.weight, 0);
      progress = Math.round((completedStepWeight / totalStepWeight) * 100);
    }

    return {progress, description};
  }

  /**
   * Calculate progress for graph pipeline steps
   * @param {Object} graphItem - The graph item from database
   * @return {Object} Object with stepProgress, currentStep, and description
   */
  calculateGraphStepProgress(graphItem) {
    const pipelineSteps = pipelineStepsV01;
    const totalWeight = Object.values(pipelineSteps).reduce((sum, step) => sum + step.weight, 0);
    let completedWeight = 0;
    let currentStep = "initializing";

    // Get the current step
    currentStep = graphItem.nextGraphStep || "initializing";

    // For multi-chapter processing, calculate progress based on current step position
    // NOT on the cumulative progress object which includes all chapters
    if (currentStep && currentStep !== "initializing" && currentStep !== "complete") {
      const stepNames = Object.keys(pipelineSteps);
      const currentStepIndex = stepNames.indexOf(currentStep);

      // Add weight of all steps before the current one
      for (let i = 0; i < currentStepIndex; i++) {
        completedWeight += pipelineSteps[stepNames[i]].weight;
      }
    } else if (currentStep === "complete") {
      // If the current step is complete, all steps are done
      completedWeight = totalWeight;
    }

    const stepProgress = Math.round((completedWeight / totalWeight) * 100);

    let description = graphStatusMessages.initializing;
    if (currentStep === "complete") {
      description = graphStatusMessages.complete;
    } else if (currentStep && pipelineSteps[currentStep]) {
      description = pipelineSteps[currentStep].description;
    } else if (currentStep && currentStep !== "initializing") {
      description = {en: currentStep};
    }

    return {stepProgress, currentStep, description};
  }

  /**
   * Calculate chapter-based progress information
   * @param {Object} graphItem - The graph item from database
   * @return {Object|null} Chapter progress info or null if not applicable
   */
  calculateChapterProgress(graphItem) {
    if (graphItem.endChapter === undefined || graphItem.chapter === undefined) {
      return null;
    }

    const totalChapters = graphItem.endChapter + 1;
    const completedChapters = graphItem.completedChapters ? graphItem.completedChapters.length : 0;
    const currentChapter = graphItem.chapter;
    const processingChapters = graphItem.processingChapters || [];

    return {
      totalChapters,
      completedChapters,
      currentChapter,
      processingChapters,
      chaptersProgress: Math.round((completedChapters * 100) / totalChapters),
    };
  }

  /**
   * Calculate overall graph generation progress accounting for chapters
   * @param {Object} graphItem - The graph item from database
   * @return {Object} Object with graphPhaseCompletion, currentStep, description, and chapterInfo
   */
  calculateOverallGraphProgress(graphItem) {
    const {stepProgress, currentStep, description} = this.calculateGraphStepProgress(graphItem);
    const chapterInfo = this.calculateChapterProgress(graphItem);

    let graphPhaseCompletion = stepProgress;

    if (chapterInfo) {
      // Each chapter should represent an equal portion of the graph phase
      // For 4 chapters: each chapter is 25% of the graph phase (100% / 4 = 25%)
      const progressPerChapter = 100 / chapterInfo.totalChapters;

      // Completed chapters contribute their full share
      const completedProgress = chapterInfo.completedChapters * progressPerChapter;

      // Current chapter contributes its partial share based on step progress
      // But stepProgress might be cumulative, so we need to calculate it differently
      // For the current chapter, we need to know which step we're on within THIS chapter
      const currentChapterContribution = (stepProgress / 100) * progressPerChapter;

      // Total graph phase completion
      graphPhaseCompletion = Math.round(completedProgress + currentChapterContribution);
    }

    return {
      graphPhaseCompletion,
      currentStep,
      description,
      chapterInfo,
    };
  }

  /**
   * Update transcription progress in the catalogue
   * @param {string} transcriptionStep - The current transcription step
   * @param {number} stepProgress - Progress within current step (0-100)
   * @return {Promise<Object|null>} The updated graph progress object or null if catalogue item doesn't exist
   */
  async updateTranscriptionProgress(transcriptionStep, stepProgress = 0) {
    // Check if catalogue item exists first
    const catalogueItem = await this.getCatalogueItem();
    if (!catalogueItem) {
      logger.debug(`Catalogue item not found for ${this.sku}, skipping transcription progress update`);
      return null;
    }

    const {progress: transcriptionProgress, description} = this.calculateTranscriptionProgress(
        transcriptionStep,
        stepProgress,
    );

    const overallCompletion = Math.round((transcriptionProgress * this.TRANSCRIPTION_WEIGHT) / 100);

    // Use path-based updates to avoid overwriting the entire graphProgress
    const updatePaths = {
      "graphProgress/inProgress": false,
      "graphProgress/transcriptionInProgress": true,
      "graphProgress/completion": overallCompletion,
      "graphProgress/currentStep": transcriptionStep || "transcription",
      "graphProgress/description": description,
      "graphProgress/status": transcriptionProgress === 100 ? "complete" : "in_progress",
      "graphProgress/transcriptionProgress": transcriptionProgress,
      "graphProgress/lastUpdated": Date.now(),
    };

    await updateData({
      ref: `catalogue/${this.sku}`,
      data: updatePaths,
    });

    logger.debug(`Updated ${this.sku} with transcription progress: ${overallCompletion}%`);
    return null;
  }

  /**
   * Update graph generation progress in the catalogue
   * @param {string} graphId - Optional graph ID to set
   * @return {Promise<Object|null>} The updated graph progress object or null
   */
  async updateGraphProgress(graphId = null) {
    if (graphId) {
      this.graphId = graphId;
    }

    if (!this.graphId) {
      logger.warn(`No graph ID available for ${this.sku}`);
      return null;
    }

    this.catalogueItem = await this.getCatalogueItem();

    // If catalogue item doesn't exist, can't update graph progress
    if (!this.catalogueItem) {
      logger.debug(`Catalogue item not found for ${this.sku}, cannot update graph progress`);
      return null;
    }

    // If graph is already available, return completed status and don't track further
    if (this.catalogueItem.graphAvailable) {
      // Use path-based updates to avoid overwriting completedChapters and processingChapters
      const updatePaths = {
        "graphProgress/inProgress": false,
        "graphProgress/transcriptionInProgress": false,
        "graphProgress/status": "complete",
        "graphProgress/currentStep": "complete",
        "graphProgress/completion": 100,
        "graphProgress/description": graphStatusMessages.complete,
        "graphProgress/graphPhaseCompletion": 100,
        "graphProgress/lastUpdated": Date.now(),
      };

      await updateData({
        ref: `catalogue/${this.sku}`,
        data: updatePaths,
      });

      logger.debug(`Graph already complete for ${this.sku}, returning completed status`);
      return null;
    }

    await this.loadGraphItem();
    if (!this.graphItem) {
      logger.warn(`Graph not found for ID ${this.graphId}`);
      return null;
    }

    const {graphPhaseCompletion, currentStep, description, chapterInfo} =
      this.calculateOverallGraphProgress(this.graphItem);

    let completion = this.TRANSCRIPTION_WEIGHT + Math.round((graphPhaseCompletion * this.GRAPH_WEIGHT) / 100);

    let status = "pending";
    if (currentStep === "complete") {
      status = "complete";
      completion = 100;
    } else if (graphPhaseCompletion > 0) {
      status = "in_progress";
    }

    // Build update object with specific paths to avoid overwriting the entire graphProgress
    // This preserves completedChapters and processingChapters arrays managed by Firestore trigger
    const updatePaths = {
      "graphProgress/inProgress": status !== "complete",
      "graphProgress/transcriptionInProgress": false,
      "graphProgress/status": status,
      "graphProgress/currentStep": currentStep,
      "graphProgress/completion": completion,
      "graphProgress/description": description,
      "graphProgress/graphPhaseCompletion": graphPhaseCompletion,
      "graphProgress/lastUpdated": Date.now(),
    };

    if (chapterInfo) {
      updatePaths["graphProgress/chapterProgress"] = {
        currentChapter: chapterInfo.currentChapter,
        completedChapters: chapterInfo.completedChapters,
        totalChapters: chapterInfo.totalChapters,
        processingChapters: chapterInfo.processingChapters,
        progress: chapterInfo.chaptersProgress,
      };
    }

    await updateData({
      ref: `catalogue/${this.sku}`,
      data: updatePaths,
    });

    logger.debug(`Updated ${this.sku} with graph progress: ${completion}%`);
    return null;
  }

  /**
   * Update progress based on provided options
   * @param {Object} options - Progress update options
   * @param {string} options.transcriptionStep - Transcription step name
   * @param {number} options.stepProgress - Step progress percentage
   * @param {string} options.graphId - Graph ID
   * @return {Promise<Object|null>} The updated progress object
   */
  async updateStepProgress(options) {
    const {transcriptionStep, stepProgress, graphId} = options;

    if (transcriptionStep) {
      return await this.updateTranscriptionProgress(transcriptionStep, stepProgress);
    } else {
      return await this.updateGraphProgress(graphId);
    }
  }

  /**
   * Mark a specific pipeline step as complete
   * @param {string} stepName - Name of the step to mark complete
   * @return {Promise<Object|null>} The updated progress object
   */
  async markStepComplete(stepName) {
    if (!this.graphId) {
      logger.warn(`No graph ID available for ${this.sku}, cannot mark step complete`);
      return null;
    }

    await this.loadGraphItem();
    if (!this.graphItem) {
      logger.warn(`Graph not found for ID ${this.graphId}`);
      return null;
    }

    if (!this.graphItem.progress) {
      this.graphItem.progress = {};
    }

    this.graphItem.progress[stepName] = "complete";

    return await this.updateGraphProgress();
  }

  /**
   * Mark a specific chapter as complete
   * @param {number} chapterNumber - Chapter number to mark complete
   * @return {Promise<Object|null>} The updated progress object
   */
  async markChapterComplete(chapterNumber) {
    if (!this.graphId) {
      logger.warn(`No graph ID available for ${this.sku}, cannot mark chapter complete`);
      return null;
    }

    await this.loadGraphItem();
    if (!this.graphItem) {
      logger.warn(`Graph not found for ID ${this.graphId}`);
      return null;
    }

    if (!this.graphItem.completedChapters) {
      this.graphItem.completedChapters = [];
    }

    if (!this.graphItem.completedChapters.includes(chapterNumber)) {
      this.graphItem.completedChapters.push(chapterNumber);
      logger.info(`Marked chapter ${chapterNumber} as completed for graph ${this.graphId}`);
    }

    return await this.updateGraphProgress();
  }

  /**
   * Get the current progress from the catalogue
   * @return {Promise<Object>} The current graph progress object
   */
  async getProgress() {
    const catalogueItem = await this.getCatalogueItem();
    if (!catalogueItem) {
      return {
        status: "pending",
        currentStep: "initializing",
        completion: 0,
      };
    }
    return catalogueItem.graphProgress || {
      status: "pending",
      currentStep: "initializing",
      completion: 0,
    };
  }

  /**
   * Static helper to update progress for a SKU
   * @param {string} sku - The SKU of the catalogue item
   * @param {Object} options - Progress update options
   * @return {Promise<Object|null>} The updated progress object
   */
  static async updateProgress(sku, options) {
    const tracker = new CatalogueProgressTracker(sku);
    await tracker.init();
    return await tracker.updateStepProgress(options);
  }
}

export default CatalogueProgressTracker;
