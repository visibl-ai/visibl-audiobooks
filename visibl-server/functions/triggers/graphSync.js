import {onDocumentUpdated} from "firebase-functions/v2/firestore";
import {updateData} from "../storage/realtimeDb/database.js";
import logger from "../util/logger.js";

/**
 * Firestore trigger that syncs completedChapters and processingChapters
 * from Graph documents to RTDB catalogue graphProgress
 */
export const syncGraphChapterProgressToRTDB = onDocumentUpdated(
    {
      document: "Graphs/{graphId}",
      region: "europe-west1",
      memory: "512MiB",
    },
    async (event) => {
      try {
        const beforeData = event.data.before.data();
        const afterData = event.data.after.data();
        const graphId = event.params.graphId;

        // Check if completedChapters or processingChapters have changed
        const completedChaptersChanged =
        JSON.stringify(beforeData?.completedChapters) !== JSON.stringify(afterData?.completedChapters);
        const processingChaptersChanged =
        JSON.stringify(beforeData?.processingChapters) !== JSON.stringify(afterData?.processingChapters);

        if (!completedChaptersChanged && !processingChaptersChanged) {
        // No relevant changes, skip update
          return null;
        }

        // Get the SKU from the graph document
        const sku = afterData?.sku;
        if (!sku) {
          logger.warn(`Cannot sync chapter progress to RTDB: SKU not found for graph ${graphId}`);
          return null;
        }

        // Prepare RTDB update
        const rtdbUpdate = {};

        if (completedChaptersChanged) {
          // Sort the chapters array before syncing
          const sortedCompletedChapters = (afterData.completedChapters || []).sort((a, b) => a - b);
          rtdbUpdate["graphProgress/completedChapters"] = sortedCompletedChapters;
          logger.info(`Syncing completedChapters to RTDB for SKU ${sku}: ${JSON.stringify(sortedCompletedChapters)}`);
        }

        if (processingChaptersChanged) {
          // Sort the chapters array before syncing
          const sortedProcessingChapters = (afterData.processingChapters || []).sort((a, b) => a - b);
          rtdbUpdate["graphProgress/processingChapters"] = sortedProcessingChapters;
          logger.info(`Syncing processingChapters to RTDB for SKU ${sku}: ${JSON.stringify(sortedProcessingChapters)}`);
        }

        // Update RTDB
        if (Object.keys(rtdbUpdate).length > 0) {
          await updateData({
            ref: `catalogue/${sku}`,
            data: rtdbUpdate,
          });
          logger.info(`Successfully synced chapter progress to RTDB for SKU ${sku}, graph ${graphId}`);
        }

        return null;
      } catch (error) {
        logger.error(`Error syncing graph chapter progress to RTDB: ${error.message}`, error);
        throw error;
      }
    },
);
