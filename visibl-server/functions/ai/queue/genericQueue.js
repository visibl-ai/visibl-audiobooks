/**
 * @fileoverview Generic implementation of AiQueue that can handle any function
 */

import AiQueue from "./aiQueue.js";
import {defaultRateLimiter, QUEUE_RETRY_LIMIT} from "./config.js";
import {aiQueueToUnique} from "../../storage/firestore/queue.js";
import logger from "../../util/logger.js";

/**
 * Queue implementation for generic function processing
 * Handles rate limiting, batching, and retry logic
 */
class GenericQueue extends AiQueue {
  /**
   * Creates a new GenericQueue instance
   * @param {Object} params - Queue configuration parameters
   * @param {string} params.queueName - Name of the queue
   * @param {Function} params.processFn - Function to process each queue item
   * @param {Object} [params.rateLimiters=null] - Optional rate limiters for different models/functions
   * @param {string} [params.defaultModel=null] - Default model to use for rate limiting
   * @param {boolean} [params.waitCallback=false] - Whether to wait for callback before marking complete
   * @param {number} [params.retryLimit=QUEUE_RETRY_LIMIT] - Maximum number of retry attempts
   * @param {boolean} [params.useDefaultRateLimiter=true] - Whether to use the default high-limit rate limiter
   */
  constructor({
    queueName,
    processFn,
    rateLimiters = null,
    defaultModel = null,
    waitCallback = false,
    retryLimit = QUEUE_RETRY_LIMIT,
    useDefaultRateLimiter = true,
    uniqueKeyGenerator = aiQueueToUnique,
  }) {
    // If no rate limiters provided and useDefaultRateLimiter is true, use the default high-limit rate limiter
    const effectiveRateLimiters = rateLimiters || (useDefaultRateLimiter ? {"default": defaultRateLimiter} : {});
    const effectiveDefaultModel = defaultModel || (useDefaultRateLimiter ? "default" : null);

    super({
      queueName,
      rateLimiters: effectiveRateLimiters,
      uniqueKeyGenerator,
      dispatchFunctionName: `launch${queueName.charAt(0).toUpperCase() + queueName.slice(1)}Queue`,
      defaultModel: effectiveDefaultModel,
    });

    if (typeof processFn !== "function") {
      throw new Error("processFn must be a function");
    }

    this.processFn = processFn;
    this.retryLimit = retryLimit;
    this.waitCallback = waitCallback;
    this.activeTasks = new Set(); // Track active tasks
  }

  /**
   * Process a single item from the queue using the provided function
   * @param {Object} params - The parameters object
   * @param {Object} params.entry - The queue entry to process
   * @return {Promise<Object>} The processing result
   */
  async processItem({entry}) {
    this.activeTasks.add({id: entry.id, batchId: entry.batchId});
    try {
      const result = await this.processFn(entry.params);
      const taskToRemove = Array.from(this.activeTasks).find((task) => task.id === entry.id);
      if (taskToRemove) this.activeTasks.delete(taskToRemove);
      return result;
    } catch (error) {
      const taskToRemove = Array.from(this.activeTasks).find((task) => task.id === entry.id);
      if (taskToRemove) this.activeTasks.delete(taskToRemove);
      throw error;
    }
  }

  /**
   * Wait for all active tasks to complete
   * @param {string} [batchId = null] - Optional batch ID to group related tasks
   * @return {Promise<void>}
   */
  async waitForCompletion({batchId = null}) {
    const getActiveTaskCount = () => {
      if (!batchId) return this.activeTasks.size;
      return Array.from(this.activeTasks).filter((task) => task.batchId === batchId).length;
    };

    while (getActiveTaskCount() > 0) {
      const count = getActiveTaskCount();
      logger.debug(`Waiting for ${count} tasks to complete in ${this.queueName} for batch ${batchId}`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  /**
   * Process the queue and wait for completion
   * @param {string} [batchId = null] - Optional batch ID to group related tasks
   * @return {Promise<void>}
   */
  async processQueueAndWait({batchId = null}) {
    await this.processQueue();
    await this.waitForCompletion({batchId});
  }
}

export {GenericQueue};
