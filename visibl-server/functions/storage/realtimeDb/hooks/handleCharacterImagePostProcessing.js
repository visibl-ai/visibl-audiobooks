/* eslint-disable require-jsdoc */
import logger from "../../../util/logger.js";
import {getJsonFile} from "../../storage.js";
import {updateData} from "../database.js";
import {sanitizeFirebaseKey} from "../../utils.js";

/**
 * Handle post-processing for character images
 * Updates the RTDB with the generated image URL
 * @param {Object} entry - The queue entry
 * @param {Object} resultObj - The result object containing the image URL
 * @return {Promise<void>}
 */
export default async function handleCharacterImagePostProcessing(entry, resultObj) {
  try {
    // Debug logging to understand the result structure
    logger.debug(`Character image result for ${entry.id}: ${JSON.stringify(resultObj)}`);

    // Check if the result is stored in GCS
    let actualResult = resultObj.result;
    if (actualResult?.resultGcsPath) {
      logger.debug(`Retrieving character image result from GCS: ${actualResult.resultGcsPath}`);
      actualResult = await getJsonFile({filename: actualResult.resultGcsPath});
    }

    // Extract both URLs from the new format
    const cdnUrl = actualResult?.cdnUrl;
    const gcpUrl = actualResult?.gcpUrl;

    if (cdnUrl && gcpUrl) {
      const {graphId, identifier, type, chapter} = entry.params;

      // For profile images, keep the -profile suffix to create a separate entry
      const isProfile = type === "character-profile";

      // Extract character name from identifier
      let characterName = identifier;
      let characterKey = identifier;

      if (characterName) {
        // Remove chapter suffix (e.g., "-ch0")
        characterName = characterName.replace(/-ch\d+$/, "");
        characterKey = characterName;

        // For display name, remove profile suffix
        if (isProfile) {
          characterName = characterName.replace(/-profile$/, "");
        }

        // Remove moderation suffix if present
        characterName = characterName.replace(/_moderated$/, "");
        characterKey = characterKey.replace(/_moderated$/, "");

        // Convert underscores back to spaces for display
        characterName = characterName.replace(/_/g, " ");
      }

      logger.debug(`Updating RTDB for character image: graphId=${graphId}, chapter=${chapter}, character=${characterName}, key=${characterKey}, type=${type}, cdnUrl=${cdnUrl}, gcpUrl=${gcpUrl}`);

      // Sanitize the key for use as a Firebase key
      const sanitizedKey = sanitizeFirebaseKey({key: characterKey});

      // Determine fields based on type
      const imageField = isProfile ? "profileImage" : "image";
      const gcpField = isProfile ? "profileImageGcp" : "imageGcp";

      // Update character in RTDB using the new chapter-based structure
      const updatePath = `graphs/${graphId}/chapters/${chapter}/characters/${sanitizedKey}`;
      await updateData({
        ref: updatePath,
        data: {
          [imageField]: cdnUrl,
          [gcpField]: gcpUrl,
        },
      });

      logger.info(`Updated character ${characterName} ${imageField} and ${gcpField} in RTDB for graph ${graphId} chapter ${chapter} at key ${sanitizedKey}`);
    } else {
      logger.warn(`Missing CDN or GCP URL in result for character image entry ${entry.id}. Result: ${JSON.stringify(actualResult)}`);
    }
  } catch (error) {
    logger.error(`Failed to update character image in RTDB: ${error.message}`);
    // Don't throw - we don't want to break the queue processing
  }
}
