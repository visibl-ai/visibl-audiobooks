/* eslint-disable require-jsdoc */
import OpenAI from "openai";
import prompts from "./prompts.js";
import logger from "../../util/logger.js";
import tokenHelper from "./tokens.js";
import {OPENAI_API_KEY} from "../../config/config.js";
import globalPrompts from "../prompts/globalPrompts.js";
import _ from "lodash";

const DEFAULT_TEMP = 0.1;
const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_MODEL = "gpt-4-1106-preview";


async function defaultCompletion(params) {
  const {messages,
    temperature = DEFAULT_TEMP,
    format = "json_object",
    model = DEFAULT_MODEL,
    maxTokens = DEFAULT_MAX_TOKENS,
    retry = true,
  } = params;
  logger.debug(`OpenAI request with ${tokenHelper.countTokens(JSON.stringify(messages))} prompt tokens`);
  const openai = new OpenAI(OPENAI_API_KEY.value());
  let completion; let raw;
  try {
    const response = await openai.chat.completions.create({
      messages: messages,
      model: model,
      response_format: {type: format},
      temperature: temperature,
      max_tokens: maxTokens,
    }).withResponse();
    completion = response.data;
    raw = response.response;
  } catch (error) {
    logger.error(`Error creating OpenAI completion: ${error.message}`);
    if (retry) {
      logger.error(`Content filter triggered on request. Will retry once.`);
      params.retry = false;
      return await defaultCompletion(params);
    } else {
      if (format === "json_object") return {};
      else return "";
    }
  }
  if (completion.choices[0].finish_reason === "content_filter") {
    if (retry) {
      logger.error(`Content filter triggered on request. Will retry once.`);
      params.retry = false;
      return await defaultCompletion(params);
    } else {
      if (format === "json_object") return {};
      else return "";
    }
  }
  if (format === "json_object") {
    return parseJsonFromOpenAIResponse(completion, raw);
  } else {
    return completion.choices[0].message.content;
  }
}

async function globalCompletion({
  messages,
  prompt,
  retry = true,
}) {
  logger.debug(`OpenAI request with ${tokenHelper.countTokens(JSON.stringify(messages))} prompt tokens`);
  const openai = new OpenAI(OPENAI_API_KEY.value());
  let completion; let raw;
  try {
    const response = await openai.chat.completions.create({
      ...prompt.openAIGenerationConfig,
      messages: messages,
      model: prompt.openAIModel,
    }).withResponse();
    completion = response.data;
    raw = response.response;
  } catch (error) {
    logger.error(`Error creating OpenAI completion: ${error.message}`);
    if (retry) {
      logger.error(`Content filter triggered on request. Will retry once.`);
      return await globalCompletion({messages, prompt, retry: false});
    } else {
      if (prompt.openAIGenerationConfig.response_format.type === "json_schema") return {};
      else return "";
    }
  }
  if (completion.choices[0].finish_reason === "content_filter") {
    if (retry) {
      logger.error(`Content filter triggered on request. Will retry once.`);
      return await globalCompletion({messages, prompt, retry: false});
    } else {
      if (prompt.openAIGenerationConfig.response_format.type === "json_schema") return {};
      else return "";
    }
  }
  if (prompt.openAIGenerationConfig.response_format.type === "json_schema") {
    return parseJsonFromOpenAIResponse(completion, raw);
  } else {
    return completion.choices[0].message.content;
  }
}


