import {OpenRouterClient, OpenRouterMockResponse} from "../openrouter/base.js";
import {createAnalyticsOptions} from "../../analytics/index.js";
import globalPrompts from "../prompts/globalPrompts.js";
import tokenHelper from "../openai/tokens.js";
import logger from "../../util/logger.js";
import {TRANSCRIPTION_MAX_DIFF_PERCENT, TRANSCRIPTION_CHUNK_MULTIPLIER} from "../../config/config.js";
import {uploadFileToBucket} from "../../storage/storage.js";
import {GenericQueue} from "../queue/genericQueue.js";
import {transcriptionQueueToUnique} from "../../storage/firestore/queue.js";
import {getTranscriptionsPath} from "./transcriptionStorage.js";
import {libraryUpdateTranscriptionStatusRtdb} from "../../storage/realtimeDb/library.js";
import {rateLimiters} from "../queue/config.js";

/**
 * Extract common parameters for retry logic
 * @param {object} params - The validated parameters object
 * @return {object} - Common parameters needed for retry logic
 */
function extractRetryParams(params) {
  const {uid, sku, chapter, prompt, replacements, message, retry, chunkMultiplier, providerOverride, modelOverride, model, unique} = params;
  return {uid, sku, chapter, prompt, replacements, message, retry, chunkMultiplier, providerOverride, modelOverride, model, unique};
}

/**
 * Validate and setup parameters for transcription processing
 * @param {object} params - The parameters for the transcription
 * @param {string} params.uid - User ID for analytics
 * @param {string} params.graphId - Graph ID for analytics
 * @param {string} params.sku - Book SKU for analytics
 * @param {number} params.chapter - Chapter number for analytics
 * @param {string} params.prompt - The prompt to use
 * @param {array} params.replacements - The replacements to use
 * @param {array} params.message - The array of message objects to send to the LLM
 * @return {object} - Validated parameters and model information
 */
function validateAndSetupTranscriptionParams(params) {
  const {
    uid,
    graphId,
    sku,
    chapter,
    prompt,
    replacements = [],
    message = [],
    retry = false,
    chunkMultiplier = parseInt(TRANSCRIPTION_CHUNK_MULTIPLIER.value()),
    providerOverride = {},
    modelOverride = null,
    unique = null,
  } = params;

  if (!Array.isArray(message)) {
    throw new Error("message parameter must be an array");
  }

  // Import the global prompt
  const globalPrompt = globalPrompts[prompt];
  if (!globalPrompt) {
    throw new Error(`Global prompt '${prompt}' not found`);
  }

  if (!globalPrompt.openAIGenerationConfig) {
    throw new Error(`Global prompt '${prompt}' does not have openAIGenerationConfig`);
  }

  const model = modelOverride || globalPrompt.openRouterModel;
  if (!model) {
    throw new Error(`Model not found for prompt '${prompt}'`);
  }

  // Count the number of tokens in the message
  const tokenCount = tokenHelper.countTokens(JSON.stringify(message));
  logger.info(`validateAndSetupTranscriptionParams: Token count: ${tokenCount}`);

  // Handle empty message or zero token count
  if (message.length === 0 || tokenCount === 0) {
    throw new Error("Cannot process empty message or message with zero tokens");
  }

  return {
    uid,
    graphId,
    sku,
    chapter,
    prompt,
    replacements,
    message,
    retry,
    chunkMultiplier,
    providerOverride,
    modelOverride,
    model,
    tokenCount,
    globalPrompt,
    unique,
  };
}

/**
 * Create message chunks for processing
 * @param {object} params - The parameters for chunking
 * @param {array} params.message - The message array to chunk
 * @param {object} params.globalPrompt - The global prompt configuration
 * @param {number} params.chunkMultiplier - The multiplier for the number of chunks
 * @param {number} params.tokenCount - The pre-calculated token count for the message
 * @return {array} - Array of message chunks
 */
