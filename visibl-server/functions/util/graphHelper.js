// import logger from "./logger.js";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime.js";
import {catalogueGetRtdb} from "../storage/realtimeDb/catalogue.js";
import {getGraph} from "../storage/storage.js";
import {storeScenes} from "../storage/storage.js";
import {catalogueAddStyleRtdb} from "../storage/realtimeDb/catalogue.js";
import {catalogueUpdateRtdbProperty} from "../storage/realtimeDb/catalogue.js";
import {catalogueGetAllRtdb} from "../storage/realtimeDb/catalogue.js";
import {getData, deleteData} from "../storage/realtimeDb/database.js";

import logger from "./logger.js";

// Initialize dayjs with relativeTime plugin
dayjs.extend(relativeTime);


/**
 * Calculates the duration of each chapter in a transcription object
 * @param {Object} params - The parameters object
 * @param {Object} params.transcriptions - Object containing transcription data organized by chapter
 * @param {Array} params.transcriptions[chapter] - Array of transcription segments for a chapter
 * @param {string} params.transcriptions[chapter][].startTime - Start time of each transcription segment
 * @return {Object} Object mapping chapter numbers to their total duration in seconds
 */
function getChapterLengths({transcriptions}) {
  const chapterLengths = {};
  const sortedChapters = Object.keys(transcriptions)
      .map((key) => parseInt(key, 10))
      .sort((a, b) => a - b);

  for (let i = 0; i < sortedChapters.length; i++) {
    const chapterNum = sortedChapters[i];
    const chapter = transcriptions[chapterNum];

    if (!chapter || chapter.length === 0) {
      chapterLengths[chapterNum] = 0;
      continue;
    }

    const startTime = parseFloat(chapter[0].startTime) || 0;

    // Find next chapter's start time
    let endTime = null;
    for (let j = i + 1; j < sortedChapters.length; j++) {
      const nextChapter = transcriptions[sortedChapters[j]];
      if (nextChapter && nextChapter.length > 0) {
        endTime = parseFloat(nextChapter[0].startTime);
        break;
      }
    }

    // If no next chapter, we can't know the actual duration
    // Return 0 or use last segment time - first segment time as minimum duration
    if (endTime === null) {
      const lastSegmentTime = parseFloat(chapter[chapter.length - 1].startTime);
      // This gives minimum duration (doesn't include last segment's audio duration)
      chapterLengths[chapterNum] = lastSegmentTime - startTime;
      continue;
    }

    chapterLengths[chapterNum] = endTime - startTime;
  }

  return chapterLengths;
}

/**
 * Calculates the duration of a chapter from its transcription segments
 * @param {Array} chapterTranscriptions - Array of transcription segments for a chapter
 * @param {string} chapterTranscriptions[].startTime - Start time of each transcription segment
 * @param {number} nextChapterStartTime - Start time of the next chapter, or 0 if no next chapter
* @return {number} Duration of the chapter in seconds
 */
function getChapterDuration(chapterTranscriptions, nextChapterStartTime) {
  if (!chapterTranscriptions || chapterTranscriptions.length === 0) {
    return 0;
  }

  // Get the start time of the first item and end time of the last item
  const firstItem = chapterTranscriptions[0];
  const lastItem = chapterTranscriptions[chapterTranscriptions.length - 1];

  const startTime = parseFloat(firstItem.startTime) || 0;
  const endTime = parseFloat(lastItem.startTime) || 0;

  return endTime - startTime;
}

/**
 * Gets the author and title from a SKU
 * @param {string} sku - The SKU of the book
 * @return {Promise<Object>} Object containing author and title
 */
async function getAuthorAndTitleFromSku(sku) {
  const catalogueItem = await catalogueGetRtdb({sku});

  return {
    author: catalogueItem.author,
    title: catalogueItem.title,
  };
}

