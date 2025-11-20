/**
 * @fileoverview Groq-specific implementation of AiQueue
 * Handles Whisper transcription requests with rate limiting
 */

import AiQueue from "./aiQueue.js";
import {rateLimiters, QUEUE_RETRY_LIMIT} from "./config.js";
import {aiQueueToUnique, queueUpdateEntries} from "../../storage/firestore/queue.js";
import logger from "../../util/logger.js";
import whisper from "../groq/whisper.js";
import {downloadFileFromBucket} from "../../storage/storage.js";
import {deleteLocalFiles} from "../../storage/storage.js";
import {flushAnalytics} from "../../analytics/index.js";

/**
 * Queue implementation for Groq Whisper transcription requests
 * Handles rate limiting, batching, and retry logic specific to Groq
 */
class GroqQueue extends AiQueue {
  /**
   * Creates a new GroqQueue instance
   * Configures queue with Groq-specific settings including rate limits and model defaults
   */
  constructor() {
    // Get Groq rate limiters from config
    const groqRateLimiters = rateLimiters.groq || {};

    super({
      queueName: "groq",
      rateLimiters: groqRateLimiters,
      uniqueKeyGenerator: aiQueueToUnique,
      dispatchFunctionName: "launchGroqQueue",
      defaultModel: "whisper-large-v3-turbo",
    });

    // Set retry limit
    this.retryLimit = QUEUE_RETRY_LIMIT;
  }

  /**
   * Process a single item from the queue using Groq's Whisper API
   * @param {Object} params - The parameters for the Groq Whisper request
   * @return {Promise<Object>} The response from Groq Whisper
   */
  async processItem({entry}) {
    const {audioPath, offset, prompt} = entry.params;
    const fs = await import("fs");

    let localPath = audioPath;
    let downloadedFile = false;

    // Check if audioPath is a bucket path (doesn't start with ./ or /)
    if (!audioPath.startsWith("./") && !audioPath.startsWith("/")) {
      // Extract filename from bucket path
      const fileName = audioPath.split("/").pop();
      const localBinPath = `./bin/${fileName}`;

      // Check if file exists in local bin directory first
      if (fs.existsSync(localBinPath)) {
        logger.debug(`Using existing local file: ${localBinPath}`);
        localPath = localBinPath;
      } else {
        // File not in local bin, download from bucket to temp directory
        localPath = `./bin/temp_${Date.now()}_${fileName}`;

        logger.debug(`Downloading audio file from bucket: ${audioPath} to ${localPath}`);
        await downloadFileFromBucket({bucketPath: audioPath, localPath});
        downloadedFile = true;
      }
    }

    try {
      // Create a file stream from the local path
      const stream = fs.createReadStream(localPath);

      // Call whisperTranscribe with the appropriate parameters
      const uid = entry.params?.uid || "admin";
      const transcription = await whisper.whisperTranscribe({
        stream,
        offset: offset || 0,
        prompt: prompt || "",
        chapter: audioPath,
        retry: 0, // Don't use internal retry since we handle it at queue level
        distinctId: uid,
        traceId: entry.id,
        sku: entry.params?.sku || "unknown",
        uid: uid,
        posthogGroups: {
          sku: entry.params?.sku || "unknown",
          uid: uid,
        },
      });

      // Check for errors in transcription
      if (transcription.error) {
        throw new Error(transcription.error);
      }

      return {
        result: transcription,
        // Estimate tokens used for transcription (approximate)
        tokensUsed: Math.ceil((transcription.length || 0) * 0.25),
      };
    } finally {
      // Flush PostHog events to ensure they're sent after each transcription
      await flushAnalytics().catch((err) => {
        logger.debug(`PostHog flush warning: ${err.message}`);
      });

      // Clean up downloaded temp file if we created one
      if (downloadedFile) {
        logger.debug(`Cleaning up temp file: ${localPath}`);
        await deleteLocalFiles([localPath]).catch((err) => {
          logger.warn(`Failed to delete temp file ${localPath}: ${err.message}`);
        });
      }
    }
  }

  /**
   * Handle retry logic for failed requests
   * Implements exponential backoff for Groq API failures
   * @param {Object} params - The parameters object
   * @param {Object} params.entry - The failed queue entry
   * @return {Promise<boolean>} Whether the retry was scheduled successfully
   */
  async handleRetry({entry, error}) {
    logger.debug(`handleRetry for entry ${entry.id}: ${entry.retryCount || 0} / ${this.retryLimit}`);

    // Check if we should retry
    if ((entry.retryCount || 0) < this.retryLimit) {
      logger.debug(`Attempting retry for entry ${entry.id}`);

      // Calculate exponential backoff delay
      const backoffDelay = Math.min(
          1000 * Math.pow(2, entry.retryCount || 0), // Exponential backoff starting at 1 second
          60000, // Max 1 minute delay for Groq
      );

      logger.debug(`Scheduling retry for entry ${entry.id} with backoff ${backoffDelay}ms`);

      // Update the retry count and status
      const newRetryCount = (entry.retryCount || 0) + 1;
      return await queueUpdateEntries({
        ids: [entry.id],
        statuses: ["pending"],
        retryCounts: [newRetryCount],
      });
    }

    logger.error(`Max retries exceeded for entry ${entry.id}: ${error.message}`);
    return false;
  }
}

// Create singleton instance
const groqQueue = new GroqQueue();

export {groqQueue, GroqQueue};
