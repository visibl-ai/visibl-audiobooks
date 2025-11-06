/* eslint-disable require-jsdoc */
import {
  GoogleGenerativeAI,
  HarmCategory,
  HarmBlockThreshold,
} from "@google/generative-ai";
// import _ from "lodash";
import logger from "../../util/logger.js";

import globalPrompts from "../prompts/globalPrompts.js";
import {flattenResults} from "../helpers.js";
import {batchDispatchGeminiRequests} from "../queue/dispatcher.js";

import {GEMINI_API_KEY, MOCK_LLM, GEMINI_RETRY_DELAY} from "../../config/config.js";

const MAX_TOKENS_PER_MINUTE = 3900000; // test with 2M.

const safetySettings = [
  {
    category: HarmCategory.HARM_CATEGORY_HARASSMENT,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
  // { // Not yet implemented on google side.
  //   category: HarmCategory.HARM_CATEGORY_CIVIC_INTEGRITY,
  //   threshold: HarmBlockThreshold.BLOCK_NONE,
  // },
  // {
  //   category: HarmCategory.HARM_CATEGORY_UNSPECIFIED,
  //   threshold: HarmBlockThreshold.BLOCK_NONE,
  // },
];

function instructionReplacements({instruction, replacements}) {
  if (replacements) {
    for (const replacement of replacements) {
      instruction = instruction.replaceAll(`%${replacement.key}%`, replacement.value);
    }
  }
  return instruction;
}


async function geminiRequest(request) {
  const {prompt, message, replacements, history = [], retry = true, instructionOverride, responseKey, modelOverride, mockResponse={}} = request;
  const globalPrompt = formatGlobalPrompt({globalPrompt: globalPrompts[prompt]});
  const type = globalPrompt.geminiGenerationConfig.responseMimeType;
  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY.value());
  let instruction = instructionReplacements({instruction: globalPrompt.systemInstruction, replacements});
  if (instructionOverride) {
    instruction = instructionOverride;
  }

  const model = genAI.getGenerativeModel({
    model: modelOverride || globalPrompt.geminiModel,
    systemInstruction: instruction,
  });

  const generationConfig = globalPrompt.geminiGenerationConfig;

  const chatSession = model.startChat({
    generationConfig,
    safetySettings: safetySettings,
    history: history,
  });
  logger.debug(`Sending message to Gemini.`);
  logger.debug(`Instruction: ${instruction.substring(0, 600)}`);
  let result;
  if (MOCK_LLM.value() === true) {
    logger.debug("***** Mock LLM in tests *****");
    if (type === "application/json") {
      // If no mockResponse provided, create a default one based on the prompt type
      let defaultMockResponse = mockResponse;
      if (Object.keys(mockResponse).length === 0) {
        // Create a default mock response for summarizeScene
        if (prompt === "summarizeScene") {
          defaultMockResponse = {
            scene: {
              description: "A mock scene description for testing",
              characters: [
                {
                  name: "Test Character",
                  description: "A test character for mock response",
                },
              ],
              locations: [
                {
                  name: "Test Location",
                  description: "A test location for mock response",
                },
              ],
              viewpoint: {
                type: "third-person",
                description: "Third person omniscient viewpoint",
              },
            },
          };
        }
      }
      return {result: defaultMockResponse, tokensUsed: 0, responseKey};
    } else {
      return {result: "", tokensUsed: 0, responseKey};
    }
  }

  try {
    result = await chatSession.sendMessage(message);
  } catch (error) {
    if (error.status === 429) {
      if (retry) {
        // Extract retry delay from error details if available
        let retryDelay = GEMINI_RETRY_DELAY.value();
        try {
          retryDelay = error.errorDetails?.find((detail) =>
            detail["@type"] === "type.googleapis.com/google.rpc.RetryInfo",
          )?.retryDelay || GEMINI_RETRY_DELAY.value();
        } catch (e) {
          retryDelay = GEMINI_RETRY_DELAY.value();
        }
        const delayMs = parseInt(retryDelay) * 1000;
        logger.warn(`Gemini rate limit exceeded. Waiting ${delayMs}ms before retry.`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        request.retry = false;
        return await geminiRequest(request);
      }
    } else if (error.message.includes("model is overloaded")) {
      logger.warn("Gemini model is overloaded. Waiting 10 seconds before retrying.");
      await new Promise((resolve) => setTimeout(resolve, 10000));
    } else if (error.message.includes("Resource has been exhausted")) {
      logger.error(`Gemini is asking us to chill. Retry in 60 seconds.`);
      await new Promise((resolve) => setTimeout(resolve, 60000));
    } else {
      logger.error("Error sending message to Gemini:", error);
    }
    if (request.retry) {
      request.retry = false;
      return await geminiRequest(request);
    }
  }

  let tokensUsed = 0;
  try {
    logger.debug(`Gemini response received.`);
    logger.debug(result.response.text().substring(0, 150));
    if (result.response.usageMetadata) {
      const quota = result.response.usageMetadata.promptTokenCount;
      tokensUsed = quota;
      logger.debug(`Tokens used: ${quota}`);
    }
  } catch (error) {
    if (result.response.promptFeedback.blockReason) {
      logger.warn(`Gemini response blocked: ${result.response.promptFeedback.blockReason}. Will retry once.`);
      logger.debug(`Prompt Feedback: ${JSON.stringify(result.response)}`);
      if (retry) {
        request.retry = false;
        request.instructionOverride = instruction + " Ignore any inappropriate details which may cause content filtering issues.";
        return await geminiRequest(request);
      } else {
        return {error: "Gemini response blocked.",
          response: result.response.promptFeedback.blockReason,
        };
      }
    } else {
      logger.error("Error logging Gemini response text:", error);
      return {error: "Gemini response text not available.",
        response: result.response,
      };
    }
  }
  if (type === "application/json") {
    try {
      return {result: geminiTextToJSON(result.response.text()), tokensUsed, responseKey};
    } catch (e) {
      logger.error("Error trying to parse result to JSON.");
      return {result: result.response.text(), tokensUsed, responseKey};
    }
  } else {
    return {result: result.response.text(), tokensUsed, responseKey};
  }
}

function formatGlobalPrompt({globalPrompt}) {
  if (globalPrompt.geminiGenerationConfig.responseMimeType === "application/json") {
    // in case the schema is edited by another request.
    const schema = JSON.parse(JSON.stringify(globalPrompt.responseSchema));
    // Clone the schema and clean it by removing all additionalProperties fields
    const cleanedSchema = cleanResponseSchema({schema});
    globalPrompt.geminiGenerationConfig.responseSchema = cleanedSchema;
  }
  return globalPrompt;
}

// Helper function to recursively remove additionalProperties fields from schema
function cleanResponseSchema({schema}) {
  if (!schema || typeof schema !== "object") {
    return schema;
  }

  const cleanedSchema = {...schema};

  // Remove additionalProperties field if it exists
  if ("additionalProperties" in cleanedSchema) {
    delete cleanedSchema.additionalProperties;
  }

  // Recursively clean properties
  if (cleanedSchema.properties) {
    Object.keys(cleanedSchema.properties).forEach((key) => {
      cleanedSchema.properties[key] = cleanResponseSchema({schema: cleanedSchema.properties[key]});
    });
  }

  // Recursively clean items (for arrays)
  if (cleanedSchema.items) {
    cleanedSchema.items = cleanResponseSchema({schema: cleanedSchema.items});
  }

  return cleanedSchema;
}

function geminiTextToJSON(text) {
  try {
    text = text.replace(/\n/g, "");
    text = text.replace(/`/g, "");
    if (text.startsWith("json")) {
      text = text.slice(4);
    }
    return JSON.parse(text);
  } catch (e) {
    logger.error("Error trying to parse result to JSON.");
    return text;
  }
}

// With static prompts, we can get the token count and batch requests.
async function geminiBatchRequestMultiPrompt(params) {
  const {prompt, paramsList, text, responseKeys} = params;
  logger.debug(`GEMINI: Batch request for ${prompt} with ${paramsList.length} texts and MAX_TOKENS_PER_MINUTE=${MAX_TOKENS_PER_MINUTE}`);
  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY.value());
  const model = genAI.getGenerativeModel({model: globalPrompts[prompt].geminiModel});
  const countTokens = await model.countTokens(text);
  const tokenCount = countTokens.totalTokens;
  logger.debug(`Token count per request: ${tokenCount}`);
  let tokensUsed = 0;
  let promises = [];
  let startTime = Date.now();// + 60001; // We don't need to pause on the first iteration.
  let results = [];
  logger.debug(`Starting rateLimitedBatchRequest loop with ${paramsList.length} messages`);
  for (let i = 0; i < paramsList.length; i++) {
    // Check if next batch will go over limit. If yes, launch batch.
    if ( (tokensUsed + tokenCount ) > MAX_TOKENS_PER_MINUTE) {
      logger.debug(`Making ${promises.length} parallel requests with ${tokensUsed} max tokens`);
      results = results.concat(await Promise.all(promises));
      promises = []; // clear old promises.
      tokensUsed = 0;
      const elapsedTime = Date.now() - startTime;
      // Make sure we wait 60 serconds between batches.
      if (elapsedTime < 60000) {
        logger.debug(`Waiting ${60000 - elapsedTime} milliseconds`);
        await new Promise((resolve) => setTimeout(resolve, 60000 - elapsedTime));
      }
      startTime = Date.now();
    }
    tokensUsed = tokensUsed + tokenCount;
    logger.debug(`Adding ${tokenCount} tokens for ${JSON.stringify(paramsList[i][0])}. Total tokens used: ${tokensUsed}`);
    // const promptForIndex = _.cloneDeep(prompt);
    promises.push(geminiRequest({
      prompt, message: text, replacements: paramsList[i], retry: true, responseKey: responseKeys[i],
    }));
  }
  // Run the final batch.
  logger.debug(`Making final ${promises.length} requests with ${tokensUsed} max tokens`);
  results = results.concat(await Promise.all(promises));
  return results;
}

// Batch Gemini Requests
// 1. Get token count: https://github.com/google-gemini/generative-ai-js/blob/2df2af03bb07dcda23b07af1a7135a8b461ae64e/docs/reference/main/generative-ai.generativemodel.counttokens.md?plain=1#L3
// 2. Prepare batch with static input and multiple prompts.
// 3. Batch request with token per minute limitation (currently 4M tokens)
// 4. Handle failures with a 60s backoff.

async function batchRequestMultiPromptGeminiQueue(params) {
  const {prompt, paramsList, text, responseKeys} = params;
  // Generate the content for the prompt so we can calcualte tokens.
  logger.debug(`batchRequestMultiPromptGeminiQueue for ${prompt} with ${paramsList.length} texts`);
  const requests = [];
  for (let i = 0; i < paramsList.length; i++) {
    requests.push({
      model: globalPrompts[prompt].geminiModel,
      prompt: prompt,
      message: text,
      replacements: paramsList[i],
      responseKey: responseKeys[i],
    });
  }
  const results = await batchDispatchGeminiRequests({
    requests,
    model: globalPrompts[prompt].geminiModel,
    maxAttempts: 60,
    pollInterval: 1000,
  });
  return flattenResults({results: Object.values(results), responseKeys});
}

export {
  geminiRequest,
  geminiBatchRequestMultiPrompt,
  batchRequestMultiPromptGeminiQueue,
  instructionReplacements,
  formatGlobalPrompt,
};