/**
 * Fetches graph entity array with error handling and appropriate fallback
 * @param {Object} params - Parameters for fetching graph data
 * @param {string} params.uid - User ID
 * @param {string} params.sku - Book SKU
 * @param {string} params.visibility - Visibility setting
 * @param {string} params.type - Type of graph data to fetch
 * @param {number} params.chapter - Chapter number
 * @param {string} params.graphId - Graph ID
 * @param {string} params.responseKey - Key to use for the response object, defaults to type
 * @return {Promise<Object>} Graph data or appropriate fallback on error
 */
async function fetchGraphEntityArray({uid, sku, visibility, type, chapter, graphId, responseKey = type}) {
  try {
    return await getGraph({uid, sku, visibility, type, chapter, graphId});
  } catch (error) {
    // Return object with empty array for the appropriate key
    return {[responseKey]: []};
  }
}

/**
 * Creates a default catalogue entry for a scene, stores default scenes, and updates the catalogue.
 * @param {Object} data - The data for creating the default catalogue entry.
 * @param {string} data.id - The unique ID for the scene.
 * @param {string} data.sku - The SKU of the book.
 * @param {string} [data.uid] - The user ID (optional, defaults to "admin").
 * @param {string} data.graphId - The graph ID associated with the scene.
 * @return {Promise<Object>} The created scene object with its properties.
 * @throws {Error} If required parameters are missing.
 */
async function scenesCreateDefaultCatalogue(data) {
  let {id, sku, uid, graphId} = data;
  if (!id) {
    throw new Error("id is required");
  }
  if (!sku) {
    throw new Error("sku  required");
  }
  const prompt = "";
  const title = "Origin";
  if (!uid) {
    uid = "admin";
  }


  try {
    const defaultScenes = await getGraph({graphId, sku, type: "augmentedScenes"});
    await storeScenes({sceneId: id, sceneData: defaultScenes});
  } catch (error) {
    logger.warn(`No augmented scenes found for ${graphId}`);
  }
  // Add scene to catalogueItem.
  const newScene = {
    sku,
    styleId: id,
    title,
    prompt,
    uid,
    userPrompt: prompt,
  };
  await catalogueAddStyleRtdb(newScene);
  await catalogueUpdateRtdbProperty({
    sku,
    property: "defaultSceneId",
    value: id,
  });
  return {id, ...newScene};
}

/**
 * Clean up graph data from Catalogue and users library items
 * Removes graph-related fields from catalogue items and deletes all user library items
 * @param {Array} excludeSkus - Array of SKUs to exclude from cleanup (optional)
 * @return {Promise<Object>} Cleanup results summary
 */
