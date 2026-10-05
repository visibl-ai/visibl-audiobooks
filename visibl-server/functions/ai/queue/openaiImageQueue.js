/**
 * @fileoverview Queue for direct OpenAI image generation requests.
 */
/* eslint-disable require-jsdoc */

import {Readable} from "stream";
import AiQueue from "./aiQueue.js";
import {QUEUE_RETRY_LIMIT} from "./config.js";
import {
  OPENAI_IMAGE_DEFAULT_MODEL,
  queueEntryTypeToFunction,
} from "../openai/openaiImage.js";
import {runImagePostProcessing} from "../images/postProcessImage.js";
import logger from "../../util/logger.js";
import {moderateImagePrompt} from "../../util/imageHelper.js";
import {
  queueAddEntries,
  queueClaimPendingItems,
  queueUpdateEntries,
} from "../../storage/firestore/queue.js";
import {
  storeGraphCharacterImagesRtdb,
  storeGraphLocationImagesRtdb,
} from "../../storage/realtimeDb/graph.js";
import {uploadStreamToCloudflare} from "../../storage/cloudflare.js";
import {updateSceneImageUrl} from "../../storage/realtimeDb/scenesCache.js";

const OPENAI_IMAGE_MAX_CONCURRENCY = parseInt(
    process.env.OPENAI_IMAGE_MAX_CONCURRENCY || "50",
    10,
);

class OpenAiImageQueue extends AiQueue {
  constructor({maxConcurrency = OPENAI_IMAGE_MAX_CONCURRENCY} = {}) {
    super({
      queueName: "openaiImage",
      rateLimiters: {},
      uniqueKeyGenerator: openaiImageQueueToUnique,
      dispatchFunctionName: "launchOpenAiImageQueue",
      defaultModel: "default",
    });
    this.retryLimit = QUEUE_RETRY_LIMIT;
    this.maxConcurrency = maxConcurrency;
  }

  groupEntriesByModel({queue}) {
    return {default: queue};
  }

  async claimPendingItems({limit}) {
    return await queueClaimPendingItems({
      type: this.queueName,
      status: "pending",
      limit,
    });
  }

  async processQueue() {
    const inFlight = new Set();
    let processed = 0;

    for (;;) {
      const availableSlots = this.maxConcurrency - inFlight.size;
      if (availableSlots > 0) {
        const queue = await this.claimPendingItems({limit: availableSlots});

        for (const entry of queue) {
          const task = this.processQueueEntry({entry});
          inFlight.add(task);
          task.then(
              () => inFlight.delete(task),
              () => inFlight.delete(task),
          );
          processed++;
        }
      }

      if (inFlight.size === 0) {
        logger.debug(`${this.queueName}: Queue drained after processing ${processed} images`);
        return;
      }

      // Refill the pool as soon as any image finishes instead of waiting for
      // the entire group or an artificial minute boundary.
      await Promise.race(inFlight);
    }
  }

  async processItem({entry}) {
    const generateFn = queueEntryTypeToFunction(entry.entryType);
    const outputPath = entry.params.outputPath || entry.params.outputPathWithoutExtension + ".jpeg";
    const startedAt = Date.now();
    const result = await generateFn({
      prompt: entry.params.prompt,
      inputImageUrl: entry.params.inputImageUrl,
      model: entry.params.model || OPENAI_IMAGE_DEFAULT_MODEL,
      outputPath,
      outputFormat: entry.params.outputFormat || "jpeg",
      modelParams: entry.params.modelParams || {},
      onPartial: entry.params.type === "sceneImage" ? (buffer, index) => storeScenePartial({entry, outputPath, buffer, index, startedAt}) : undefined,
    });
    if (entry.params.nodeType === "character") {
      await storeGraphCharacterImagesRtdb({
        graphId: entry.params.graphId,
        characterImages: {[entry.params.nodeName]: result.cdnUrl},
      });
    } else if (entry.params.nodeType === "location") {
      await storeGraphLocationImagesRtdb({
        graphId: entry.params.graphId,
        locationImages: {[entry.params.nodeName]: result.cdnUrl},
      });
    } else {
      await runImagePostProcessing({entry, result});
    }
    return result;
  }

  /**
   * Check if an error is OpenAI rejecting the request on safety grounds.
   * GPT Image returns 400 with code "moderation_blocked" (DALL-E used
   * "content_policy_violation"); both say "rejected by the safety system".
   * Streamed requests can be rejected mid-stream, which the SDK raises without a status.
   * @param {Error} error - The error thrown by the OpenAI SDK
   * @return {boolean} Whether it's a content policy violation
   */
  isContentPolicyViolation(error) {
    // A rejection that arrives mid-stream (streamed images) has no HTTP status.
    if (error?.status !== undefined && error.status !== 400) return false;
    return error?.code === "moderation_blocked" ||
      error?.code === "content_policy_violation" ||
      /safety system/i.test(error?.message || "");
  }