function parseJsonFromOpenAIResponse(completion, raw) {
  let response;
  if (!completion) {
    logger.error(`Completion is null`);
    logger.error(JSON.stringify(completion, null, 2));
    throw new Error("Completion is null");
  }
  if (!completion.choices || !completion.choices[0]) {
    logger.error(`No choices in completion`);
    logger.error(JSON.stringify(completion, null, 2));
    throw new Error("No choices in completion");
  }
  if (completion.choices[0].finish_reason !== "stop") {
    logger.error(`Unexpected finish reason: ${completion.choices[0].finish_reason}`);
    logger.error(JSON.stringify(completion, null, 2));
    throw new Error(`Unexpected finish reason: ${completion.choices[0].finish_reason}`);
  }
  if (!completion.choices[0].message || !completion.choices[0].message.content) {
    logger.error(`No content in completion message`);
    logger.error(JSON.stringify(completion, null, 2));
    throw new Error("No content in completion message");
  }
  try {
    response = JSON.parse(completion.choices[0].message.content);
  } catch (error) {
    logger.error(`Non JSON response received. Try again.`);
    logger.error(completion?.choices[0]?.message?.content);
    // throw new Error("Non JSON response received. Try again.");
    return completion.choices[0].message.content;
  }
  logger.debug(`OpenAI tokens used: ${completion.usage.total_tokens} remaining tokens: ${raw.headers.get("x-ratelimit-remaining-tokens")}`);
  return response;
}

function flattenResults({results, responseKey}) {
  const flattenedResults = {};
  results.forEach((result, index) => {
    flattenedResults[responseKey[index]] = result;
  });
  return flattenedResults;
}


