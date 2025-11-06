import logger from "../util/logger.js";
import {bookImportQueue} from "../ai/queue/bookImportQueue.js";
import {catalogueGetRtdb} from "../storage/realtimeDb/catalogue.js";
import {catalogueUpdateRtdbProperty} from "../storage/realtimeDb/catalogue.js";
import {aaxGetUsersBySkuFirestore} from "../storage/firestore/aax.js";
import {deleteData, getData} from "../storage/realtimeDb/database.js";

/**
 * Initialize transcription generation for admin
 * Determines the appropriate uid based on the book's ownership
 * @param {Object} params - The parameters object
 * @param {string} params.sku - The SKU of the book
 * @param {boolean} params.cleanupPublicBooks - Whether to clean up sceneInfo for public books (default: false)
 * @return {Object} Success response with dispatch details
 */
export async function initTranscriptionGeneration({sku, cleanupPublicBooks = false}) {
  logger.info(`initTranscriptionGeneration: Starting for SKU: ${sku}, cleanupPublicBooks: ${cleanupPublicBooks}`);

  if (!sku) {
    throw new Error("SKU is required");
  }

  // Get the catalogue item to determine ownership
  const catalogueItem = await catalogueGetRtdb({sku});

  if (!catalogueItem) {
    throw new Error(`Catalogue item not found for SKU: ${sku}`);
  }

  // Determine the uid based on book ownership
  // For private books (with addedBy), use the owner's uid
  // For public books, use "admin"
  const uid = catalogueItem.addedBy || "admin";
  const bookType = catalogueItem.addedBy ? "private" : "public";

  logger.info(`initTranscriptionGeneration: Processing ${bookType} book ${sku} with uid: ${uid}`);

  // Reset catalogue graph fields
  await catalogueUpdateRtdbProperty({sku, property: "graphProgress", value: null});
  await catalogueUpdateRtdbProperty({sku, property: "defaultGraphId", value: null});
  await catalogueUpdateRtdbProperty({sku, property: "defaultSceneId", value: null});
  await catalogueUpdateRtdbProperty({sku, property: "styles", value: null});
  await catalogueUpdateRtdbProperty({sku, property: "graphAvailable", value: false});


  // Clear sceneInfo from users who have this book in their library
  let userIds = [];

  if (catalogueItem.visibility === "private") {
    // For private books, we can efficiently query users via aaxGetUsersBySkuFirestore
    try {
      userIds = await aaxGetUsersBySkuFirestore({sku});
      logger.info(`initTranscriptionGeneration: Found ${userIds.length} users with private book ${sku}`);
    } catch (error) {
      logger.warn(`initTranscriptionGeneration: Error getting users for book ${sku}: ${error.message}`);
    }
  } else {
    // For public books, only clean up if explicitly requested
    if (cleanupPublicBooks) {
      logger.info(`initTranscriptionGeneration: Public book ${sku} - querying all users for cleanup`);

      try {
        // Get all users from the users node
        const allUsers = await getData({ref: "users"}) || {};

        // Check each user's library for this SKU
        for (const [userId, userData] of Object.entries(allUsers)) {
          if (userData?.library?.[sku]) {
            userIds.push(userId);
          }
        }

        logger.info(`initTranscriptionGeneration: Found ${userIds.length} users with public book ${sku}`);
      } catch (error) {
        logger.error(`initTranscriptionGeneration: Error querying users for public book ${sku}: ${error.message}`);
      }
    } else {
      logger.info(`initTranscriptionGeneration: Public book ${sku} - skipping user sceneInfo cleanup (cleanupPublicBooks=false)`);
    }
  }

  // Clear sceneInfo for each user who has this book
  for (const userId of userIds) {
    try {
      const sceneInfoPath = `users/${userId}/library/${sku}/clientData/sceneInfo`;
      await deleteData({ref: sceneInfoPath});
      logger.debug(`initTranscriptionGeneration: Cleared sceneInfo for user ${userId}`);
    } catch (error) {
      logger.warn(`initTranscriptionGeneration: Error clearing sceneInfo for user ${userId}: ${error.message}`);
    }
  }

  // Add the transcription task to the BookImportQueue
  await bookImportQueue.addToQueue({
    model: "default",
    params: {
      uid,
      sku,
      entryType: "bookImport",
    },
    estimatedTokens: 0,
  });

  return {
    success: true,
    message: `Transcription generation initiated for ${bookType} book`,
    details: {
      sku,
      uid,
      bookType,
    },
  };
}