  /**
   * Retry content policy violations with a moderated prompt as a new entry,
   * otherwise fall back to the standard retry logic.
   * @param {Object} params - The parameters object
   * @param {Object} params.entry - The failed queue entry
   * @param {Error} params.error - The error that caused the failure
   * @return {Promise<boolean|Object>} Whether retry was scheduled
   */
  async handleRetry({entry, error}) {
    if (this.isContentPolicyViolation(error) && (entry.retryCount || 0) < this.retryLimit) {
      logger.info(`Content policy violation for entry ${entry.id}, attempting moderation (retry ${entry.retryCount || 0}/${this.retryLimit})`);

      try {
        const params = entry.params;
        const identifier = params.identifier || entry.identifier;

        const moderatedPrompt = await moderateImagePrompt({
          prompt: params.prompt,
          context: identifier ? `Character: ${identifier}` : "",
          uid: params.uid,
          sku: params.sku,
          graphId: params.defaultSceneId,
        });

        const normalizedIdentifier = identifier ?
          identifier.toLowerCase().replace(/\s+/g, "_") :
          new Date().getTime().toString();
        const moderatedIdentifier = normalizedIdentifier + "_moderated";

        const uniqueKey = openaiImageQueueToUnique({
          type: entry.type,
          entryType: entry.entryType,
          graphId: params.graphId,
          identifier: moderatedIdentifier,
          chapter: params.chapter,
        });

        const queueResult = await queueAddEntries({
          types: [entry.type],
          entryTypes: [entry.entryType],
          entryParams: [{...params, prompt: moderatedPrompt, identifier: moderatedIdentifier}],
          uniques: [uniqueKey],
        });
        if (queueResult.success !== true) {
          throw new Error(`Failed to add moderated entry to queue: ${JSON.stringify(queueResult)}`);
        }

        // Carry the retry count over so a moderated prompt can't loop forever
        const newEntryId = queueResult.ids ? queueResult.ids[0] : uniqueKey;
        await queueUpdateEntries({
          ids: [newEntryId],
          statuses: ["pending"],
          retryCounts: [(entry.retryCount || 0) + 1],
        });

        await queueUpdateEntries({
          ids: [entry.id],
          statuses: ["error"],
          traces: [`Content policy violation - moderated version created as entry: ${uniqueKey}`],
        });

        logger.info(`Successfully created moderated entry ${uniqueKey} for original entry ${entry.id}`);
        // Truthy so processQueueEntry doesn't overwrite the trace above
        return {success: true};
      } catch (moderationError) {
        logger.error(`Failed to moderate prompt for entry ${entry.id}: ${moderationError.message}`);
      }
    }

    return super.handleRetry({entry, error});
  }

  validateEntry(entry) {
    if (!entry.params.prompt) {
      logger.warn("OpenAI image queue entry missing required field: prompt");
      return false;
    }
    if (!entry.params.outputPath && !entry.params.outputPathWithoutExtension) {
      logger.warn("OpenAI image queue entry missing required field: outputPath");
      return false;
    }
    if (entry.entryType === "edit" && !entry.params.inputImageUrl) {
      logger.warn("OpenAI image edit queue entry missing required field: inputImageUrl");
      return false;
    }
    return true;
  }
}

/**
 * Show a partial scene image until the final replaces it: upload it to Cloudflare only and point the
 * scene's RTDB image at it. imageGcp is cleared; the final sets both.
 * @param {Object} params - The parameters object
 * @param {Object} params.entry - The sceneImage queue entry
 * @param {string} params.outputPath - The final image path, used to name the partial
 * @param {Buffer} params.buffer - The partial image
 * @param {number} params.index - The partial image index
 * @param {number} params.startedAt - When the image request started, for timing logs
 * @return {Promise<void>}
 */
async function storeScenePartial({entry, outputPath, buffer, index, startedAt}) {
  const receivedMs = Date.now() - startedAt;
  const {defaultSceneId, styleId, styleTitle, chapter, sceneNumber} = entry.params;
  const imageUrl = await uploadStreamToCloudflare(Readable.from(buffer), `${outputPath}.partial${index}`);
  await updateSceneImageUrl({defaultSceneId, styleId, styleTitle, chapter, sceneNumber, imageUrl, imageGcpUrl: null});
  logger.info(`Stored partial ${index} for ${entry.id}: received at ${receivedMs}ms, in RTDB at ${Date.now() - startedAt}ms`);
}

function openaiImageQueueToUnique({type, entryType, graphId, identifier, chapter, retry = false}) {
  if (type === undefined || entryType === undefined || graphId === undefined ||
      identifier === undefined || chapter === undefined) {
    throw new Error("All parameters (type, entryType, graphId, identifier, chapter) must be defined");
  }
  return `${type}_${entryType}_${graphId}_${identifier}_ch${chapter}${retry ? "_retry" : ""}`;
}

const openaiImageQueue = new OpenAiImageQueue();

export {
  openaiImageQueue,
  OpenAiImageQueue,
  openaiImageQueueToUnique,
  OPENAI_IMAGE_MAX_CONCURRENCY,
};