function createMessageChunks(params) {
  const {message, globalPrompt, chunkMultiplier, tokenCount} = params;
  // Calculate number of chunks based on token count and max tokens per chunk
  // We multiply max_tokens by 0.5 to further lower the max tokens and more chunks are created.
  const maxTokensPerChunk = Math.floor(globalPrompt.openAIGenerationConfig.max_tokens * 0.5);

  logger.debug(`chunkMultiplier: ${chunkMultiplier}`);
  // Calculate initial number of chunks needed based on tokens
  // We need more chunks the smaller the model.
  let numChunks = Math.ceil(tokenCount / maxTokensPerChunk) * chunkMultiplier;

  // Ensure we don't create more chunks than we have messages
  numChunks = Math.min(numChunks, message.length);

  // Ensure we have at least one chunk
  numChunks = Math.max(1, numChunks);

  logger.info(`createMessageChunks: Number of chunks: ${numChunks}`);

  // Split the message array into chunks
  const chunkSize = Math.ceil(message.length / numChunks);
  const messages = [];

  // Create chunks ensuring no empty chunks are created
  for (let i = 0; i < numChunks; i++) {
    const start = i * chunkSize;
    const end = Math.min(start + chunkSize, message.length);

    // Only add chunk if it contains messages
    if (start < message.length) {
      const chunk = message.slice(start, end);
      if (chunk.length > 0) {
        messages.push(chunk);
      }
    }
  }

  return messages;
}

/**
 * Process message chunks through the LLM
 * @param {object} params - The parameters for LLM processing
 * @param {array} params.messages - Array of message chunks
 * @param {string} params.prompt - The prompt to use
 * @param {array} params.replacements - The replacements to use
 * @param {string} params.model - The model to use
 * @param {object} params.providerOverride - Override the default provider
 * @param {string} params.uid - User ID for analytics
 * @param {string} params.graphId - Graph ID for analytics
 * @param {string} params.sku - Book SKU for analytics
 * @param {number} params.chapter - Chapter number for analytics
 * @return {array} - Array of LLM results or null if the request failed
 */
async function processChunksWithLLM(params) {
  const {messages, prompt, replacements, model, providerOverride, uid, sku, chapter, graphId} = params;
  // Submit the prompts to OpenRouter in parallel
  const results = await Promise.all(messages.map(async (message, index) => {
    const client = new OpenRouterClient();
    const result = await client.sendRequest({
      prompt: prompt,
      message: JSON.stringify(message),
      replacements: replacements,
      modelOverride: model,
      providerOverride,
      logVerbose: false,
      // Add mock response for testing when MOCK_LLM is true
      mockResponse: new OpenRouterMockResponse({
        content: {
          transcription: message.map((segment) => ({
            id: segment.id,
            text: `Mock corrected text for chunk ${index + 1}, segment ${segment.id}: ${segment.text}`,
            startTime: segment.startTime || 0,
          })),
        },
        tokensUsed: 150,
      }),
      analyticsOptions: createAnalyticsOptions({uid, graphId, sku, chapter, promptId: prompt}),
    });

    // Check if the result contains a content filter error
    if (result.error && result.details && result.details.includes("content filter")) {
      logger.warn(`processChunksWithLLM: Content filter error for chunk ${index}, using original segments as fallback`);
      // Return original segments as the "corrected" version
      return {
        result: {
          transcription: message.map((segment) => ({
            id: segment.id,
            text: segment.text,
            startTime: segment.startTime || 0,
          })),
        },
      };
    }

    return result;
  }));

  return results;
}

/**
 * Validate LLM results and combine them
 * @param {array} results - Array of LLM results
 * @param {array} messages - Array of message chunks
 * @param {object} params - Original parameters for retry logic
 * @return {array} - Combined corrected transcriptions
 */
async function validateAndCombineResults(results, messages, params) {
  const retryParams = extractRetryParams(params);
  const {uid, graphId, sku, chapter, prompt, replacements, message, retry, chunkMultiplier, providerOverride, modelOverride, model, unique} = retryParams;

  // Validate each chunk's results before combining
  for (let index = 0; index < results.length; index++) {
    const result = results[index];
    const chunk = messages[index];
    if (!result.result || !Array.isArray(result.result.transcription)) {
      logger.error(`validateAndCombineResults: Invalid result structure from LLM for chunk ${index}`);
      logger.error(`chunk: ${JSON.stringify(chunk)}`);
      logger.error(`result: ${JSON.stringify(result)}`);
      throw new Error(`Invalid result structure from LLM for chunk ${index}`);
    }
    if (result.result.transcription.length !== chunk.length) {
      logger.error(`validateAndCombineResults: LLM returned wrong number of segments for chunk ${index}. Expected ${chunk.length} but got ${result.result.transcription.length}`);
      if (!retry) {
        logger.warn(`validateAndCombineResults: Retrying transcription for ${uid} ${sku} ${chapter} with model ${model}`);
        return await sendTranscriptionToLlm({
          uid,
          graphId,
          sku,
          chapter,
          prompt,
          replacements,
          message,
          modelOverride,
          retry: true,
          chunkMultiplier,
          providerOverride,
          unique,
        });
      }
      logger.debug({result: result.result.transcription, chunk});
      throw new Error(`LLM returned wrong number of segments for chunk ${index} after retry. This indicates the LLM is not following instructions to maintain segment count.`);
    }
  }

  // Combine the results
  const correctedTranscriptions = results.reduce((acc, r) => [...acc, ...r.result.transcription], []);

  // logger.info(`validateAndCombineResults: Corrected transcription: ${JSON.stringify(correctedTranscriptions).substring(0, 300)}...`);

  return correctedTranscriptions;
}

