/* eslint-disable require-jsdoc */
import logger from "../../../util/logger.js";
import {dispatchTask} from "../../../util/dispatch.js";
import {catalogueGetRtdb} from "../../../storage/realtimeDb/catalogue.js";
import {getGraphFirestore} from "../../../storage/firestore/graph.js";
import GraphPipelineFactory from "../../GraphPipelineFactory.js";
import {findNextChapterOverDuration} from "../../../util/graphHelper.js";

/**
 * Handles chapter progress changes and triggers graph generation for the next chapter
 * @param {Object} params - Parameters from the chapter change event
 * @param {string} params.uid - User ID
 * @param {string} params.sku - Book SKU
 * @param {number} params.currentChapter - Current chapter index (0-based)
 * @param {number} params.previousChapter - Previous chapter index (0-based)
 * @param {number} params.currentTime - Optional current playback time
 * @param {Function} params.catalogueGetFn - Optional function to get catalogue item (for testing)
 * @param {Function} params.getGraphFn - Optional function to get graph (for testing)
 * @param {Function} params.dispatchFn - Optional function to dispatch task (for testing)
 * @return {Promise<void>}
 */
export async function handleChapterProgress({
  uid,
  sku,
  currentChapter,
  previousChapter,
  currentTime,
  catalogueGetFn = catalogueGetRtdb,
  getGraphFn = getGraphFirestore,
  dispatchFn = dispatchTask,
}) {
  // Skip if no chapter change and not a progress update with currentTime > 0
  if (!currentTime && (previousChapter === null || currentChapter === previousChapter)) {
    logger.info(`SKIPPED: handleChapterProgress for uid: ${uid} sku: ${sku} - no change or initial load`);
    return;
  }

  const catalogueItem = await catalogueGetFn({sku});
  if (!catalogueItem?.defaultGraphId) {
    logger.info(`SKIPPED: handleChapterProgress for uid: ${uid} sku: ${sku} - no default graph ID`);
    return;
  }

  logger.info(`CHAPTER CHANGE: uid: ${uid} sku: ${sku}, from chapter ${previousChapter} to ${currentChapter}`);

  try {
    // Get the graph for this SKU and the next chapter
    const graph = await getGraphFn({graphId: catalogueItem.defaultGraphId});

    if (!graph) {
      logger.warn(`No graph found for SKU ${sku}, skipping chapter progress handling`);
      return;
    }

    const graphId = graph.id;
    const nextChapter = currentChapter + 1;

    // Skip if there is no next chapter
    if (graph.numChapters && nextChapter >= graph.numChapters) {
      logger.info(`${graphId} No next chapter to process. Current: ${currentChapter}, Total: ${graph.numChapters}`);
      return;
    }

    // Skip if the graph is currently processing any chapter
    if (graph.processingChapters && graph.processingChapters.length > 0) {
      logger.info(`${graphId} Graph is currently processing chapters [${graph.processingChapters.join(", ")}], skipping`);
      return;
    }

    // Find the first uncompleted chapter starting from 0
    const completedChapters = graph.completedChapters || [];
    let startChapter = null;

    for (let ch = 0; ch <= nextChapter; ch++) {
      if (!completedChapters.includes(ch)) {
        startChapter = ch;
        logger.info(`${graphId} Found first uncompleted chapter: ${ch}`);
        break;
      }
    }

    // If all chapters up to nextChapter are completed, nothing to do
    if (startChapter === null) {
      logger.info(`${graphId} All chapters from 0 to ${nextChapter} are already completed`);
      return;
    }

    logger.info(`${graphId} Determined startChapter: ${startChapter} (currentChapter: ${currentChapter}, nextChapter: ${nextChapter}, completedChapters: [${completedChapters.sort((a, b) => a - b).join(", ")}])`);

    // End with the next chapter over 5 minutes (300 seconds)
    const endChapter = findNextChapterOverDuration(catalogueItem, currentChapter, 300);

    logger.info(`${graphId} Triggering graph pipeline for graph ${graphId}, startChapter: ${startChapter}, endChapter: ${endChapter}`);

    // Get the pipeline for this graph to determine the first step
    const pipeline = GraphPipelineFactory.getPipelineForGraph(graph);

    // Dispatch the continue graph pipeline
    // Start from the beginning of the pipeline for the new chapter
    await dispatchFn({
      functionName: "continueGraphPipeline",
      data: {
        graphId,
        stage: pipeline.getFirstStep(), // Start from first step for new chapter
        startChapter,
        endChapter,
      },
      deadline: 60 * 1, // 1 hour deadline
    });

    logger.info(`${graphId} Successfully dispatched graph pipeline for chapters ${startChapter} to ${endChapter}`);
  } catch (error) {
    logger.error(`${sku} Error processing chapter change for sku:`, error);
    throw error;
  }
}
