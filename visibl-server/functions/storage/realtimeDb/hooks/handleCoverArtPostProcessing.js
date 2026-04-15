/* eslint-disable require-jsdoc */
import logger from "../../../util/logger.js";
import {getJsonFile} from "../../storage.js";
import {catalogueUpdateRtdbProperty} from "../catalogue.js";

/**
 * Handle post-processing for cover art generation
 * Updates the RTDB with the generated cover art URL using existing catalogue functions
 * @param {Object} entry - The queue entry
 * @param {Object} resultObj - The result object containing success/failure status
 * @return {Promise<void>}
 */
export default async function handleCoverArtPostProcessing(entry, resultObj) {
  try {
    // Debug logging to understand the result structure
    logger.debug(`Cover art result for ${entry.id}: ${JSON.stringify(resultObj)}`);

    // Check if the result is stored in GCS
    let actualResult = resultObj.result;
    if (actualResult?.resultGcsPath) {
      logger.debug(`Retrieving cover art result from GCS: ${actualResult.resultGcsPath}`);
      actualResult = await getJsonFile({filename: actualResult.resultGcsPath});
    }

    // Check if cover generation was successful
    if (!actualResult?.cdnUrl) {
      logger.warn(`Cover art generation failed for entry ${entry.id}: ${actualResult?.error || "Unknown error"}`);
      return;
    }

    const {sku} = entry.params;

    if (!sku) {
      logger.error(`Missing SKU in cover art entry ${entry.id}`);
      return;
    }

    logger.info(`Cover art generated successfully for ${sku}, getting CDN URL...`);

    try {
      const coverArtUrl = actualResult.cdnUrl;
      if (coverArtUrl) {
        // Use the existing catalogueUpdateRtdbProperty to update the database
        await catalogueUpdateRtdbProperty({
          sku,
          property: "coverArtUrl",
          value: coverArtUrl,
        });

        logger.info(`Successfully updated cover art URL for ${sku}: ${coverArtUrl}`);
      } else {
        logger.warn(`Failed to get CDN URL for cover art ${sku}`);
      }
    } catch (error) {
      logger.error(`Error processing cover art CDN upload for ${sku}: ${error.message}`);
    }
  } catch (error) {
    logger.error(`Failed to handle cover art post-processing: ${error.message}`);
    // Don't throw - we don't want to break the queue processing
  }
}