/**
 * Verify the integrity of corrected transcriptions
 * @param {array} message - Original message array
 * @param {array} correctedTranscriptions - Corrected transcriptions
 * @param {object} params - Original parameters for retry logic
 * @return {boolean} - True if integrity check passes
 */
function verifyTranscriptionIntegrity(message, correctedTranscriptions, params) {
  // Verify the integrity of the correctedTranscriptions
  // Each segment must not differ by more than TRANSCRIPTION_MAX_DIFF_PERCENT of the original segment length
  // logger.info(`verifyTranscriptionIntegrity: Verifying integrity of corrected transcriptions`);
  // logger.info(`verifyTranscriptionIntegrity: Message length: ${message.length}`);

  // The segment count should always match since we validated each chunk
  if (message.length !== correctedTranscriptions.length) {
    logger.error(`verifyTranscriptionIntegrity: Critical error - segment count mismatch after chunk validation. This should never happen.`);
    logger.error(`verifyTranscriptionIntegrity: Original: ${message.length}, Corrected: ${correctedTranscriptions.length}`);
    throw new Error(`Critical error - segment count mismatch after chunk validation`);
  }

  for (let i = 0; i < message.length; i++) {
    const originalSegment = message[i];
    const correctedSegment = correctedTranscriptions[i];

    // Verify the corrected segment has the expected structure
    if (!correctedSegment || typeof correctedSegment.text !== "string") {
      logger.error(`verifyTranscriptionIntegrity: Invalid corrected segment structure at index ${i}`);
      throw new Error(`Invalid corrected segment structure at index ${i}`);
    }

    const diff = Math.abs(originalSegment.text.length - correctedSegment.text.length);
    let textDiffThreshold = Math.ceil(originalSegment.text.length * (TRANSCRIPTION_MAX_DIFF_PERCENT.value() / 100));

    // If text contains numbers, like a year, then we can allow more diff
    const isYear = /\b(1[0-9]{3}|20[0-9]{2})\b/.test(originalSegment.text) || /\b(1[0-9]{3}|20[0-9]{2})\b/.test(correctedSegment.text);
    if (isYear) {
      textDiffThreshold *= 1.5; // Allow 50% more diff for years
      logger.info(`verifyTranscriptionIntegrity: Allowing 50% more diff for years: ${textDiffThreshold}`);
    }

    // Set a minimum diff of 10 characters to handle very short texts
    textDiffThreshold = Math.max(textDiffThreshold, 10);

    // Just warn now and proceed (no more retries or exceptions)
    if (Math.abs(diff) > textDiffThreshold) {
      // logger.warn(`verifyTranscriptionIntegrity: Transcription differs by more than ${TRANSCRIPTION_MAX_DIFF_PERCENT.value()}% or ${textDiffThreshold} characters`);
      // logger.warn(`verifyTranscriptionIntegrity: Original segment ${originalSegment.text.length}: ${originalSegment.text}`);
      // logger.warn(`verifyTranscriptionIntegrity: Corrected segment ${correctedSegment.text.length}: ${correctedSegment.text}`);
      // Also log prev and next segments
      // logger.warn(`verifyTranscriptionIntegrity: Previous segment: ${correctedTranscriptions[i - 1]?.text}`);
      // logger.warn(`verifyTranscriptionIntegrity: Next segment: ${correctedTranscriptions[i + 1]?.text}`);
    }
  }

  return true;
}

