/**
 * @fileoverview Modal-specific implementation of AbstractAiQueue
 */

import AiQueue from "./aiQueue.js";
import {rateLimiters, QUEUE_RETRY_LIMIT} from "./config.js";
import {modalQueueToUnique, queueUpdateEntries} from "../../storage/firestore/queue.js";
import {queueEntryTypeToFunction} from "../../modal/outpaint.js";
import logger from "../../util/logger.js";
import {HOSTING_DOMAIN, ENVIRONMENT} from "../../config/config.js";

/**
 * Queue implementation for Modal API requests
 * Handles rate limiting, batching, and retry logic specific to Modal
 */
class ModalQueue extends AiQueue {
  /**
   * Creates a new ModalQueue instance
   * Configures queue with Modal-specific settings including rate limits and model defaults
   */
  constructor() {
    // Get Modal rate limiters from config
    const modalRateLimiters = rateLimiters.modal || {};

    super({
      queueName: "modal",
      rateLimiters: modalRateLimiters,
      uniqueKeyGenerator: modalQueueToUnique,
      dispatchFunctionName: "launchModalQueue",
      defaultModel: "sdxl-outpaint-diffusers",
    });

    // Set retry limit
    this.retryLimit = QUEUE_RETRY_LIMIT;

    // Items will remain in processing state until the callback is received.
    this.waitCallback = true;
  }

  /**
   * Get the callback URL for Modal API responses
   * @return {string} The callback URL
   */
  getCallbackUrl() {
    if (ENVIRONMENT.value() === "development" && process.env.TUNNEL_APP_URL) {
      return `${process.env.TUNNEL_APP_URL}/v1/modal/callback`;
    }
    return `${HOSTING_DOMAIN.value()}/v1/modal/callback`;
  }

  /**
   * Process a single queue item
   * @param {Object} params - The parameters object
   * @param {Object} params.entry - Queue entry to process
   * @return {Promise<Object>} Processing result
   */
  async processItem({entry}) {
    const outpaintFn = queueEntryTypeToFunction(entry.entryType);
    const params = {
      inputPath: entry.params.inputPath,
      outputPathWithoutExtension: entry.params.outputPathWithoutExtension,
      prompt: entry.params.prompt,
      resultKey: entry.id,
      callbackUrl: this.getCallbackUrl(),
      timestamp: entry.timeRequested,
    };
    return await outpaintFn(params);
  }

  /**
   * Handle retry logic for failed requests
   * @param {Object} params - The parameters object
   * @param {Object} params.entry - The failed queue entry
   * @return {Promise<boolean>} Whether the retry was successful
   */
  async handleRetry({entry}) {
    logger.debug(`handleRetry for entry ${entry.id}: ${entry.retryCount || 0} / ${this.retryLimit}`);
    if ((entry.retryCount || 0) < this.retryLimit) {
      logger.debug(`Attempting retry for entry ${entry.id}`);
      const newRetryCount = (entry.retryCount || 0) + 1;
      return await queueUpdateEntries({
        ids: [entry.id],
        statuses: ["pending"],
        retryCounts: [newRetryCount],
      });
    }
    return false;
  }
}

// Create singleton instance
const modalQueue = new ModalQueue();

export {modalQueue, ModalQueue};
