/**
 * @fileoverview ImageRouter-specific implementation of AbstractAiQueue
 */

import AiQueue from "./aiQueue.js";
import {rateLimiters, QUEUE_RETRY_LIMIT} from "./config.js";
import {queueEntryTypeToFunction} from "../imagerouter/imagerouter.js";
import logger from "../../util/logger.js";

/**
 * Queue implementation for ImageRouter API requests
 * Handles rate limiting, batching, and retry logic specific to ImageRouter
 */
class ImageRouterQueue extends AiQueue {
  /**
   * Creates a new ImageRouterQueue instance
   * Configures queue with ImageRouter-specific settings including rate limits
   */
  constructor() {
    // Get ImageRouter rate limiters from config if available
    const imagerouterRateLimiters = rateLimiters.imagerouter || {};

    super({
      queueName: "imagerouter",
      rateLimiters: imagerouterRateLimiters,
      uniqueKeyGenerator: (entry) => {
        // Generate unique key based on prompt and model
        return `${entry.params.prompt}_${entry.params.model}`;
      },
      dispatchFunctionName: "launchImageRouterQueue",
      defaultModel: "default", // Use the default rate limiter for all models
    });

    // Set retry limit
    this.retryLimit = QUEUE_RETRY_LIMIT;
  }

  /**
   * Groups queue entries by model - for ImageRouter, we use a single global rate limiter
   * @param {Object} params - The parameters object
   * @param {Array} params.queue - Array of queue entries
   * @return {Object} All entries grouped under 'default' key
   */
  groupEntriesByModel({queue}) {
    // Group all entries under 'default' to use global rate limiting
    return {default: queue};
  }

  /**
   * Process a single queue item
   * @param {Object} params - The parameters object
   * @param {Object} params.entry - Queue entry to process
   * @return {Promise<Object>} Processing result
   */
  async processItem({entry}) {
    const generateFn = queueEntryTypeToFunction(entry.entryType);
    const params = {
      prompt: entry.params.prompt,
      model: entry.params.model,
      outputPath: entry.params.outputPath || entry.params.outputPathWithoutExtension + ".jpeg",
      outputFormat: entry.params.outputFormat || "jpeg",
    };

    logger.debug(`Processing ImageRouter queue item with model: ${params.model}`);
    return await generateFn(params);
  }

  /**
   * Validate queue entry has required fields
   * @param {Object} entry - The queue entry to validate
   * @return {boolean} Whether the entry is valid
   */
  validateEntry(entry) {
    if (!entry.params.prompt || !entry.params.model) {
      logger.warn(`ImageRouter queue entry missing required fields: prompt=${!!entry.params.prompt}, model=${!!entry.params.model}`);
      return false;
    }
    return true;
  }

  /**
   * Process multiple queue items in batch
   * @param {Array} entries - Array of queue entries to process
   * @return {Promise<Array>} Array of processing results
   */
  async processBatch(entries) {
    const results = [];

    for (const entry of entries) {
      if (!this.validateEntry(entry)) {
        results.push({
          id: entry.id,
          error: "Invalid entry: missing prompt or model",
          success: false,
        });
        continue;
      }

      try {
        const result = await this.processItem({entry});
        results.push({
          id: entry.id,
          result,
          success: true,
        });
      } catch (error) {
        logger.error(`ImageRouter queue error for entry ${entry.id}: ${error.message}`);
        results.push({
          id: entry.id,
          error: error.message,
          success: false,
        });
      }
    }

    return results;
  }
}

/**
 * Generate a unique identifier for an imagerouter queue entry
 * @param {Object} params - The parameters object
 * @param {string} params.type - The queue type
 * @param {string} params.entryType - The entry type
 * @param {string} params.graphId - The graph ID
 * @param {string} params.identifier - The identifier
 * @param {number} params.chapter - The chapter number
 * @param {boolean} [params.retry=false] - Whether this is a retry
 * @return {string} Unique identifier string
 */
function imagerouterQueueToUnique(params) {
  const {type, entryType, graphId, identifier, chapter, retry = false} = params;
  // Check if any of the required parameters are undefined
  if (type === undefined || entryType === undefined || graphId === undefined ||
      identifier === undefined || chapter === undefined) {
    throw new Error("All parameters (type, entryType, graphId, identifier, chapter) must be defined");
  }

  // If all parameters are defined, return a unique identifier
  const retryString = retry ? "_retry" : "";
  return `${type}_${entryType}_${graphId}_${identifier}_ch${chapter}${retryString}`;
}

// Create singleton instance
const imagerouterQueue = new ImageRouterQueue();

export {imagerouterQueue, ImageRouterQueue, imagerouterQueueToUnique};