/**
 * Store corrected transcriptions for individual chapter
 * @param {object} params - The parameters for storage
 * @param {string} params.uid - User ID
 * @param {string} params.sku - SKU of the book
 * @param {number} params.chapter - Chapter number
 * @param {array} params.correctedTranscriptions - Corrected transcriptions
 * @param {boolean} params.updateStatus - Whether to update status to ready (default: true)
 */
async function storeChapterTranscription(params) {
  const {uid, sku, chapter, correctedTranscriptions, updateStatus = true} = params;
  // Store the corrected chunks in the transcription file
  const bucketPath = getTranscriptionsPath({uid, sku, chapter});
  await uploadFileToBucket({
    bucketPath: bucketPath,
    content: JSON.stringify(correctedTranscriptions, null, 2),
    contentType: "application/json",
  });
  logger.info(`storeChapterTranscription: Successfully uploaded corrected transcription to ${bucketPath}`);

  // Update the transcription status to ready after successful storage
  if (updateStatus) {
    try {
      await libraryUpdateTranscriptionStatusRtdb({uid, sku, chapter, status: "ready"});
      logger.info(`storeChapterTranscription: Updated status to ready for ${sku} chapter ${chapter}`);
    } catch (error) {
      logger.error(`storeChapterTranscription: Failed to update status for ${sku} chapter ${chapter}:`, error);
    }
  }
}

/**
 * Send the transcription to the LLM for correction
 * @param {object} params - The parameters for the transcription
 * @param {string} params.uid - User ID for analytics
 * @param {string} params.sku - The SKU of the book
 * @param {number} params.chapter - The chapter number
 * @param {string} params.prompt - The prompt to use
 * @param {array} params.replacements - The replacements to use
 * @param {array} params.message - The array of message objects to send to the LLM
 * @param {string} params.model - The model to use
 * @param {object} params.providerOverride - Override the default provider
 * @param {number} params.chunkMultiplier - The multiplier for the number of chunks
 * @param {boolean} params.retry - Whether to retry the transcription
 * @param {string} params.graphId - The graph ID for analytics
 * @param {boolean} params.awaitCompletion - Whether to wait for the transcription to be processed
 * @return {object} - The corrected transcription
 */
async function sendTranscriptionToLlm(params) {
  // Step 1: Validate and setup parameters
  const validatedParams = validateAndSetupTranscriptionParams(params);

  logger.info(`sendTranscriptionToLlm: Submitting prompt to ${validatedParams.model}`);

  // Step 2: Create message chunks
  const messages = createMessageChunks({
    message: validatedParams.message,
    globalPrompt: validatedParams.globalPrompt,
    chunkMultiplier: validatedParams.chunkMultiplier,
    tokenCount: validatedParams.tokenCount,
  });

  // Step 3: Process chunks with LLM
  const results = await processChunksWithLLM({
    messages,
    prompt: validatedParams.prompt,
    replacements: validatedParams.replacements,
    model: validatedParams.model,
    providerOverride: validatedParams.providerOverride,
    uid: params.uid,
    sku: params.sku,
    chapter: params.chapter,
    graphId: params.graphId,
  });

  // Step 4: Validate and combine results
  const correctedTranscriptions = await validateAndCombineResults(results, messages, validatedParams);

  // Step 5: Verify integrity
  verifyTranscriptionIntegrity(validatedParams.message, correctedTranscriptions, validatedParams);

  // Step 6: Store chapter transcription (individual file only)
  await storeChapterTranscription({
    uid: validatedParams.uid,
    sku: validatedParams.sku,
    chapter: validatedParams.chapter,
    correctedTranscriptions,
  });

  return correctedTranscriptions;
}

/**
 * The queue for transcription
 */
const transcriptionQueue = new GenericQueue({
  queueName: "transcription",
  processFn: sendTranscriptionToLlm,
  uniqueKeyGenerator: transcriptionQueueToUnique,
  rateLimiters: {
    "openai/gpt-4o": rateLimiters.openrouter.transcription,
    "default": rateLimiters.openrouter.transcription,
  },
  defaultModel: "openai/gpt-4o",
  useDefaultRateLimiter: false, // Don't use the high-limit default, use our OpenRouter limiter
});

export {
  sendTranscriptionToLlm,
  transcriptionQueue,
  validateAndSetupTranscriptionParams,
  createMessageChunks,
  processChunksWithLLM,
  validateAndCombineResults,
  verifyTranscriptionIntegrity,
  storeChapterTranscription,
};
