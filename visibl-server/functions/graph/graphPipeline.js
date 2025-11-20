/* eslint-disable require-jsdoc */
import {
  queueSetItemsToComplete,
  queueSetItemsToError,
  queueClaimPendingItems,
  queueUpdateEntries,
} from "../storage/firestore/queue.js";

import {
  dispatchTask,
} from "../util/dispatch.js";

import logger from "../util/logger.js";

import GraphPipelineFactory from "./GraphPipelineFactory.js";
import {
  getGraphFirestore,
} from "../storage/firestore/graph.js";
import {ENVIRONMENT} from "../config/config.js";
import {
  GRAPH_PIPELINE_RETRY_LIMIT,
  GRAPH_PIPELINE_RETRY_INITIAL_DELAY,
  GRAPH_PIPELINE_RETRY_MAX_DELAY,
  GRAPH_PIPELINE_RETRY_BACKOFF_MULTIPLIER,
} from "./config.js";
import {
  calculateExponentialBackoff,
} from "../util/graphHelper.js";
import {getInstance as getAnalytics} from "../analytics/bookPipelineAnalytics.js";

/**
 * Generate a new graph using the appropriate pipeline version
 * @param {Object} params - Parameters for creating a new graph
 * @return {Promise<Object>} The created graph object
 */
async function generateNewGraph(params) {
  const pipeline = GraphPipelineFactory.getPipeline(params.version);
  return await pipeline.generateNewGraph(params);
}

/**
 * Continue processing a graph pipeline from a specific stage
 * @param {Object} params - Parameters including graphId and optional stage, startChapter, endChapter
 * @return {Promise<void>}
 */
async function continueGraphPipeline({graphId, stage, startChapter, endChapter}) {
  const graphItem = await getGraphFirestore({graphId});
  if (!graphItem || Object.keys(graphItem).length === 0) {
    throw new Error("Graph does not exist");
  }

  const pipeline = GraphPipelineFactory.getPipelineForGraph(graphItem);
  return await pipeline.continueGraphPipeline({graphId, stage, startChapter, endChapter});
}

/**
 * Process items from the graph queue
 * @return {Promise<void>}
 */
async function graphQueue() {
  // Atomically claim pending items from queue to prevent race conditions
  let queue = [];
  try {
    queue = await queueClaimPendingItems({
      type: "graph",
      status: "pending",
      limit: 1,
    });
  } catch (error) {
    logger.warn(`graphQueue: Error claiming items from queue: ${error.message}. Redispatching...`);
    await dispatchTask({functionName: "graphPipeline", data: {}});
    return;
  }

  if (queue.length === 0) {
    logger.debug("graphQueue: No items in the queue");
    return;
  }

  logger.info(`graphQueue: Successfully claimed ${queue.length} item(s) for processing`);
  const graphItem = queue[0].params;

  // Validate graphItem exists
  if (!graphItem) {
    const errorMessage = `Invalid queue item: missing params for queue id ${queue[0].id}`;
    logger.error(`graphQueue: ${errorMessage}`);
    await queueSetItemsToError({queue, error: errorMessage});
    await dispatchTask({functionName: "graphPipeline", data: {}});
    return;
  }

  if (queue[0].retryCount !== undefined) {
    graphItem.retryCount = queue[0].retryCount;
  }

  logger.debug(`graphQueue: Processing ${queue[0].id} (retryCount: ${graphItem.retryCount || 0})`);

  // Get the appropriate pipeline for this graph
  const pipeline = GraphPipelineFactory.getPipelineForGraph(graphItem);

  // Process the items
  // Allow override for testing retries in development
  const forceRetryHandling = graphItem.forceRetryHandling === true;

  let delayMs = 0;

  if (ENVIRONMENT.value() === "development" && !forceRetryHandling) {
    logger.debug(`graphQueue: Running in Development - No Try/Catch`);
    await pipeline.executePipelineStep(queue[0].entryType, graphItem);
    // Set the items to complete
    await queueSetItemsToComplete({queue});
  } else {
    try {
      await pipeline.executePipelineStep(queue[0].entryType, graphItem);
      // Set the items to complete
      await queueSetItemsToComplete({queue});
    } catch (error) {
      const retryCount = graphItem.retryCount || 0;
      const maxRetries = GRAPH_PIPELINE_RETRY_LIMIT;

      // Track pipeline failure
      const analytics = getAnalytics();
      try {
        await analytics.trackPipelineFailure({
          uid: graphItem.uid,
          sku: graphItem.sku,
          graphId: graphItem.id,
          stage: queue[0].entryType,
          error,
          metadata: {
            retryCount,
            maxRetries,
            isFinal: retryCount >= maxRetries,
            chapter: graphItem.chapter,
          },
        });
      } catch (analyticsError) {
        logger.warn(`Failed to track graph pipeline failure: ${analyticsError.message}`);
      }

      if (retryCount < maxRetries) {
        // Calculate exponential backoff delay
        delayMs = calculateExponentialBackoff({
          retryCount,
          initialDelay: GRAPH_PIPELINE_RETRY_INITIAL_DELAY,
          maxDelay: GRAPH_PIPELINE_RETRY_MAX_DELAY,
          multiplier: GRAPH_PIPELINE_RETRY_BACKOFF_MULTIPLIER,
        });

        logger.warn(`graphQueue: Error processing ${queue[0].id} (attempt ${retryCount + 1}/${maxRetries}). ` +
                    `Will retry in ${delayMs}ms: ${error?.message || (typeof error === "string" ? error : JSON.stringify(error)) || "Unknown error"}`);

        // Update the queue entry to pending after the delay
        await new Promise((resolve) => setTimeout(resolve, delayMs));

        const newRetryCount = retryCount + 1;
        await queueUpdateEntries({
          ids: [queue[0].id],
          statuses: ["pending"],
          retryCounts: [newRetryCount],
        });

        logger.debug(`graphQueue: Updated queue entry ${queue[0].id} to pending with retry count ${newRetryCount}`);
      } else {
        // Only mark as error when retries are exhausted
        await queueSetItemsToError({queue});
        logger.critical(`graphQueue: Terminal error processing ${queue[0].id} after ${maxRetries} retries: ` +
                       `${error?.message || (typeof error === "string" ? error : JSON.stringify(error)) || "Unknown error"}`);
      }
    }
  }

  logger.debug(`graphQueue: Completed run for queue item ${queue[0].id}`);
  // Relaunch the queue via dispatch
  await dispatchTask({functionName: "graphPipeline", data: {}});
}

/**
 * Initialize graph generation for a catalogue item
 * @param {Object} params - Parameters including sku, uid, and replace flag
 * @return {Promise<void>}
 */
async function initGraphGeneration({sku, uid, replace = false, version = "v0.1"}) {
  const pipeline = GraphPipelineFactory.getPipeline(version);
  return await pipeline.initGraphGeneration({sku, uid, replace});
}

export {
  generateNewGraph,
  graphQueue,
  continueGraphPipeline,
  initGraphGeneration,
};