async function cleanupGraphData({excludeSkus = [], excludeUsers = []}) {
  try {
    logger.info("Starting graph cleanup process");

    // Get all catalogue items
    const catalogues = await catalogueGetAllRtdb({visibility: "all"});
    logger.info(`Found ${Object.keys(catalogues || {}).length} catalogue items to clean`);

    const cleanupResults = {
      cataloguesUpdated: [],
      cataloguesFailed: [],
      usersProcessed: 0,
      libraryItemsRemoved: 0,
    };

    // Clean each catalogue item
    // eslint-disable-next-line no-unused-vars
    for (const [_, catalogueItem] of Object.entries(catalogues || {})) {
      const sku = catalogueItem.id;
      if (excludeSkus && excludeSkus.includes(sku)) {
        logger.info(`Skipping ${sku} as it is in the exclude list`);
        continue;
      }
      try {
        // Remove graph-related fields
        await catalogueUpdateRtdbProperty({sku, property: "graphProgress", value: null});
        await catalogueUpdateRtdbProperty({sku, property: "defaultGraphId", value: null});
        await catalogueUpdateRtdbProperty({sku, property: "defaultSceneId", value: null});
        await catalogueUpdateRtdbProperty({sku, property: "scenes", value: null});
        await catalogueUpdateRtdbProperty({sku, property: "styles", value: null});

        // Remove user-specific fields
        await catalogueUpdateRtdbProperty({sku, property: "isListenable", value: null});
        await catalogueUpdateRtdbProperty({sku, property: "isConsumableOffline", value: null});
        await catalogueUpdateRtdbProperty({sku, property: "isPlayable", value: null});
        await catalogueUpdateRtdbProperty({sku, property: "isVisible", value: null});
        await catalogueUpdateRtdbProperty({sku, property: "customerRights", value: null});

        // Set graphAvailable to false
        await catalogueUpdateRtdbProperty({sku, property: "graphAvailable", value: false});

        logger.debug(`Cleaned catalogue item: ${sku}`);
        cleanupResults.cataloguesUpdated.push(sku);
      } catch (error) {
        logger.error(`Failed to clean catalogue item ${sku}: ${error.message}`);
        cleanupResults.cataloguesFailed.push({sku, error: error.message});
      }
    }

    // Get all users and remove their library items
    try {
      const usersData = await getData({ref: "users"});

      if (usersData) {
        const userIds = Object.keys(usersData);
        logger.info(`Found ${userIds.length} users to process`);

        for (const userId of userIds) {
          if (excludeUsers && excludeUsers.includes(userId)) {
            logger.info(`Skipping ${userId} as it is in the exclude list`);
            continue;
          }
          try {
            // Check if user has library items
            const userLibraryPath = `users/${userId}/library`;
            const userLibrary = await getData({ref: userLibraryPath});

            if (userLibrary) {
              const libraryItemCount = Object.keys(userLibrary).length;

              // Delete all library items for this user
              await deleteData({ref: userLibraryPath});

              logger.debug(`Removed ${libraryItemCount} library items for user: ${userId}`);
              cleanupResults.libraryItemsRemoved += libraryItemCount;
            }

            cleanupResults.usersProcessed++;
          } catch (error) {
            logger.error(`Failed to process library for user ${userId}: ${error.message}`);
          }
        }
      }
    } catch (error) {
      logger.error(`Failed to process users: ${error.message}`);
    }

    const summary = {
      success: true,
      message: "Graph cleanup completed",
      results: {
        catalogues: {
          total: Object.keys(catalogues || {}).length,
          updated: cleanupResults.cataloguesUpdated.length,
          failed: cleanupResults.cataloguesFailed.length,
        },
        users: {
          processed: cleanupResults.usersProcessed,
          libraryItemsRemoved: cleanupResults.libraryItemsRemoved,
        },
      },
      details: {
        cataloguesUpdated: cleanupResults.cataloguesUpdated,
        cataloguesFailed: cleanupResults.cataloguesFailed,
      },
    };

    logger.info(`Graph cleanup completed: ${JSON.stringify(summary)}`);
    return summary;
  } catch (error) {
    logger.error(`Fatal error in cleanupGraphData: ${error.message}`);
    throw new Error(`Cleanup failed: ${error.message}`);
  }
}

/**
 * Determines if the next chapter should be included in graph processing based on its duration
 * @param {Object} catalogueItem - The catalogue item containing chapter metadata
 * @param {number} nextChapterIndex - The 0-based index of the next chapter
 * @param {number} minDurationSeconds - Minimum duration in seconds (default: 300 = 5 minutes)
 * @return {Object} Object with shouldInclude boolean and reason string
 */
function shouldIncludeNextChapter(catalogueItem, nextChapterIndex, minDurationSeconds = 300) {
  // Check if we have chapter metadata with timing information
  if (!catalogueItem?.metadata?.chapters) {
    return {
      shouldInclude: true,
      reason: "No chapter metadata available, including by default",
    };
  }

  const nextChapterData = catalogueItem.metadata.chapters[nextChapterIndex];
  if (!nextChapterData) {
    return {
      shouldInclude: false,
      reason: `Chapter ${nextChapterIndex} not found in metadata`,
    };
  }

  // Check if timing data is available
  if (nextChapterData.startTime === undefined || nextChapterData.endTime === undefined) {
    return {
      shouldInclude: true,
      reason: `No timing data for chapter ${nextChapterIndex}, including by default`,
    };
  }

  // Calculate duration
  const duration = nextChapterData.endTime - nextChapterData.startTime;
  const shouldInclude = duration > minDurationSeconds;

  return {
    shouldInclude,
    duration,
    reason: shouldInclude ?
      `Chapter ${nextChapterIndex} duration is ${duration}s (>${minDurationSeconds}s)` :
      `Chapter ${nextChapterIndex} duration is ${duration}s (<${minDurationSeconds}s)`,
  };
}

