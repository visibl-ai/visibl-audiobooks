/* eslint-disable require-jsdoc */
import OpenAI from "openai";
import logger from "../../util/logger.js";
import globalPrompts from "../prompts/globalPrompts.js";
import {promptListFromParamsList, messagesFromPromptListAndTextList, flattenResults} from "../helpers.js";

import {OPENAI_API_KEY, MOCK_LLM} from "../../config/config.js";
import {batchDispatchOpenaiRequests} from "../queue/dispatcher.js";
import {mockApiCall, OpenAIMockResponse} from "./mock.js";

function instructionReplacements({instruction, replacements}) {
  if (replacements) {
    for (const replacement of replacements) {
      instruction = instruction.replaceAll(`%${replacement.key}%`, replacement.value);
    }
  }
  return instruction;
}

async function openaiLLMRequest(request) {
  // WARN: Does not correctly implement history!
  // eslint-disable-next-line no-unused-vars
  const {prompt, message, replacements, history = [], retry = true, instructionOverride, responseKey, modelOverride, promptOverride, mockResponse} = request;
  const globalPrompt = promptOverride || globalPrompts[prompt]; // Use promptOverride if provided, otherwise lookup

  if (!globalPrompt) {
    logger.error(`Prompt configuration not found for key: ${prompt}`);
    return {error: `Prompt configuration not found: ${prompt}`};
  }
  if (globalPrompt.responseSchema && typeof globalPrompt.responseSchema !== "object") {
    logger.error(`Prompt configuration for ${prompt} requires JSON but responseSchema is missing or invalid.`);
    return {error: `Missing or invalid responseSchema for prompt: ${prompt}`};
  }

  const openai = new OpenAI({apiKey: OPENAI_API_KEY.value()});

  let instruction = instructionReplacements({
    instruction: globalPrompt.systemInstruction,
    replacements,
  });
  if (instructionOverride) {
    instruction = instructionOverride;
  }
  const model = modelOverride || globalPrompt.openAIModel || "gpt-4o";
  const generationConfig = globalPrompt.openAIGenerationConfig;
  const wantsJson = globalPrompt.responseSchema ? true : false;

  logger.debug(`Sending request to OpenAI model ${model} via responses.create.`);
  logger.debug(`Instruction: ${instruction.substring(0, 600)}`);
  let result;

  // Check if we're in mock mode
  const mockValue = MOCK_LLM.value().toString().trim().toLowerCase();
  const isMockMode = ["true", "1", "yes", "y"].includes(mockValue);

  if (isMockMode && mockResponse) {
    // Convert plain object to OpenAIMockResponse instance if needed
    const mockResponseInstance = mockResponse instanceof OpenAIMockResponse ?
      mockResponse : new OpenAIMockResponse(mockResponse);
    result = await mockApiCall({model, instruction, message}, wantsJson, mockResponseInstance);
  } else if (isMockMode && !mockResponse) {
    throw new Error("Mock mode is enabled but no mockResponse provided. Please provide an OpenAIMockResponse instance or compatible object.");
  } else {
    try {
      const params = {
        model: model,
        instructions: instruction,
        input: message,
        temperature: generationConfig.temperature,
        max_output_tokens: generationConfig.max_tokens,
        top_p: generationConfig.top_p,
        service_tier: generationConfig.service_tier || "auto",
        store: generationConfig.store || false,
        truncation: generationConfig.truncation || "disabled",
      };

      if (wantsJson) {
      // in case the schema is edited by another request.
        const schema = JSON.parse(JSON.stringify(globalPrompt.responseSchema));
        // logger.debug("Schema:", schema);
        params.text = {
          format: {
            type: "json_schema",
            name: prompt,
            schema: schema,
          },
        };
      }

      result = await openai.responses.create(params);
    } catch (error) {
      logger.error("Error sending message to OpenAI via responses.create:", error);
      if (retry && (error.status === 429 || error.status >= 500)) {
        logger.warn(`OpenAI API error (${error.status}). Waiting 10 seconds before retrying.`);
        await new Promise((resolve) => setTimeout(resolve, 10000));
        request.retry = false;
        return await openaiLLMRequest(request);
      }
      return {error: "OpenAI API error", details: error.message || error.toString(), responseKey};
    }
  }

  const tokensUsed = result.usage?.total_tokens || 0;
  let responseText = "";

  try {
    responseText = result.output_text;

    logger.debug(`OpenAI response received.`);
    logger.debug(responseText.substring(0, 150));
  } catch (e) {
    logger.error("Error processing OpenAI response (output_text):", e);
    logger.debug("Full OpenAI Response object:", result);
    return {error: "Failed to process OpenAI response", details: e.message, responseKey};
  }

  if (wantsJson) {
    const parseResult = parseJsonSafely(responseText);
    if (parseResult.error) {
      logger.error("Error trying to parse result JSON from output_text.", parseResult.error);
      return {result: responseText, error: "JSON parsing error", details: parseResult.error, tokensUsed, responseKey};
    }
    return {result: parseResult.data, tokensUsed, responseKey};
  } else {
    return {result: responseText, tokensUsed, responseKey};
  }
}

function parseJsonSafely(text) {
  try {
    text = text.replace(/^```json\s*/, "").replace(/\s*```$/, "");
    text = text.replace(/\n/g, "");
    return {data: JSON.parse(text)};
  } catch (e) {
    logger.error("Error trying to parse result to JSON:", e);
    logger.debug("Original text for JSON parsing:", text);
    return {error: e.message, originalText: text};
  }
}

async function batchRequestMultiPromptOpenaiQueue(params) {
  const {responseKey, prompt, paramsList, textList} = params;
  // Generate the content for the prompt so we can calcualte tokens.
  const globalPrompt = globalPrompts[prompt];
  // const maxTokens = globalPrompt.openAIGenerationConfig.max_tokens;
  const promptList = promptListFromParamsList({paramsList, systemInstruction: globalPrompt.systemInstruction});
  const {messages} = messagesFromPromptListAndTextList({promptList, textList});
  const requests = [];
  for (let i = 0; i < messages.length; i++) {
    requests.push({
      model: globalPrompt.openAIModel || "gpt-4.1-mini",
      prompt: prompt,
      message: messages[i],
      responseKey: responseKey[i],
    });
  }
  const results = await batchDispatchOpenaiRequests({
    requests,
    model: globalPrompt.openAIModel || "gpt-4.1-mini",
    maxAttempts: 60,
    pollInterval: 1000,
  });
  // Map results by key, from object to array
  const resultsArray = Object.values(results);
  return flattenResults({results: resultsArray, responseKeys: responseKey});
}

export {
  batchRequestMultiPromptOpenaiQueue,
  openaiLLMRequest,
  promptListFromParamsList,
  messagesFromPromptListAndTextList,
};