const nerFunctions = {
  characters: async (characterList, text) => {
    const messages = [
      {
        role: "system",
        content: prompts.ner_characters_prompt.replace(
            "%CHARACTERS_LIST%",
            JSON.stringify(characterList, null, 2),
        ),
      },
      {role: "user", content: JSON.stringify(text)},
    ];
    return await defaultCompletion({messages});
  },
  locations: async (locationsList, text) => {
    const messages = [
      {
        role: "system",
        content: prompts.ner_locations_prompt.replace(
            "%LOCATIONS_LIST%",
            JSON.stringify(locationsList, null, 2),
        ),
      },
      {role: "user", content: JSON.stringify(text)},
    ];
    return await (messages);
  },
  characterProperties: async (characters, properties, text) => {
    const messages = [
      {
        role: "system",
        content: prompts.ner_characters_props_prompt.replace(
            "%CHARACTERS_LIST%",
            JSON.stringify(characters, null, 2),
        ).replace(
            "%CHARACTER_PROPERTIES%",
            JSON.stringify(properties, null, 2)),
      },
      {role: "user", content: JSON.stringify(text, null, 2)},
    ];
    return await defaultCompletion({messages});
  },
  dedupLocations: async (locations) => {
    const messages = [
      {
        role: "system",
        content: prompts.ner_locations_prompt_dedup,
      },
      {role: "user", content: JSON.stringify(locations, null, 2)},
    ];
    return await defaultCompletion({messages});
  },
  dedupLocationsWithText: async (locations, text) => {
    const messages = [
      {
        role: "system",
        content: prompts.ner_locations_prompt_dedup_with_text.replace(
            "%LOCATIONS_LIST%",
            JSON.stringify(locations, null, 2),
        ),
      },
      {role: "user", content: text},
    ];
    return await defaultCompletion({messages});
  },
  locationProperties: async (locations, properties, text) => {
    const messages = [
      {
        role: "system",
        content: prompts.ner_locations_props_prompt.replace(
            "%LOCATIONS_LIST%",
            JSON.stringify(locations, null, 2),
        ).replace(
            "%LOCATION_PROPERTIES%",
            JSON.stringify(properties, null, 2)),
      },
      {role: "user", content: JSON.stringify(text, null, 2)},
    ];
    return await defaultCompletion({messages});
  },
  characterDescriptions: async (character, characterGraphResponse) => {
    const messages = [
      {
        role: "system",
        content: prompts.character_image_prompt.replace(
            "%CHARACTER%",
            character,
        ).replace(
            "%GRAPH_RESPONSE%",
            JSON.stringify(characterGraphResponse, null, 2)),
      },
      {role: "user", content: JSON.stringify("", null, 2)},
    ];
    return await defaultCompletion({messages});
  },
  locationDescriptions: async (location, locationGraphResponse) => {
    const messages = [
      {
        role: "system",
        content: prompts.location_image_prompt.replace(
            "%CHARACTER%",
            location,
        ).replace(
            "%GRAPH_RESPONSE%",
            JSON.stringify(locationGraphResponse, null, 2)),
      },
      {role: "user", content: JSON.stringify("", null, 2)},
    ];
    return await defaultCompletion({messages});
  },
  filmDirector: async (charactersList, locationsList, jsonText) => {
    const messages = [
      {
        role: "system",
        content: prompts.transcribe_film_director_prompt.replace(
            "%CHARACTER_LIST%",
            JSON.stringify(charactersList, null, 2),
        ).replace(
            "%LOCATIONS_LIST%",
            JSON.stringify(locationsList, null, 2),
        ),
      },
      {role: "user", content: JSON.stringify(jsonText, null, 2)},
    ];
    // Higher temp - we want some creativity here
    return await defaultCompletion({messages, temperature: 0.8});
  },
  filmDirector16k: async (params) => {
    const {charactersList, locationsList, numScenes, csvText} = params;
    const messages = [
      {
        role: "system",
        content: prompts.transcribe_film_director_prompt_16k.replace(
            "%CHARACTER_LIST%",
            JSON.stringify(charactersList),
        ).replace(
            "%LOCATIONS_LIST%",
            JSON.stringify(locationsList),
        ).replace(
            "%NUM_SCENES%",
            JSON.stringify(numScenes),
        ),
      },
      {role: "user", content: csvText},
    ];
    return await defaultCompletion({
      messages,
      temperature: 1,
      model: "gpt-4o-2024-08-06", // "chatgpt-4o-latest",
      maxTokens: 16384,
      format: "json_object"});
  },

  singleRequest: async (prompt, paramsList, text, temp=DEFAULT_TEMP) => {
    let content = prompts[prompt];
    paramsList.forEach((params) => {
      content = content.replace(
          `%${params.name}%`,
        typeof params.value === "object" ? JSON.stringify(params.value, null, 2) : params.value,
      );
    });
    const messages = [
      {
        role: "system",
        content: content,
      },
      {role: "user", content: typeof text === "object" ? JSON.stringify(text, null, 2) : text},
    ];
    return await defaultCompletion({messages, temperature: temp});
  },

  // Make batch requests to openai with rate limiting based on tokens.
  batchRequest: async (params) => {
    const {prompt, paramsList, textList, tokensPerMinute, temp=DEFAULT_TEMP, maxTokens = DEFAULT_MAX_TOKENS, format="json_object", model = DEFAULT_MODEL} = params;
    // Generate the content for the prompt so we can calcualte tokens.
    logger.debug(`Batch request for ${prompt} with ${textList.length} texts and tokensPerMinute=${tokensPerMinute}, format=${format}`);
    let content = prompts[prompt];
    paramsList.forEach((params) => {
      content = content.replace(
          `%${params.name}%`,
        typeof params.value === "object" ? JSON.stringify(params.value, null, 2) : params.value,
      );
    });

    let tokensUsed = 0;
    const promises = [];
    let startTime = Date.now();
    let results = [];
    // Loop through the textList.
    for (let i = 0; i < textList.length; i++) {
      const text = textList[i];
      const userContent = typeof text === "object" ? JSON.stringify(text, null, 2) : text;
      const messages = [
        {
          role: "system",
          content: content,
        },
        {role: "user", content: userContent},
      ];
      const tokens = tokenHelper.countTokens(JSON.stringify(messages));
      // This checks if the tokens in the current chunk takes us over the limit.
      if ( (tokensUsed + tokens + maxTokens) > tokensPerMinute) {
        // store results in a list.
        logger.debug(`Making ${promises.length} parallel requests with ${tokensUsed} max tokens`);
        results = results.concat(await Promise.all(promises));
        promises.length = 0; // clear old promises.
        tokensUsed = 0;
        const elapsedTime = Date.now() - startTime;
        // Make sure we wait 60 serconds between batches.
        if (elapsedTime < 60000) {
          logger.debug(`Waiting ${60000 - elapsedTime} milliseconds`);
          await new Promise((resolve) => setTimeout(resolve, 60000 - elapsedTime));
        }
        startTime = Date.now();
      }
      tokensUsed += (tokens + maxTokens);
      promises.push(defaultCompletion({messages, temperature: temp, format, model, maxTokens}));
    }
    // Run the final batch.
    logger.debug(`Making final ${promises.length} requests with ${tokensUsed} max tokens`);
    results = results.concat(await Promise.all(promises));
    return results;
  },
  // Make batch requests to openai with rate limiting based on tokens.
  batchRequestMultiPrompt: async (params) => {
    const {responseKey, prompt, paramsList, textList, tokensPerMinute, temp=DEFAULT_TEMP, maxTokens = DEFAULT_MAX_TOKENS, format="json_object", model = DEFAULT_MODEL} = params;
    // Generate the content for the prompt so we can calcualte tokens.
    logger.debug(`Batch request for ${prompt} with ${textList.length} texts and tokensPerMinute=${tokensPerMinute}, format=${format}`);
    const promptList = promptListFromParamsList({paramsList, systemInstruction: prompts[prompt]});
    // Loop through the textList.
    const {messages, tokens} = messagesFromPromptListAndTextList({promptList, textList});
    const results = await legacyRateLimitedBatchRequest({messages, tokens, tokensPerMinute, maxTokens, temp, format, model});
    return flattenResults({results, responseKey});
  },
  globalBatchRequestMultiPrompt: async (params) => {
    const {responseKey, prompt, paramsList, textList, tokensPerMinute} = params;
    // Generate the content for the prompt so we can calcualte tokens.
    logger.debug(`Batch request for ${prompt} with ${textList.length} texts and tokensPerMinute=${tokensPerMinute}`);
    // let startTime = Date.now();

    const globalPrompt = globalPrompts[prompt];
    // logger.debug(`Time to get globalPrompt: ${Date.now() - startTime}ms`);
    // startTime = Date.now();
    const maxTokens = globalPrompt.openAIGenerationConfig.max_tokens;
    // logger.debug(`Time to get maxTokens: ${Date.now() - startTime}ms`);
    // startTime = Date.now();
    const promptList = promptListFromParamsList({paramsList, systemInstruction: globalPrompt.systemInstruction});
    // logger.debug(`Time to create promptList: ${Date.now() - startTime}ms`);
    // startTime = Date.now();
    const {messages, tokens} = messagesFromPromptListAndTextList({promptList, textList});
    // logger.debug(`Time to create messages and tokens: ${Date.now() - startTime}ms`);
    logger.debug(`Completed batch construction.`);
    const results = await rateLimitedBatchRequest({
      messages,
      tokens,
      tokensPerMinute,
      maxTokens,
      prompt: formatGlobalPrompt({globalPrompt},
      ),
    });
    return flattenResults({results, responseKey});
  },
  batchRequestStaticText: async (params) => {
    const {responseKey, prompt, paramsList, staticText, tokensPerMinute, customSchemas} = params;
    // Generate the content for the prompt so we can calcualte tokens.
    logger.debug(`Batch request for ${prompt} with ${paramsList.length} texts and tokensPerMinute=${tokensPerMinute}`);
    // let startTime = Date.now();

    const globalPrompt = globalPrompts[prompt];
    // logger.debug(`Time to get globalPrompt: ${Date.now() - startTime}ms`);
    // startTime = Date.now();
    const maxTokens = globalPrompt.openAIGenerationConfig.max_tokens;
    // logger.debug(`Time to get maxTokens: ${Date.now() - startTime}ms`);
    // startTime = Date.now();
    const promptList = promptListFromParamsList({paramsList, systemInstruction: globalPrompt.systemInstruction});
    // logger.debug(`Time to create promptList: ${Date.now() - startTime}ms`);
    // startTime = Date.now();
    const {messages, tokens} = messagesFromPromptListStaticText({promptList, staticText});
    // logger.debug(`Time to create messages and tokens: ${Date.now() - startTime}ms`);
    logger.debug(`Completed batch construction.`);
    const results = await rateLimitedBatchRequest({
      messages,
      tokens,
      tokensPerMinute,
      maxTokens,
      prompt: formatGlobalPrompt({globalPrompt}),
      customSchemas,
    });
    // logger.debug(`Results: ${JSON.stringify(results)}`);
    return flattenResults({results, responseKey});
  },
};