/**
 * Finds the next chapter that is over the minimum duration, or returns the last chapter
 * @param {Object} catalogueItem - The catalogue item containing chapter metadata
 * @param {string} currentChapterKey - The current chapter key (e.g., "0", "1", "2")
 * @param {number} minDurationSeconds - Minimum duration in seconds (default: 300 = 5 minutes)
 * @return {number} The chapter key to process up to (e.g., 3, 4, etc.)
 */
function findNextChapterOverDuration(catalogueItem, currentChapterKey, minDurationSeconds = 300) {
  // Convert current chapter key to number for iteration
  // Default to 0 if currentChapterKey is not a number
  const currentChapterIndex = parseInt(currentChapterKey, 10) || 0;

  // Determine total number of chapters from catalogueItem
  const totalChapters =
    (catalogueItem?.metadata?.numChapters) ? catalogueItem.metadata.numChapters :
    (catalogueItem?.metadata?.chapters) ? Object.keys(catalogueItem.metadata.chapters).length :
    0;

  // No chapter information available, default to next chapter
  if (!totalChapters) {
    logger.info("No chapter information available, returning next chapter");
    return currentChapterIndex + 1;
  }

  // If we're at the last chapter, return it
  if (currentChapterIndex >= totalChapters - 1) {
    logger.info(`Already at last chapter ${currentChapterIndex}`);
    return currentChapterIndex;
  }

  // If no metadata chapters, default to next chapter
  if (!catalogueItem?.metadata?.chapters) {
    logger.info("No chapter metadata available, returning next chapter");
    return currentChapterIndex + 1;
  }

  // Search for the next chapter that is over the minimum duration
  for (let i = currentChapterIndex + 1; i < totalChapters; i++) {
    const chapterKey = i;
    const chapterData = catalogueItem.metadata.chapters[chapterKey];

    // If this is the last chapter, return it regardless of duration
    if (i === totalChapters - 1) {
      logger.info(`Reached last chapter ${chapterKey}`);
      return chapterKey;
    }

    // If no timing data, assume it meets the criteria
    if (!chapterData || chapterData.startTime === undefined || chapterData.endTime === undefined) {
      logger.info(`No timing data for chapter ${chapterKey}, selecting it`);
      return chapterKey;
    }

    // Check duration
    const duration = chapterData.endTime - chapterData.startTime;
    if (duration > minDurationSeconds) {
      logger.info(`Chapter ${chapterKey} duration is ${duration}s (>${minDurationSeconds}s), selecting it`);
      return chapterKey;
    }

    logger.debug(`Chapter ${chapterKey} duration is ${duration}s (<${minDurationSeconds}s), skipping`);
  }

  // If we get here, no chapters met the criteria - return the last one
  const lastChapterKey = totalChapters - 1;
  logger.info(`No chapters over ${minDurationSeconds}s found, returning last chapter ${lastChapterKey}`);
  return lastChapterKey;
}

/**
 * Simplified checkup for potentially stuck books
 * @param {number} minutesThreshold - Time threshold in minutes (default: 10)
 * @return {Promise<void>}
 */
