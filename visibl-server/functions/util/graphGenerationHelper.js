import logger from "./logger.js";
import {catalogueGetRtdb} from "../storage/realtimeDb/catalogue.js";
import {initGraphGeneration} from "../graph/graphPipeline.js";

/**
 * Check if graph generation should be initiated after first chapter transcription
 * @param {string} uid - User ID
 * @param {string} sku - Book SKU
 * @param {number} chapter - Chapter number that was just transcribed
 * @return {Promise<boolean>} - Whether graph generation was initiated
 */
async function checkAndInitiateGraphGeneration({uid, sku}) {
  try {
    logger.info(`Checking if graph generation is needed for ${sku}.`);

    // Get catalogue item to check if it's fiction and needs graph generation
    const catalogueItem = await catalogueGetRtdb({sku});
    logger.info(`Catalogue item for ${sku}: fiction=${catalogueItem?.fiction}, graphAvailable=${catalogueItem?.graphAvailable}, graphProgress=${JSON.stringify(catalogueItem?.graphProgress)}`);

    if (catalogueItem && catalogueItem.fiction === true && !catalogueItem.graphAvailable && !catalogueItem.graphProgress?.inProgress) {
      logger.info(`Triggering automatic graph generation for fiction book ${sku}`);
      try {
        // Use graphVersion from catalogue if available, otherwise default to v0.1
        const version = catalogueItem.graphVersion || "v0.1";
        await initGraphGeneration({sku, uid, version});
        logger.info(`Successfully initiated graph generation for ${sku} with version ${version}`);
        return true;
      } catch (graphError) {
        logger.error(`Failed to initiate graph generation for ${sku}:`, graphError);
        // Don't throw here - transcription is still successful even if graph generation fails
        return false;
      }
    } else {
      logger.info(`Skipping graph generation for ${sku}. Reasons: fiction=${catalogueItem?.fiction}, hasDefaultGraphId=${!!catalogueItem?.defaultGraphId}, graphInProgress=${catalogueItem?.graphProgress?.inProgress}`);
      return false;
    }
  } catch (error) {
    logger.error(`Error checking graph generation for ${sku}:`, error);
    return false;
  }
}

export {
  checkAndInitiateGraphGeneration,
};
