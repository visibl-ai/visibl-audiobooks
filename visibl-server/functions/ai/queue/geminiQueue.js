/**
 * @fileoverview Gemini-specific implementation of AbstractAiQueue
 */

import AiQueue from "./aiQueue.js";
import {geminiRequest} from "../gemini/gemini.js";
import {rateLimiters, QUEUE_RETRY_LIMIT} from "./config.js";
import {aiQueueToUnique} from "../../storage/firestore/queue.js";
import logger from "../../util/logger.js";
import {queueUpdateEntries} from "../../storage/firestore/queue.js";

/**
 * Queue implementation for Gemini LLM requests
 * Handles rate limiting, batching, and retry logic specific to Gemini
 */
class GeminiQueue extends AiQueue {
  /**
   * Creates a new GeminiQueue instance
   * Configures queue with Gemini-specific settings including rate limits and model defaults
   */
  constructor() {
    // Get Gemini rate limiters from config
    const geminiRateLimiters = rateLimiters.gemini || {};

    super({
      queueName: "gemini",
      rateLimiters: geminiRateLimiters,
      uniqueKeyGenerator: aiQueueToUnique,
      dispatchFunctionName: "launchGeminiQueue",
    });

    // Set retry limit
    this.retryLimit = QUEUE_RETRY_LIMIT;
  }

  /**
   * Process a single item from the queue using Gemini's API
   * @param {Object} params - The parameters for the Gemini request
   * @return {Promise<Object>} The response from Gemini
   */
  async processItem({entry}) {
    return await geminiRequest(entry.params);
  }

  /**
   * Handle retry logic for failed requests
   * Adds the request back to the queue with retry flag if not already retried
   * @param {Object} params - The parameters for the Gemini request
   * @param {Object} params.entry - The failed queue entry
   * @param {Object} params.entry.params - The parameters of the failed request
   * @param {string} params.entry.model - The model used for the request
   * @param {number} params.entry.estimatedTokens - Estimated token count
   * @param {boolean} params.entry.retry - Whether this was already a retry attempt
   */
  async handleRetry({entry}) {
    logger.debug(`handleRetry for entry ${entry.id}: ${entry.retryCount || 0} / ${this.retryLimit}`);
    if ((entry.retryCount || 0) < this.retryLimit) {
      logger.debug(`Attempting retry for entry ${entry.id}`);
      // Calculate exponential backoff delay based on retry count
      // But we don't wait for it, as this could cause DEADLINE_EXCEEDED errors
      const backoffDelay = Math.min(
          1000 * Math.pow(2, entry.retryCount || 0), // Exponential backoff starting at 1 second
          60000 * 30, // Max 30 minute delay
      );
      logger.debug(`Scheduling retry for entry ${entry.id} in ${backoffDelay}ms`);

      // Instead of waiting, immediately update the retry count and status
      // The next queue processor run will handle it after the cooldown
      const newRetryCount = (entry.retryCount || 0) + 1;
      return await queueUpdateEntries({
        ids: [entry.id],
        statuses: ["pending"],
        retryCounts: [newRetryCount],
      });
    }
    return null;
  }
}

// Create singleton instance
const geminiQueue = new GeminiQueue();

export {geminiQueue, GeminiQueue};