// Format the schema into the response_format.
function formatGlobalPrompt({globalPrompt}) {
  if (globalPrompt.openAIGenerationConfig.response_format.type === "json_schema") {
    globalPrompt.openAIGenerationConfig.response_format.json_schema.schema = globalPrompt.responseSchema;
  }
  return globalPrompt;
}

// Rate limited batch request with global Prompt.
async function rateLimitedBatchRequest({
  messages,
  tokens,
  tokensPerMinute,
  maxTokens,
  prompt,
  customSchemas,
}) {
  let tokensUsed = 0;
  let promises = [];
  let startTime = Date.now() + 61000; // We don't need to pause on the first iteration.
  let results = [];
  logger.debug(`Starting rateLimitedBatchRequest loop with ${messages.length} messages`);
  for (let i = 0; i < messages.length; i++) {
    // Check if next batch will go over limit. If yes, launch batch.
    if ( (tokensUsed + tokens[i] + maxTokens) > tokensPerMinute) {
      // store results in a list.
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
    tokensUsed += (tokens[i] + maxTokens);
    const promptForIndex = _.cloneDeep(prompt);
    if (customSchemas && customSchemas[i]) {
      logger.debug(`Setting custom schema for index ${i}`);
      promptForIndex.openAIGenerationConfig.response_format.json_schema.schema = customSchemas[i];
    }
    promises.push(globalCompletion({
      messages: messages[i],
      prompt: promptForIndex,
      retry: true,
    }));
  }
  // Run the final batch.
  logger.debug(`Making final ${promises.length} requests with ${tokensUsed} max tokens`);
  results = results.concat(await Promise.all(promises));
  return results;
}

async function legacyRateLimitedBatchRequest({
  messages,
  tokens,
  tokensPerMinute,
  maxTokens,
  temp,
  format,
  model,
}) {
  const openAIGenerationConfig = {
    temperature: temp,
    max_tokens: maxTokens,
    response_format: {
      type: format,
    },
  };
  return await rateLimitedBatchRequest({
    messages,
    tokens,
    tokensPerMinute,
    maxTokens,
    prompt: {openAIGenerationConfig, model},
  });
}

function messagesFromPromptListAndTextList({promptList, textList}) {
  const messages = [];
  const tokens = [];
  for (let i = 0; i < textList.length; i++) {
    const text = textList[i];
    const userContent = typeof text === "object" ? JSON.stringify(text, null, 2) : text;
    messages.push([
      {
        role: "system",
        content: promptList[i],
      },
      {role: "user", content: userContent},
    ]);
    // This is super fucking expensive. So only do it if you have to.
    tokens.push(tokenHelper.countTokens(JSON.stringify(messages)));
  }
  return {messages, tokens};
}

function messagesFromPromptListStaticText({promptList, staticText}) {
  const staticTokens = tokenHelper.countTokens(staticText);
  const messages = [];
  const tokens = [];
  for (let i = 0; i < promptList.length; i++) {
    const text = staticText;
    const userContent = typeof text === "object" ? JSON.stringify(text, null, 2) : text;
    messages.push([
      {
        role: "system",
        content: promptList[i],
      },
      {role: "user", content: userContent},
    ]);
    tokens.push(staticTokens + tokenHelper.countTokens(JSON.stringify(promptList[i])));
  }
  return {messages, tokens};
}

function promptListFromParamsList({paramsList, systemInstruction}) {
  logger.debug(`paramsList.length: ${paramsList.length}`);
  const promptList = [];
  paramsList.forEach((params) => {
    let content = systemInstruction;
    params.forEach((param) => {
      content = content.replaceAll(`%${param.name}%`, param.value);
    });
    promptList.push(content);
  });
  return promptList;
}

export default nerFunctions;
