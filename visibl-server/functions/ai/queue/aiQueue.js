/* eslint-disable require-jsdoc */
import logger from "../../util/logger.js";
import {
  queueAddEntries,
  queueGetEntries,
  queueSetItemsToError,
  queueUpdateEntries,
  queueClaimPendingItems,
  batchCreate,
  batchGetStatus,
  batchUpdateStatusBulk,
} from "../../storage/firestore/queue.js";
import {
  storeJsonFile,
  getJsonFile,
  deleteFile,
} from "../../storage/storage.js";
import {dispatchTask} from "../../util/dispatch.js";
import {FBDB_STORAGE_THRESHOLD, QUEUE_BATCH_LIMIT, QUEUE_RETRY_LIMIT} from "./config.js";
import handleSceneImagePostProcessing from "../../storage/realtimeDb/hooks/handleSceneImagePostProcessing.js";
import handleCharacterImagePostProcessing from "../../storage/realtimeDb/hooks/handleCharacterImagePostProcessing.js";
import handleLocationImagePostProcessing from "../../storage/realtimeDb/hooks/handleLocationImagePostProcessing.js";

export default class AiQueue {
  constructor({queueName, rateLimiters, uniqueKeyGenerator, dispatchFunctionName = null, defaultModel = null}) {
    this.queueName = queueName;
    this.rateLimiters = rateLimiters || {}; // Map of model name to rate limiter
    this.uniqueKeyGenerator = uniqueKeyGenerator;
    this.dispatchFunctionName = dispatchFunctionName || `${queueName}Queue`;
    this.defaultModel = defaultModel;
    this.retryLimit = QUEUE_RETRY_LIMIT;
    this.waitCallback = false;
  }

  /**
   * Stores large parameters in Google Cloud Storage (GCS) if they exceed the size threshold
   * @param {Object} params - The parameters object
   * @param {Object} params.taskParams - The task parameters to potentially store in GCS
   * @return {Promise<string|null>} GCS path reference if stored, null if under threshold
   */
  async storeLargeParams({taskParams}) {
    const paramsStr = JSON.stringify(taskParams);
    const threshold = parseInt(FBDB_STORAGE_THRESHOLD.value(), 10);
    if (paramsStr.length > threshold) {
      const path = `queue/params/${Date.now()}_${Math.random().toString(36).substring(7)}.json`;
      await storeJsonFile({
        filename: path,
        data: taskParams,
        metadata: {
          customTime: new Date().toISOString(),
        },
      });
      return path;
    }
    return null;
  }

  /**
   * Stores large results in Google Cloud Storage (GCS) if they exceed the size threshold
   * @param {Object} params - The parameters object
   * @param {Object} params.result - The result data to potentially store in GCS
   * @return {Promise<string|null>} GCS path reference if stored, null if under threshold
   */
  async storeLargeResult({result}) {
    const resultStr = JSON.stringify(result);
    const threshold = parseInt(FBDB_STORAGE_THRESHOLD.value(), 10);
    if (resultStr.length > threshold) {
      const path = `queue/results/${Date.now()}_${Math.random().toString(36).substring(7)}.json`;
      await storeJsonFile({
        filename: path,
        data: result,
        metadata: {
          customTime: new Date().toISOString(),
        },
      });
      return path;
    }
    return null;
  }

  /**
   * Retrieves params from GCS if needed
   * @param {Object} params - The parameters object
   * @param {Object} params.queueEntry - The queue entry
   * @return {Promise<Object>} - The complete params object
   */
  async getParams({queueEntry}) {
    if (queueEntry?.params?.paramsGcsPath) {
      return await getJsonFile({filename: queueEntry.params.paramsGcsPath});
    }
    return queueEntry.params?.params || queueEntry.params;
  }

  /**
   * Deletes the params file
   * @param {Object} queueEntry - The queue entry
   * @return {Promise<Object>} - The complete params object
   */
  async deleteParams({queueEntry}) {
    if (queueEntry?.params?.paramsGcsPath) {
      // Delete the file after retrieving it
      await deleteFile({path: queueEntry.params.paramsGcsPath});
    }
  }

