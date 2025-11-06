/**
 * @fileoverview Fal-specific implementation of AbstractAiQueue
 */

import AiQueue from "./aiQueue.js";
import {rateLimiters, QUEUE_RETRY_LIMIT} from "./config.js";
import {queueEntryTypeToFunction} from "../fal/fal.js";
import logger from "../../util/logger.js";
import {moderateImagePrompt} from "../../util/imageHelper.js";
import {queueUpdateEntries} from "../../storage/firestore/queue.js";
import {
  queueAddEntries,
} from "../../storage/firestore/queue.js";

/**
 * Queue implementation for Fal API requests
 * Handles rate limiting, batching, and retry logic specific to Fal
 */
class FalQueue extends AiQueue {
  /**
   * Creates a new FalQueue instance
   * Configures queue with Fal-specific settings including rate limits
   */
  constructor() {
    // Get Fal rate limiters from config if available
    const falRateLimiters = rateLimiters.fal || {};

    super({
      queueName: "fal",
      rateLimiters: falRateLimiters,
      uniqueKeyGenerator: (entry) => {
        // Generate unique key based on prompt and model
        return `${entry.params.prompt}_${entry.params.model}`;
      },
      dispatchFunctionName: "launchFalQueue",
      defaultModel: "default", // Use the default rate limiter for all models
    });

    // Set retry limit
    this.retryLimit = QUEUE_RETRY_LIMIT;
  }

  /**
   * Groups queue entries by model - for Fal, we use a single global rate limiter
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
      model: entry.params.model || "imagen4-ultra",
      outputPath: entry.params.outputPath || entry.params.outputPathWithoutExtension + ".jpeg",
      outputFormat: entry.params.outputFormat || "jpeg",
      modelParams: entry.params.modelParams || {},
    };

    logger.debug(`Processing Fal queue item with model: ${params.model}`);
    return await generateFn(params);
  }

  /**
   * Validate queue entry has required fields
   * @param {Object} entry - The queue entry to validate
   * @return {boolean} Whether the entry is valid
   */
  validateEntry(entry) {
    if (!entry.params.prompt) {
      logger.warn(`Fal queue entry missing required field: prompt`);
      return false;
    }
    return true;
  }

  /**
   * Check if an error is a content policy violation
   * @param {Error} error - The error to check
   * @return {boolean} Whether it's a content policy violation
   */
  isContentPolicyViolation(error) {
    if (!error?.body?.detail) return false;

    // Handle array format: {detail: [{type: "content_policy_violation"}]}
    if (Array.isArray(error.body.detail)) {
      return error.body.detail[0]?.type === "content_policy_violation";
    }

    // Handle string format: {detail: "All generated images were filtered by safety checks"}
    if (typeof error.body.detail === "string") {
      return error.body.detail.includes("safety checks");
    }

    return false;
  }

  /**
   * Handle retry logic for a failed item with content policy violation support
   * @param {Object} params - The parameters object
   * @param {Object} params.entry - The failed queue entry
   * @param {Error} params.error - The error that caused the failure
   * @return {Promise<boolean>} Whether retry was scheduled
   */
  async handleRetry({entry, error}) {
    // Check if this is a content policy violation
    const isContentViolation = this.isContentPolicyViolation(error);

    if (isContentViolation && (entry.retryCount || 0) < this.retryLimit) {
      logger.info(`Content policy violation for entry ${entry.id}, attempting moderation (retry ${entry.retryCount || 0}/${this.retryLimit})`);

      try {
        const params = entry.params;
        const identifier = params.identifier || entry.identifier;

        // Moderate the prompt
        const moderatedPrompt = await moderateImagePrompt({
          prompt: params.prompt,
          context: identifier ? `Character: ${identifier}` : "",
        });

        // Normalize identifier and add moderated suffix

        const normalizedIdentifier = identifier ?
          identifier.toLowerCase().replace(/\s+/g, "_") :
          new Date().getTime().toString();
        const moderatedIdentifier = normalizedIdentifier + "_moderated";

        const entryParam = {
          ...entry.params,
          prompt: moderatedPrompt,
          identifier: moderatedIdentifier,
        };

        const uniqueKey = falQueueToUnique({
          type: entry.type,
          entryType: entry.entryType,
          graphId: entry.params.graphId,
          identifier: moderatedIdentifier,
          chapter: entry.params.chapter,
        });

        const queueResult = await queueAddEntries({
          types: [entry.type],
          entryTypes: [entry.entryType],
          entryParams: [entryParam],
          uniques: [uniqueKey],
        });

        if (queueResult.success !== true) {
          throw new Error(`Failed to add moderated entry to queue: ${JSON.stringify(queueResult)}`);
        }

        // Get the new entry ID from the result
        const newEntryId = queueResult.ids ? queueResult.ids[0] : uniqueKey;

        // Update the new entry with the retry count from the original
        const retryCount = entry.retryCount ? entry.retryCount + 1 : 1;
        await queueUpdateEntries({
          ids: [newEntryId],
          statuses: ["pending"],
          retryCounts: [retryCount],
        });

        // Mark the original entry as error with trace
        await queueUpdateEntries({
          ids: [entry.id],
          statuses: ["error"],
          traces: [`Content policy violation - moderated version created as entry: ${uniqueKey}`],
        });

        logger.info(`Successfully created moderated entry ${uniqueKey} for original entry ${entry.id}`);

        // Return success to indicate we've handled the error (prevents parent from overwriting our trace)
        return {success: true};
      } catch (moderationError) {
        logger.error(`Failed to moderate prompt for entry ${entry.id}: ${moderationError.message}`);
        // If moderation fails, continue with normal retry logic
      }
    }

    // Call parent handleRetry to handle the standard retry logic
    return super.handleRetry({entry, error});
  }
}

/**
 * Generate a unique identifier for a fal queue entry
 * @param {Object} params - The parameters object
 * @param {string} params.type - The queue type
 * @param {string} params.entryType - The entry type
 * @param {string} params.graphId - The graph ID
 * @param {string} params.identifier - The identifier
 * @param {number} params.chapter - The chapter number
 * @param {boolean} [params.retry=false] - Whether this is a retry
 * @return {string} Unique identifier string
 */
function falQueueToUnique(params) {
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
const falQueue = new FalQueue();

export {falQueue, FalQueue, falQueueToUnique};
