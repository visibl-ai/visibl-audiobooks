/*
 * AI Request Dispatcher
 * This module handles dispatching requests to both OpenAI and Gemini AI models
 * through their respective queuing systems.
 */

import {openaiQueue} from "./openaiQueue.js";
import {geminiQueue} from "./geminiQueue.js";
import {GoogleGenerativeAI} from "@google/generative-ai";
import {GEMINI_API_KEY} from "../../config/config.js";
import {queueGetEntries} from "../../storage/firestore/queue.js";
import tokenHelper from "../openai/tokens.js";
import logger from "../../util/logger.js";

/**
 * Generic request dispatcher for AI models
 * @param {Object} params - The parameters object
 * @param {string} params.provider - The AI provider ("openai" or "gemini")
 * @param {string} params.model - The specific model to use
 * @param {string} params.prompt - The prompt type from globalPrompts
 * @param {string} params.message - The actual message to send
 * @param {Array} [params.replacements=[]] - Any replacements for the prompt template
 * @param {Array} [params.history=[]] - Chat history if any
 * @param {string} [params.instructionOverride=null] - Override the default instruction
 * @param {string} [params.responseKey=null] - Optional response key
 * @param {number} [params.estimatedTokens=1000] - Default token estimate
 * @return {Promise<Object>} The response from the AI model
 */