async function graphCheckup(minutesThreshold = 10) {
  try {
    const thresholdMs = minutesThreshold * 60 * 1000;
    const currentTime = Date.now();

    // Fetch all catalogue items
    const catalogues = await catalogueGetAllRtdb({visibility: "all"});

    if (!catalogues) {
      logger.info("No catalogue items found");
      return;
    }

    // Check each catalogue item that has been added to a user's library
    for (const catalogueItem of Object.values(catalogues)) {
      const sku = catalogueItem.id;

      // Only check items that have been added to at least one user's library
      const addedToFirstUserAt = catalogueItem.addedToFirstUserAt;
      if (!addedToFirstUserAt) continue;

      // Clear the notification flag if graph is now available (for future re-runs)
      if (catalogueItem.graphAvailable && catalogueItem.graphStuckNotifiedAt) {
        await catalogueUpdateRtdbProperty({
          sku: sku,
          property: "graphStuckNotifiedAt",
          value: null,
        });
        logger.info(`Graph now available for SKU ${sku}, cleared stuck notification flag`);
        continue;
      }

      const timeSinceAdded = currentTime - addedToFirstUserAt;

      // Only check items added to a user's library more than threshold minutes ago
      if (timeSinceAdded > thresholdMs) {
        // Check if graph is not available
        if (!catalogueItem.graphAvailable && (!catalogueItem.defaultGraphId || catalogueItem.defaultGraphId === "N/A")) {
          // Skip if we've already notified about this stuck item
          if (catalogueItem.graphStuckNotifiedAt) {
            continue;
          }

          const timeAgo = dayjs(addedToFirstUserAt).fromNow();

          // Check if there's graph progress to report
          if (catalogueItem.graphProgress) {
            const progress = catalogueItem.graphProgress.progress ||
                           catalogueItem.graphProgress.completion || 0;
            const stage = catalogueItem.graphProgress.stage ||
                        catalogueItem.graphProgress.currentStep ||
                        catalogueItem.graphProgress.status || "Unknown";
            logger.warn(
                `Book processing may be stuck: SKU ${sku} (${catalogueItem.title || "Unknown"})` +
              ` - added to user's library ${timeAgo}, progress: ${progress}%, stage: ${stage}`,
            );
          } else {
            logger.warn(
                `Book processing may be stuck: SKU ${sku} (${catalogueItem.title || "Unknown"})` +
              ` - added to user's library ${timeAgo}, no graph available, no progress tracking`,
            );
          }

          // Mark this item as notified to prevent duplicate alerts
          await catalogueUpdateRtdbProperty({
            sku: sku,
            property: "graphStuckNotifiedAt",
            value: currentTime,
          });
        }
      }
    }
  } catch (error) {
    logger.error(`Error in graphCheckup: ${error.message}`);
  }
}

/**
 * Check catalogue for books with incomplete graph processing
 * Fetches catalogue items with incomplete processing
 * @param {number} minutesThreshold - Time threshold in minutes to consider processing as stuck (default: 10)
 * @return {Promise<Object>} Object containing check results
 */

/**
 * Calculate exponential backoff delay with jitter
 * @param {Object} params - Backoff parameters
 * @param {number} params.retryCount - Current retry attempt number
 * @param {number} params.initialDelay - Initial delay in milliseconds
 * @param {number} params.maxDelay - Maximum delay cap in milliseconds
 * @param {number} params.multiplier - Backoff multiplier
 * @return {number} Delay in milliseconds
 */
function calculateExponentialBackoff({retryCount, initialDelay, maxDelay, multiplier}) {
  // exponential = initialDelay * (multiplier ^ retryCount)
  const exponentialDelay = initialDelay * Math.pow(multiplier, retryCount);
  // Cap at maxDelay
  const cappedDelay = Math.min(exponentialDelay, maxDelay);
  // Add jitter (±10% random variance) to prevent thundering herd
  const jitter = cappedDelay * (0.9 + Math.random() * 0.2);
  return Math.round(jitter);
}


export {
  getChapterLengths,
  getChapterDuration,
  getAuthorAndTitleFromSku,
  fetchGraphEntityArray,
  scenesCreateDefaultCatalogue,
  cleanupGraphData,
  shouldIncludeNextChapter,
  findNextChapterOverDuration,
  graphCheckup,
  calculateExponentialBackoff,
};
