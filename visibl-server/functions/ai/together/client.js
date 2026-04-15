/* eslint-disable require-jsdoc */
import OpenAI from "openai";
import logger from "../../util/logger.js";
import {TOGETHER_API_KEY, MOCK_LLM} from "../../config/config.js";
import {zodResponseFormat} from "openai/helpers/zod.mjs";

/**
 * Model name mapping from OpenRouter format to TogetherAI format
 */
const MODEL_MAPPING = {
  "deepseek/deepseek-chat-v3-0324": "deepseek-ai/DeepSeek-V3",
};

/**
 * Client for direct TogetherAI API requests using OpenAI SDK
 * TogetherAI provides an OpenAI-compatible API at https://api.together.xyz/v1
 */
class TogetherClient {
  /**
   * Creates a new Together client instance
   * @param {Object} options - Configuration options
   * @param {string} [options.apiKey] - Together API key (defaults to env var)
   * @param {number} [options.timeout] - Request timeout in milliseconds
   */
  constructor(options = {}) {
    this.apiKeyParam = options.apiKey || TOGETHER_API_KEY;
    this.baseURL = "https://api.together.xyz/v1";
    this.timeout = options.timeout || 600000; // 10 minutes default

    // Check if we're in mock mode
    const mockValue = MOCK_LLM.value().toString().trim().toLowerCase();
    this.isMockMode = ["true", "1", "yes", "y"].includes(mockValue);
  }

  /**
   * Gets the API key value at runtime
   * @return {string} - The API key value
   */
  getApiKey() {
    return this.apiKeyParam.value();
  }

  /**
   * Initializes the OpenAI client configured for TogetherAI
   * @return {OpenAI} - The initialized OpenAI client
   */
  getClient() {
    return new OpenAI({
      baseURL: this.baseURL,
      apiKey: this.getApiKey(),
      timeout: this.timeout,
    });
  }

  /**
   * Maps OpenRouter model name to TogetherAI model name
   * @param {string} openRouterModel - Model name in OpenRouter format
   * @return {string} - Model name in TogetherAI format
   */
  mapModelName(openRouterModel) {
    const mapped = MODEL_MAPPING[openRouterModel];
    if (mapped) {
      logger.debug(`TogetherClient: Mapped model ${openRouterModel} -> ${mapped}`);
      return mapped;
    }
    // Return original if no mapping exists
    logger.debug(`TogetherClient: No mapping for ${openRouterModel}, using as-is`);
    return openRouterModel;
  }

  /**
   * Sends a chat completion request to TogetherAI
   * @param {Object} options - Request options
   * @param {Object} options.params - Request parameters (model, messages, etc.)
   * @param {boolean} options.wantsJson - Whether to use structured output parsing
   * @param {Object} [options.responseSchema] - Zod schema for structured output
   * @return {Promise<Object>} - API response
   */
  async chatCompletion(options) {
    const {params, wantsJson, responseSchema} = options;
    const client = this.getClient();

    // Map the model name to Together format
    const togetherParams = {
      ...params,
      model: this.mapModelName(params.model),
    };

    // Remove OpenRouter-specific fields that Together doesn't use
    delete togetherParams.provider;

    logger.debug(`TogetherClient: Sending request to model ${togetherParams.model}`);

    // Add JSON response format if needed
    if (wantsJson && responseSchema) {
      togetherParams.response_format = zodResponseFormat(responseSchema, "response");
      logger.debug("TogetherClient: Using structured output with Zod schema");
    }

    if (wantsJson) {
      return await client.chat.completions.parse(togetherParams);
    }
    return await client.chat.completions.create(togetherParams);
  }
}

export {TogetherClient};