async function dispatchRequest(params) {
  const {
    provider, // "openai" or "gemini"
    model, // The specific model to use
    prompt, // The prompt type from globalPrompts
    message, // The actual message to send
    replacements = [], // Any replacements for the prompt template
    history = [], // Chat history if any
    instructionOverride = null, // Override the default instruction
    responseKey = null, // Optional response key
    estimatedTokens = 1000, // Default token estimate
  } = params;

  if (provider !== "openai" && provider !== "gemini") {
    throw new Error(`Invalid AI provider: ${provider}. Must be "openai" or "gemini"`);
  }

  // Select the appropriate queue based on provider
  const queue = provider === "openai" ? openaiQueue : geminiQueue;

  // Construct queue parameters
  const queueParams = {
    entryType: prompt,
    prompt,
    message,
    replacements,
    history,
    instructionOverride,
    responseKey,
  };

  // Add Gemini-specific parameter if needed
  if (provider === "gemini") {
    queueParams.type = "application/json"; // Default to JSON, will be overridden by prompt config if needed
  }

  // Add request to queue
  const queueResult = await queue.addToQueue({
    model,
    params: queueParams,
    estimatedTokens,
    retry: false,
  });

  if (!queueResult.success) {
    throw new Error(`Failed to add request to ${provider} queue`);
  }

  // Process queue immediately
  queue.processQueue();

  // Poll for completion
  let result;
  let entry;
  let attempts = 0;
  const maxAttempts = 30; // 30 seconds timeout
  const pollInterval = 1000; // 1 second between checks

  const queueId = queueResult.ids[0];
  while (!result && attempts < maxAttempts) {
    attempts++;

    const entries = await queueGetEntries({
      type: provider,
      id: queueId,
      limit: 1,
    });

    if (entries.length === 0) {
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
      continue;
    }

    entry = entries[0];
    if (entry.status === "complete") {
      result = await getResult({result: entry.result, queue});
      // we have a result lets delete the params now.
      await queue.deleteParams({queueEntry: entry});
      break;
    }

    if (entry.status === "error") {
      throw new Error(`Task failed: ${entry.trace || "Unknown error"}`);
    }

    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  if (!result) {
    throw new Error("Queue processing timed out");
  }

  return {result, tokensUsed: entry.tokensUsed};
}

/**
 * Helper function to get result, handling GCS stored results
 * @param {Object} options - Options for getting the result
 * @param {Object} options.result - The result object from the queue
 * @param {Object} options.queue - The queue instance
 * @return {Promise<Object>} The final result
 */
async function getResult({result, queue}) {
  const resultObj = result.result;
  // Handle both OpenAI and Gemini result formats
  if (resultObj && (resultObj.resultGcsPath || (resultObj.result && resultObj.result.resultGcsPath))) {
    const path = resultObj.resultGcsPath || resultObj.result.resultGcsPath;
    return queue.getAndDeleteResult({resultGcsPath: path});
  }
  return result;
}

/**
 * Dispatches an OpenAI request to the queue
 * @param {Object} params - The parameters object
 * @param {string} params.model - The specific OpenAI model to use
 * @param {string} params.prompt - The prompt type from globalPrompts
 * @param {string} params.message - The actual message to send
 * @param {Array} [params.replacements=[]] - Any replacements for the prompt template
 * @param {Array} [params.history=[]] - Chat history if any
 * @param {string} [params.instructionOverride=null] - Override the default instruction
 * @param {string} [params.responseKey=null] - Optional response key
 * @param {number} [params.estimatedTokens=1000] - Default token estimate
 * @param {string} [params.modelOverride=null] - Override the default model
 * @return {Promise<Object>} The response from the OpenAI model
 */
async function dispatchOpenaiRequest(params) {
  return dispatchRequest({
    provider: "openai",
    ...params,
  });
}

/**
 * Dispatches a Gemini request to the queue
 * @param {Object} params - The parameters object
 * @param {string} params.model - The specific Gemini model to use
 * @param {string} params.prompt - The prompt type from globalPrompts
 * @param {string} params.message - The actual message to send
 * @param {Array} [params.replacements=[]] - Any replacements for the prompt template
 * @param {Array} [params.history=[]] - Chat history if any
 * @param {string} [params.instructionOverride=null] - Override the default instruction
 * @param {string} [params.responseKey=null] - Optional response key
 * @param {number} [params.estimatedTokens=1000] - Default token estimate
 * @param {string} [params.modelOverride=null] - Override the default model
 * @return {Promise<Object>} The response from the Gemini model
 */
async function dispatchGeminiRequest(params) {
  return dispatchRequest({
    provider: "gemini",
    ...params,
  });
}

/**
 * Dispatches multiple AI requests in a batch and efficiently polls for their completion
 * @param {Object} params - The parameters object
 * @param {Array} params.requests - Array of request objects, each containing model, prompt, message, etc.
 * @param {string} params.provider - The AI provider ("openai" or "gemini")
 * @param {string} params.model - Default model to use if not specified in individual requests
 * @param {number} [params.maxAttempts=60] - Maximum number of polling attempts before timeout
 * @param {number} [params.pollInterval=1000] - Milliseconds between polling attempts
 * @param {number} [params.defaultEstimatedTokens=1000] - Default token estimate for each request
 * @return {Promise<Object>} - Map of responseKey to results
 */
async function batchDispatchRequests(params) {
  const {
    requests,
    provider, // "openai" or "gemini"
    model,
    maxAttempts = 60,
    pollInterval = 1000,
    defaultEstimatedTokens = 1000,
  } = params;

  if (provider !== "openai" && provider !== "gemini") {
    throw new Error(`Invalid AI provider: ${provider}. Must be "openai" or "gemini"`);
  }

  // Select the appropriate queue based on provider
  const queue = provider === "openai" ? openaiQueue : geminiQueue;

  // Step 1: Prepare all tasks for batch addition to the queue
  const entryParams = [];
  const queueEntryToKey = {}; // Map to track which queue entry corresponds to which response key

  // Process each request in the batch
  for (let i = 0; i < requests.length; i++) {
    const request = requests[i];
    const requestModel = request.model || model;
    const responseKey = request.responseKey || i.toString();

    // Prepare the queue parameters
    const queueParams = {
      model: requestModel,
      modelOverride: requestModel, // Add modelOverride for OpenAI
      entryType: request.prompt,
      prompt: request.prompt,
      message: request.message,
      replacements: request.replacements || [],
      history: request.history || [],
      instructionOverride: request.instructionOverride || null,
      responseKey: responseKey,
      promptOverride: request.promptOverride || null,
      mockResponse: request.mockResponse || null,
      analyticsOptions: request.analyticsOptions || null,
    };

    // Add Gemini-specific parameter if needed
    if (provider === "gemini") {
      queueParams.type = "application/json"; // Default to JSON, will be overridden by prompt config if needed
    }

    // Prepare queue entry
    const queueEntry = {
      type: provider,
      model: requestModel,
      params: queueParams,
      estimatedTokens: request.estimatedTokens || defaultEstimatedTokens,
      retry: request.retry || false,
      status: "pending",
      timeRequested: Date.now(),
      timeUpdated: Date.now(),
    };
    entryParams.push(queueEntry);
  }

  logger.debug(`Adding ${entryParams.length} entries to the ${provider} queue`);
  // Add all entries to the queue in one batch operation
  const queueResult = await queue.addToQueueBatch({
    entries: entryParams,
  });

  // Get the IDs of the added entries
  const queueEntryIds = queueResult.success ? queueResult.ids : [];

  // Map queue IDs to response keys
  for (let i = 0; i < queueEntryIds.length; i++) {
    const request = requests[i];
    const responseKey = request.responseKey || i.toString();
    queueEntryToKey[queueEntryIds[i]] = responseKey;
  }

  // Trigger queue processing
  await queue.processQueue();

  // Step 2: Poll for completion of all tasks
  const processedResults = {};

  logger.debug(`Waiting for ${queueEntryIds.length} tasks to complete`);
  let allComplete = false;
  let attempts = 0;

  while (!allComplete && attempts < maxAttempts) {
    attempts++;

    // Check status of all queue entries
    let incompleteCount = 0;
    let errorCount = 0;

    // Get all pending entries in one query
    const pendingIds = queueEntryIds.filter((id) => !processedResults[queueEntryToKey[id]]);
    if (pendingIds.length === 0) {
      allComplete = true;
      continue;
    }

    // Get all entries in batches to avoid query size limits
    const BATCH_SIZE = 10;
    for (let i = 0; i < pendingIds.length; i += BATCH_SIZE) {
      const batchIds = pendingIds.slice(i, i + BATCH_SIZE);

      // Get entries for this batch
      for (const id of batchIds) {
        const entries = await queueGetEntries({
          type: provider,
          id: id,
          limit: 1,
        });

        if (entries.length === 0) {
          incompleteCount++;
          continue;
        }

        const entry = entries[0];
        const key = queueEntryToKey[id] || id;

        if (entry.status === "complete" && entry.result) {
          // Get result and handle GCS stored results if needed
          let result = entry.result;
          if (result.result && result.result.resultGcsPath) {
            result = await queue.getAndDeleteResult({resultGcsPath: result.result.resultGcsPath});
          }
          processedResults[key] = result;
          // Delete params to clean up
          await queue.deleteParams({queueEntry: entry});
        } else if (entry.status === "error") {
          logger.error(`Task ${id} failed: ${entry.trace || "Unknown error"}`);
          errorCount++;
        } else {
          // Still in progress
          incompleteCount++;
        }
      }
    }

    // Check if all tasks are complete
    if (incompleteCount === 0 && Object.keys(processedResults).length + errorCount === queueEntryIds.length) {
      allComplete = true;
      logger.debug(`All tasks complete. Got ${Object.keys(processedResults).length} results, ${errorCount} errors`);
    } else {
      logger.debug(`Waiting for ${incompleteCount} tasks to complete, attempt ${attempts}/${maxAttempts}`);
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }
  }

  if (!allComplete) {
    logger.warn(`Timeout waiting for tasks to complete. Got ${Object.keys(processedResults).length} of ${queueEntryIds.length} results`);
  }

  return processedResults;
}

/**
 * Dispatches multiple OpenAI requests in a batch and efficiently polls for their completion
 * @param {Object} params - The parameters object
 * @param {Array} params.requests - Array of request objects, each containing model, prompt, message, etc.
 * @param {string} params.model - Default model to use if not specified in individual requests
 * @param {number} [params.maxAttempts=60] - Maximum number of polling attempts before timeout
 * @param {number} [params.pollInterval=1000] - Milliseconds between polling attempts
 * @param {number} [params.defaultEstimatedTokens=1000] - Default token estimate for each request
 * @return {Promise<Object>} - Map of responseKey to results
 */
async function batchDispatchOpenaiRequests(params) {
  params.requests.forEach((request) => {
    request.estimatedTokens = tokenHelper.countTokens(JSON.stringify(request.message));
  });
  logger.debug(`Batch dispatching ${params.requests.length} OpenAI requests with estimated tokens: ${params.requests.map((r) => r.estimatedTokens).join(", ")}`);
  return batchDispatchRequests({
    provider: "openai",
    model: params.model || "gpt-4o",
    ...params,
  });
}

/**
 * Dispatches multiple Gemini requests in a batch and efficiently polls for their completion
 * @param {Object} params - The parameters object
 * @param {Array} params.requests - Array of request objects, each containing model, prompt, message, etc.
 * @param {string} params.model - Default model to use if not specified in individual requests
 * @param {number} [params.maxAttempts=60] - Maximum number of polling attempts before timeout
 * @param {number} [params.pollInterval=1000] - Milliseconds between polling attempts
 * @param {number} [params.defaultEstimatedTokens=1000] - Default token estimate for each request
 * @return {Promise<Object>} - Map of responseKey to results
 */
async function batchDispatchGeminiRequests(params) {
  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY.value());
  const model = genAI.getGenerativeModel({model: params.model || "gemini-1.5-pro"});
  await Promise.all(params.requests.map(async (request) => {
    request.estimatedTokens = await model.countTokens(request.message);
  }));
  logger.debug(`Batch dispatching ${params.requests.length} Gemini requests with estimated tokens: ${params.requests.map((r) => r.estimatedTokens).join(", ")}`);
  return batchDispatchRequests({
    provider: "gemini",
    model: params.model || "gemini-1.5-pro",
    ...params,
  });
}

export {
  dispatchRequest,
  dispatchOpenaiRequest,
  dispatchGeminiRequest,
  batchDispatchOpenaiRequests,
  batchDispatchGeminiRequests,
  batchDispatchRequests,
};