  /**
   * Retrieves params from GCS and then deletes the file
   * @param {Object} queueEntry - The queue entry
   * @return {Promise<Object>} - The complete params object
   */
  async getAndDeleteResult({resultGcsPath}) {
    const result = await getJsonFile({filename: resultGcsPath});
    // Delete the file after retrieving it
    await deleteFile({path: resultGcsPath});
    return result;
  }

  /**
   * Process a single item from the queue
   * @param {Object} params - The parameters object
   * @param {Object} params.entry - The queue entry to process
   * @return {Promise<void>}
   */
  async processItem({entry}) {
    throw new Error("processItem must be implemented by subclass");
  }


  /**
   * Handle retry logic for a failed item
   * @param {Object} params - The parameters object
   * @param {Object} params.entry - The failed queue entry
   * @param {Error} params.error - The error that caused the failure
   * @return {Promise<void>}
   */
  async handleRetry({entry, error}) {
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

  /**
   * Groups queue entries by their model type
   * @param {Object} params - The parameters object
   * @param {Array} params.queue - Array of queue entries
   * @return {Object} Entries grouped by model type
   */
  groupEntriesByModel({queue}) {
    return queue.reduce((acc, entry) => {
      const modelType = entry.params.model;
      if (!acc[modelType]) acc[modelType] = [];
      acc[modelType].push(entry);
      return acc;
    }, {});
  }

  /**
   * Builds an optimal batch of entries that fits within rate limits
   * @param {Object} params - The parameters object
   * @param {Array} params.entries - Array of queue entries for a model
   * @param {Object} params.limiter - Rate limiter for the model
   * @param {Object} params.available - Available capacity {requests, tokens}
   * @return {Object} Batch info {batch, batchTokens, batchRequests}
   */
  buildOptimalBatch({entries, limiter, available}) {
    const batch = [];
    let batchTokens = 0;
    let batchRequests = 0;

    for (const entry of entries) {
      const entryTokens = entry.estimatedTokens || 0;

      if (batchRequests + 1 > available.requests ||
          batchTokens + entryTokens > available.tokens) {
        break;
      }

      batch.push(entry);
      batchTokens += entryTokens;
      batchRequests++;
    }

    return {batch, batchTokens, batchRequests};
  }

  /**
   * Processes a single queue entry
   * @param {Object} params - The parameters object
   * @param {Object} params.entry - Queue entry to process
   * @return {Promise} Processing result with status
   */
  async processQueueEntry({entry}) {
    try {
      const params = await this.getParams({queueEntry: entry});
      logger.debug(`Processing queue entry ${entry.id}`);

      const result = await this.processItem({entry: {...entry, params}});

      // Wrap result in an object if not in expected format
      const resultObj = result?.result ? result : {result};

      // Store the result in GCS if it's large (configurable)
      if (resultObj.result) {
        const resultGcsPath = await this.storeLargeResult({result: resultObj.result});
        if (resultGcsPath) {
          resultObj.result = {resultGcsPath};
        }
      }

      // Record rate limit usage if token usage is available
      if (resultObj.tokensUsed) {
        const modelType = entry.params.model || this.defaultModel;
        const limiter = this.rateLimiters[modelType] || this.rateLimiters[this.defaultModel];

        if (limiter) {
          await limiter.recordUsage({tokens: resultObj.tokensUsed});
          logger.debug(`Recorded ${resultObj.tokensUsed} tokens usage for model ${modelType} (entry ${entry.id})`);
        } else {
          logger.warn(`No rate limiter found for model ${modelType}, unable to record token usage`);
        }
      }

      // Mark the entry as complete and update the result.
      // Keep the entry at processing if a callback is needed.
      const finalStatus = this.waitCallback ? "processing" : "complete";
      logger.debug(`Updating entry ${entry.id} to ${finalStatus}`);
      await queueUpdateEntries({
        ids: [entry.id],
        queue: [entry],
        results: [resultObj],
        statuses: [finalStatus],
        tokensUsed: [resultObj.tokensUsed || 0],
      });

      // Handle post-processing for specific entry types
      if (entry.params?.type === "sceneImage") {
        await handleSceneImagePostProcessing(entry, resultObj);
      } else if (entry.params?.type === "character" || entry.params?.type === "character-profile") {
        await handleCharacterImagePostProcessing(entry, resultObj);
      } else if (entry.params?.type === "location") {
        await handleLocationImagePostProcessing(entry, resultObj);
      }

      // Return success status for batch-level tracking
      return {success: true, status: finalStatus};
    } catch (error) {
      const errorMessage = error.message || "Unknown error";
      logger.error(`Error processing ${this.queueName} queue entry ${entry.id}: ${errorMessage}`);

      // Special handling for deadline exceeded errors
      if (errorMessage.includes("DEADLINE_EXCEEDED")) {
        logger.warn(`Deadline exceeded for entry ${entry.id}, immediate retry scheduling`);
      }

      if (!(await this.handleRetry({entry, error}))) {
        await queueSetItemsToError({queue: [entry]});
        // Return error status for batch-level tracking
        return {success: false, status: "error"};
      }
      // Return retry status for batch-level tracking
      return {success: false, status: "retry"};
    }
  }

  /**
   * Processes a batch of entries for a specific model
   * @param {Object} params - The parameters object
   * @param {string} params.modelType - Type of model
   * @param {Array} params.entries - Array of queue entries
   * @return {Promise} Processing result
   */
  async processModelBatch({modelType, entries}) {
    const limiter = this.rateLimiters[modelType] || this.rateLimiters[this.defaultModel];
    if (!limiter) {
      logger.error(`No rate limiter found for model: ${modelType}`);
      await queueSetItemsToError({queue: entries, error: "No rate limiter found"});
      return;
    }

    const usage = await limiter.getUsage();
    const available = {
      requests: limiter.maxRequests - usage.currentRequests,
      tokens: limiter.maxTokens - usage.currentUsage,
    };

    if (available.requests <= 0 || available.tokens <= 0) {
      logger.debug(`Rate limits exceeded for ${modelType}. Waiting for next window...`);
      // Reset items back to pending since we can't process them now
      await queueUpdateEntries({
        ids: entries.map((e) => e.id),
        statuses: Array(entries.length).fill("pending"),
      });
      return;
    }

    const {batch, batchTokens, batchRequests} = this.buildOptimalBatch({
      entries,
      limiter,
      available,
    });

    if (batch.length === 0) {
      logger.debug(`No capacity available for ${modelType} batch`);
      // Reset items back to pending since we can't process them now
      await queueUpdateEntries({
        ids: entries.map((e) => e.id),
        statuses: Array(entries.length).fill("pending"),
      });
      return;
    }

    // If we can't process all entries, reset the ones we won't process back to pending
    if (batch.length < entries.length) {
      const unprocessedEntries = entries.slice(batch.length);
      await queueUpdateEntries({
        ids: unprocessedEntries.map((e) => e.id),
        statuses: Array(unprocessedEntries.length).fill("pending"),
      });
    }

    logger.debug(`Processing batch of ${batch.length} items for ${modelType} ` +
                `(tokens: ${batchTokens}/${available.tokens}, ` +
                `requests: ${batchRequests}/${available.requests})`);

    // Group entries by batchId for batch-level tracking
    const entriesByBatchId = {};
    const unbatchedEntries = [];

    for (const entry of batch) {
      if (entry.params.batchId) {
        if (!entriesByBatchId[entry.params.batchId]) {
          entriesByBatchId[entry.params.batchId] = [];
        }
        entriesByBatchId[entry.params.batchId].push(entry);
      } else {
        unbatchedEntries.push(entry);
      }
    }

    // Set all unique batches to processing status once using bulk updates
    const uniqueBatchIds = Object.keys(entriesByBatchId);
    if (uniqueBatchIds.length > 0) {
      logger.debug(`Setting ${uniqueBatchIds.length} batches to processing status`);
      // Update each batch with the number of processing items
      await Promise.all(uniqueBatchIds.map((batchId) => {
        const processingCount = entriesByBatchId[batchId].length;
        return this.updateBatchStatusBulk({
          batchId,
          processingDelta: processingCount,
          completedDelta: 0,
          errorDelta: 0,
        });
      }));
    }

    // Process all entries and collect results
    const results = await Promise.all(batch.map((entry) =>
      this.processQueueEntry({entry}),
    ));

    // Update batch statuses based on aggregated results
    for (const [batchId, batchEntries] of Object.entries(entriesByBatchId)) {
      const batchResults = batchEntries.map((entry) => {
        const entryIndex = batch.indexOf(entry);
        return results[entryIndex];
      });

      const completedCount = batchResults.filter((r) => r.status === "complete" || r.status === "processing").length;
      const errorCount = batchResults.filter((r) => r.status === "error").length;

      // Update batch status with aggregated counts
      logger.debug(`Updating batch ${batchId}: ${completedCount} completed, ${errorCount} errors`);

      // Use a single bulk update for the batch
      await this.updateBatchStatusBulk({
        batchId,
        completedDelta: completedCount,
        errorDelta: errorCount,
      });
    }

    // Log processing of unbatched entries if any
    if (unbatchedEntries.length > 0) {
      logger.debug(`Processed ${unbatchedEntries.length} unbatched entries`);
    }
  }

  /**
   * Main queue processor for LLM tasks
   * @return {Promise<void>} A promise that resolves when the queue processing is complete
   */
  async processQueue() {
    try {
      // Atomically claim pending items from queue to prevent race conditions
      const queue = await queueClaimPendingItems({
        type: this.queueName,
        status: "pending",
        limit: QUEUE_BATCH_LIMIT, // Get more than we might process to allow for optimal batching
      });

      if (queue.length === 0) {
        logger.debug(`${this.queueName}: No items in the queue`);
        return;
      }

      logger.info(`${this.queueName}: Successfully claimed ${queue.length} items for processing`);

      // Process each model group
      const itemsByModel = this.groupEntriesByModel({queue});
      await Promise.all(
          Object.entries(itemsByModel).map(([modelType, entries]) =>
            this.processModelBatch({modelType, entries}),
          ),
      );

      // Check for more items and continue processing
      const remainingQueue = await queueGetEntries({
        type: this.queueName,
        status: "pending",
        limit: 1,
      });

      if (remainingQueue.length > 0) {
        await this.processQueue();
      }
    } catch (error) {
      logger.error(`Error in processQueue for ${this.queueName}: ${error.message}`);
      // Schedule a new attempt to process the queue
      await dispatchTask({functionName: this.dispatchFunctionName, data: {}});
    }
  }

  /**
   * Adds a new task to the queue
   * @param {Object} options - Task parameters
   * @param {string} options.model - The AI model to use
   * @param {Object} options.params - The task parameters
   * @param {number} options.estimatedTokens - Estimated token count
   * @param {boolean} options.retry - Whether this is a retry attempt
   * @return {Promise<Object>} A promise that resolves with the result of adding the task
   */
  async addToQueue({model, params, estimatedTokens, retry = false}) {
    if (!params.model) {
      params.model = model;
    }
    // Store large params in GCS if needed
    const paramsGcsPath = await this.storeLargeParams({taskParams: params});

    const queueEntry = {
      type: this.queueName,
      model: model,
      params: paramsGcsPath ? {paramsGcsPath} : params,
      paramsGcsPath,
      estimatedTokens,
      retry,
      status: "pending",
      timeRequested: Date.now(),
      timeUpdated: Date.now(),
    };

    // Remove large params from params object
    const safeParams = Object.fromEntries(Object.entries(params).filter(([, value]) => {
      return JSON.stringify(value).length <= 100;
    }));

    const result = await queueAddEntries({
      types: [this.queueName],
      entryTypes: [params.entryType],
      entryParams: [queueEntry],
      uniques: [params.uniqueKey || this.uniqueKeyGenerator({
        type: this.queueName,
        model: model,
        entryType: params.entryType,
        taskParams: safeParams,
        retry,
      })],
    });

    // Dispatch task
    logger.debug(`Dispatching task ${this.dispatchFunctionName}`);
    await dispatchTask({functionName: this.dispatchFunctionName, data: {}});

    return result;
  }

  /**
   * Generates a unique batch ID
   * @return {string} Unique batch identifier
   */
  generateBatchId() {
    return `batch_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
  }

  /**
   * Creates a batch tracking record in Firestore
   * @param {Object} params - Batch parameters
   * @param {string} params.batchId - Unique batch identifier
   * @param {number} params.totalItems - Total number of items in batch
   * @param {string} params.webhookUrl - Optional webhook URL for completion notification
   * @param {Object} params.metadata - Optional metadata for the batch
   * @return {Promise<Object>} Created batch record
   */
  async createBatchRecord({batchId, totalItems, webhookUrl, metadata = {}}) {
    return batchCreate({
      batchId,
      queueName: this.queueName,
      totalItems,
      webhookUrl,
      metadata,
    });
  }

  /**
   * Gets the status of a batch
   * @param {string} batchId - Batch identifier
   * @return {Promise<Object|null>} Batch status or null if not found
   */
  async getBatchStatus(batchId) {
    const batchData = await batchGetStatus(batchId);

    if (!batchData) {
      return null;
    }

    // Calculate completion percentage
    const completionPercentage = batchData.totalItems > 0 ?
      Math.round(((batchData.completedItems + batchData.failedItems) / batchData.totalItems) * 100) :
      0;

    return {
      id: batchId,
      ...batchData,
      completionPercentage,
      isComplete: batchData.status === "complete",
    };
  }

  /**
   * Updates batch status with bulk counts to minimize transactions
   * @param {Object} params - Update parameters
   * @param {string} params.batchId - Batch identifier
   * @param {number} params.completedDelta - Number of completed items to add
   * @param {number} params.errorDelta - Number of error items to add
   * @param {number} params.processingDelta - Number of processing items to add
   * @return {Promise<Object|null>} Updated batch data
   */
  async updateBatchStatusBulk({batchId, completedDelta = 0, errorDelta = 0, processingDelta = 0}) {
    const result = await batchUpdateStatusBulk({
      batchId,
      completedDelta,
      errorDelta,
      processingDelta,
    });

    if (!result) {
      return null;
    }

    // Trigger webhook outside of transaction if needed
    if (result.shouldTriggerWebhook && result.webhookUrl) {
      await this.triggerBatchWebhook(result.updatedBatch);
    }

    return result.updatedBatch;
  }

  /**
   * Triggers webhook notification for batch completion
   * @param {Object} batchData - Batch data to send
   * @return {Promise<void>}
   */
  async triggerBatchWebhook(batchData) {
    if (!batchData.webhookUrl) return;

    try {
      logger.debug(`Triggering webhook for batch ${batchData.batchId}: ${batchData.webhookUrl}`);

      const response = await fetch(batchData.webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          batchId: batchData.batchId,
          status: batchData.status,
          totalItems: batchData.totalItems,
          completedItems: batchData.completedItems,
          failedItems: batchData.failedItems,
          metadata: batchData.metadata,
          completedAt: batchData.completedAt,
        }),
      });

      if (!response.ok) {
        logger.error(`Webhook failed for batch ${batchData.batchId}: ${response.status}`);
      }
    } catch (error) {
      logger.error(`Error triggering webhook for batch ${batchData.batchId}: ${error.message}`);
    }
  }

  async addToQueueBatch({entries, batchId = null, webhookUrl = null, dispatch = true, metadata = {}}) {
    // Generate batch ID if not provided
    if (!batchId) {
      batchId = this.generateBatchId();
    }

    // Create batch record
    await this.createBatchRecord({
      batchId,
      totalItems: entries.length,
      webhookUrl,
      metadata,
    });

    // Store large params in GCS if needed
    const paramsGcsPaths = await Promise.all(entries.map((entry) => this.storeLargeParams({taskParams: entry.params})));

    // Add batchId to each entry
    const entriesWithBatch = entries.map((originalEntry, index) => ({
      ...originalEntry,
      batchId,
      paramsGcsPath: paramsGcsPaths[index],
      params: paramsGcsPaths[index] ? {
        paramsGcsPath: paramsGcsPaths[index],
        entryType: originalEntry.params.entryType, // Preserve entryType for queue processing
        model: originalEntry.params.model || originalEntry.model, // Preserve model for unique key generation
        retry: originalEntry.params.retry || false, // Preserve retry for unique key generation, default to false
      } : originalEntry.params,
    }));

    const result = await queueAddEntries({
      types: entriesWithBatch.map((entry) => this.queueName),
      entryTypes: entriesWithBatch.map((entry) => entry.params.entryType),
      entryParams: entriesWithBatch,
      uniques: entriesWithBatch.map((entry) => this.uniqueKeyGenerator({
        type: this.queueName,
        model: entry.params.model || entry.model,
        entryType: entry.params.entryType,
        taskParams: entry.params,
        referenceKey: entry.referenceKey,
        retry: entry.params.retry || false,
      })),
    });

    if (dispatch) {
      // Dispatch task to process the queue (by default)
      logger.debug(`Dispatching task ${this.dispatchFunctionName} for batch ${batchId}`);
      await dispatchTask({functionName: this.dispatchFunctionName, data: {}});
    }

    return {
      ...result,
      batchId,
    };
  }

  /**
   * Wait for a batch to complete with progress tracking
   * @param {Object} params - The parameters object
   * @param {string} params.batchId - The batch ID to wait for
   * @param {number} [params.maxWaitTime=300000] - Maximum time to wait in milliseconds (default: 5 minutes)
   * @param {number} [params.pollInterval=1000] - Time between status checks in milliseconds (default: 1 second)
   * @param {Function} [params.onProgress] - Optional callback called with batch status on each check
   * @return {Promise<Object>} The final batch status
   */
  async waitForBatchCompletion({batchId, maxWaitTime = 300000, pollInterval = 1000, onProgress = null}) {
    const maxAttempts = Math.floor(maxWaitTime / pollInterval);
    let batchStatus = null;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      batchStatus = await this.getBatchStatus(batchId);

      if (batchStatus) {
        // Call progress callback if provided (but not too frequently)
        if (onProgress && attempt % 5 === 0) {
          await onProgress(batchStatus);
        }

        if (batchStatus.status === "complete") {
          logger.info(`Batch ${batchId} completed successfully`);
          return batchStatus;
        }
      }

      // Wait before next check
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }

    // Timeout reached
    logger.error(`Batch ${batchId} did not complete within ${maxWaitTime}ms`);
    throw new Error(`Batch ${batchId} timed out after ${maxWaitTime}ms`);
  }

  /**
   * Add entries to queue as a batch, process them, and wait for completion
   * @param {Object} params - The parameters object
   * @param {Array} params.entries - Array of queue entries
   * @param {string} [params.batchId] - Optional batch ID (will be generated if not provided)
   * @param {string} [params.webhookUrl] - Optional webhook URL to call when batch completes
   * @param {Object} [params.metadata] - Optional metadata to store with the batch
   * @param {number} [params.maxWaitTime=300000] - Maximum time to wait for completion
   * @param {number} [params.pollInterval=1000] - Time between status checks
   * @param {Function} [params.onProgress] - Optional progress callback
   * @return {Promise<Object>} Object containing batchId and status
   */
  async addToQueueBatchAndWait(params) {
    const {
      entries,
      batchId: providedBatchId,
      webhookUrl,
      metadata,
      maxWaitTime = 300000,
      pollInterval = 1000,
      onProgress = null,
    } = params;

    // Add batch to queue but do not dispatch task to process the queue
    // To run the queue on the current instance and take advantage of the local audio files
    const queueResult = await this.addToQueueBatch({
      entries,
      batchId: providedBatchId,
      webhookUrl,
      metadata,
      dispatch: false,
    });

    const {batchId} = queueResult;

    // Process queue
    await this.processQueue();

    // Wait for completion
    const batchStatus = await this.waitForBatchCompletion({
      batchId,
      maxWaitTime,
      pollInterval,
      onProgress,
    });

    return {
      batchId,
      status: batchStatus,
    };
  }
}
