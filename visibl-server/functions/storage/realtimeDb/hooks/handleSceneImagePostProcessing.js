/* eslint-disable require-jsdoc */
import logger from "../../../util/logger.js";
import {getJsonFile} from "../../storage.js";
import {updateSceneImageUrl} from "../scenesCache.js";

/**
 * Handle post-processing for scene images
 * Updates the RTDB with the generated image URL
 * @param {Object} entry - The queue entry
 * @param {Object} resultObj - The result object containing the image URL
 * @return {Promise<void>}
 */
export default async function handleSceneImagePostProcessing(entry, resultObj) {
  try {
    // Debug logging to understand the result structure
    logger.debug(`Scene image result for ${entry.id}: ${JSON.stringify(resultObj)}`);

    // Check if the result is stored in GCS
    let actualResult = resultObj.result;
    if (actualResult?.resultGcsPath) {
      logger.debug(`Retrieving scene image result from GCS: ${actualResult.resultGcsPath}`);
      actualResult = await getJsonFile({filename: actualResult.resultGcsPath});
    }

    // Extract both URLs from the new format
    const cdnUrl = actualResult?.cdnUrl;
    const gcpUrl = actualResult?.gcpUrl;

    if (cdnUrl && gcpUrl) {
      const {defaultSceneId, styleId, styleTitle, chapter, sceneNumber} = entry.params;
      logger.debug(`Updating RTDB for scene image: defaultSceneId=${defaultSceneId}, chapter=${chapter}, sceneNumber=${sceneNumber}, cdnUrl=${cdnUrl}, gcpUrl=${gcpUrl}`);

      // Update the scene in RTDB with both URLs
      await updateSceneImageUrl({
        defaultSceneId,
        styleId,
        styleTitle,
        chapter,
        sceneNumber,
        imageUrl: cdnUrl,
        imageGcpUrl: gcpUrl,
      });
    } else {
      logger.warn(`Missing CDN or GCP URL in result for scene image entry ${entry.id}. Result: ${JSON.stringify(actualResult)}`);
    }
  } catch (error) {
    logger.error(`Failed to update scene image in RTDB: ${error.message}`);
    // Don't throw - we don't want to break the queue processing
  }
}
