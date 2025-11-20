/**
 * @fileoverview BookImport-specific implementation of AiQueue
 * Handles M4B book import and transcription generation requests
 */

import AiQueue from "./aiQueue.js";
import {QUEUE_RETRY_LIMIT} from "./config.js";
import {createRateLimiter} from "../../storage/realtimeDb/rateLimiter.js";
import logger from "../../util/logger.js";
import {generateTranscriptions} from "../transcribe/transcriber.js";
import {getInstance as getAnalytics} from "../../analytics/bookPipelineAnalytics.js";
import {catalogueGetRtdb} from "../../storage/realtimeDb/catalogue.js";

const bookImportRateLimiter = createRateLimiter({
  serviceName: "book-import",
  options: {
    maxRequests: 100, // 100 requests
    windowSize: 60000, // 1 minute window
  },
});

/**
 * Custom unique key generator for BookImportQueue
 * @param {Object} params - Parameters for generating unique key
 * @return {string} Unique identifier for the queue entry
 */
function bookImportQueueToUnique(params) {
  const {type, entryType, taskParams, retry = false} = params;
  const {uid, sku} = taskParams || {};

  if (!uid || !sku) {
    throw new Error("uid and sku must be defined in taskParams");
  }

  // Use current timestamp to ensure uniqueness
  const timestamp = Date.now();

  // Generate unique key based on queue type, uid, sku, and timestamp
  const retryString = retry ? "_retry" : "";
  return `${type}_${entryType}_${uid}_${sku}_${timestamp}${retryString}`;
}

/**
 * Queue implementation for book import and M4B transcription requests
 * Handles processing of audiobook imports
 */
class BookImportQueue extends AiQueue {
  /**
   * Creates a new BookImportQueue instance
   * Configures queue with book import-specific settings
   */
  constructor() {
    super({
      queueName: "bookImport",
      rateLimiters: {
        "default": bookImportRateLimiter,
      },
      uniqueKeyGenerator: bookImportQueueToUnique,
      dispatchFunctionName: "launchBookImportQueue",
      defaultModel: "default", // Use the default rate limiter
    });

    // Set retry limit
    this.retryLimit = QUEUE_RETRY_LIMIT;
  }

  /**
   * Process a single item from the queue using generateM4BTranscriptions
   * @param {Object} params - The parameters for the book import request
   * @return {Promise<Object>} The response from generateTranscriptions
   */
  async processItem({entry}) {
    logger.info(`BookImportQueue: processItem called with entry:`, JSON.stringify(entry));
    const {uid, sku} = entry.params;

    if (!uid || !sku) {
      throw new Error("Missing required parameters: uid and sku are required");
    }

    logger.info(`BookImportQueue: Processing M4B transcription for uid: ${uid}, sku: ${sku}`);

    // Track book import started
    const analytics = getAnalytics();
    if (analytics) {
      try {
        // Get book metadata for analytics
        const catalogueItem = await catalogueGetRtdb({sku});
        const bookTitle = catalogueItem?.metadata?.title || catalogueItem?.title || "Unknown";
        const bookAuthor = catalogueItem?.metadata?.author || catalogueItem?.author || "Unknown";

        await analytics.trackBookImportStarted({
          uid,
          sku,
          bookTitle,
          bookAuthor,
          source: entry.params.source || "queue",
          entryType: entry.params.entryType || "bookImport",
        });
      } catch (analyticsError) {
        logger.warn(`Failed to track book import start: ${analyticsError.message}`);
      }
    }

    try {
      // Call generateTranscriptions with the same parameters used by generateM4BTranscriptions
      const result = await generateTranscriptions({
        uid,
        item: {sku},
        entryType: "m4b",
      });

      logger.info(`BookImportQueue: Successfully processed M4B transcription for sku: ${sku}`);

      return {
        result: {
          success: true,
          transcriptionPath: result.transcriptions,
          metadata: result.metadata,
          sku,
          uid,
        },
        // No tokens used for this operation
        tokensUsed: 0,
      };
    } catch (error) {
      const retryCount = entry.retryCount || 0;
      const retryLimit = this.retryLimit;

      // Track failure
      if (analytics) {
        try {
          await analytics.trackPipelineFailure({
            uid,
            sku,
            stage: "book_import",
            error,
            metadata: {
              retryCount,
              retryLimit,
              entryId: entry.id,
            },
          });
        } catch (analyticsError) {
          logger.warn(`Failed to track book import failure: ${analyticsError.message}`);
        }
      }

      if (retryCount >= retryLimit) {
        logger.critical(`CRITICAL BookImportQueue: ${sku} for ${uid} failed final attempt ${retryCount + 1} of ${retryLimit} processing entry ${entry.id}: ${error.message}`);
        throw error;
      } else {
        logger.error(`BookImportQueue: ${sku} for ${uid} failed attempt ${retryCount + 1} of ${retryLimit}. Will retry processing entry ${entry.id}: ${error.message}`);
      }
      throw error;
    }
  }
}

// Create singleton instance
const bookImportQueue = new BookImportQueue();

export {bookImportQueue, BookImportQueue};
