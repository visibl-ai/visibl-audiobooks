/* eslint-disable require-jsdoc */
import logger from "../../../util/logger.js";
import {getJsonFile} from "../../storage.js";
import {updateData} from "../database.js";
import {sanitizeFirebaseKey} from "../../utils.js";

/**
 * Handle post-processing for location images
 * Updates the RTDB with the generated image URL
 * @param {Object} entry - The queue entry
 * @param {Object} resultObj - The result object containing the image URL
 * @return {Promise<void>}
 */
export default async function handleLocationImagePostProcessing(entry, resultObj) {
  try {
    // Debug logging to understand the result structure
    logger.debug(`Location image result for ${entry.id}: ${JSON.stringify(resultObj)}`);

    // Check if the result is stored in GCS
    let actualResult = resultObj.result;
    if (actualResult?.resultGcsPath) {
      logger.debug(`Retrieving location image result from GCS: ${actualResult.resultGcsPath}`);
      actualResult = await getJsonFile({filename: actualResult.resultGcsPath});
    }

    // Extract both URLs from the new format
    const cdnUrl = actualResult?.cdnUrl;
    const gcpUrl = actualResult?.gcpUrl;

    if (cdnUrl && gcpUrl) {
      const {graphId, identifier, chapter} = entry.params;

      // Extract location name from identifier (remove chapter suffix)
      let locationName = identifier;
      if (locationName) {
        // Remove chapter suffix (e.g., "-ch0")
        locationName = locationName.replace(/-ch\d+$/, "");
        // Remove moderation suffix if present
        locationName = locationName.replace(/_moderated$/, "");
        // Convert underscores back to spaces for display
        locationName = locationName.replace(/_/g, " ");
      }

      logger.debug(`Updating RTDB for location image: graphId=${graphId}, chapter=${chapter}, location=${locationName}, cdnUrl=${cdnUrl}, gcpUrl=${gcpUrl}`);

      // Sanitize the location name for use as a Firebase key
      const sanitizedName = sanitizeFirebaseKey({key: locationName});

      // Update location in RTDB using the new chapter-based structure
      const updatePath = `graphs/${graphId}/chapters/${chapter}/locations/${sanitizedName}`;
      await updateData({
        ref: updatePath,
        data: {
          image: cdnUrl,
          imageGcp: gcpUrl,
        },
      });

      logger.info(`Updated location ${locationName} image and imageGcp in RTDB for graph ${graphId} chapter ${chapter}`);
    } else {
      logger.warn(`Missing CDN or GCP URL in result for location image entry ${entry.id}. Result: ${JSON.stringify(actualResult)}`);
    }
  } catch (error) {
    logger.error(`Failed to update location image in RTDB: ${error.message}`);
    // Don't throw - we don't want to break the queue processing
  }
}
