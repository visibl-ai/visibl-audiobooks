/* eslint-disable require-jsdoc */
import OpenAI from "openai";
import logger from "../../util/logger.js";
import globalPrompts from "../prompts/globalPrompts.js";
import {OPENROUTER_API_KEY, MOCK_LLM} from "../../config/config.js";
import {mockApiCall, OpenRouterMockResponse} from "./mock.js";
import {zodResponseFormat} from "openai/helpers/zod.mjs";

/**
 * Reusable class for OpenRouter API requests
 * Encapsulates OpenRouter functionality
 */
class OpenRouterClient {
  /**
   * Creates a new OpenRouter client instance
   * @param {Object} options - Configuration options
   * @param {string} [options.apiKey] - OpenRouter API key (defaults to env var)
   * @param {string} [options.baseURL] - OpenRouter base URL
   * @param {Object} [options.defaultHeaders] - Default headers for requests
   * @param {number} [options.timeout] - Request timeout in milliseconds
   * @param {Function} [options.apiCaller] - Function to make API calls (for dependency injection)
   * @param {Function} [options.modelsLister] - Function to list models (for dependency injection)
   */
  constructor(options = {}) {
    this.apiKeyParam = options.apiKey || OPENROUTER_API_KEY;
    this.baseURL = options.baseURL || "https://openrouter.ai/api/v1";
    this.defaultHeaders = options.defaultHeaders || {
      "HTTP-Referer": "https://www.visibl.ai",
      "X-Title": "Visibl - AI Service",
    };
    this.timeout = options.timeout || 600000; // 10 minutes default

    // Check if we're in mock mode
    const mockValue = MOCK_LLM.value().toString().trim().toLowerCase();
    this.isMockMode = ["true", "1", "yes", "y"].includes(mockValue);

    // Store API caller function - will decide at runtime based on mockResponse
    this._apiCaller = options.apiCaller || this._defaultApiCaller.bind(this);

    // Always use real models list (don't mock it)
    this._modelsLister = options.modelsLister || this._defaultModelsLister.bind(this);
  }

  /**
   * Gets the API key value at runtime
   * @return {string} - The API key value
   */
  getApiKey() {
    return this.apiKeyParam.value();
  }

  /**
   * Initializes the OpenAI client with the current API key
   * @return {OpenAI} - The initialized OpenAI client
   */
  getClient() {
    return new OpenAI({
      baseURL: this.baseURL,
      apiKey: this.getApiKey(),
      defaultHeaders: this.defaultHeaders,
      timeout: this.timeout,
    });
  }

  /**
   * Default API caller function that makes real OpenAI API calls
   * @param {Object} requestParams - Request parameters
   * @param {boolean} wantsJson - Whether to use parse or create method
   * @param {OpenRouterMockResponse} mockResponse - Mock response (ignored in real mode)
   * @return {Promise<Object>} - API response
   */
  async _defaultApiCaller(requestParams, wantsJson, mockResponse) {
    // In real mode, ignore mockResponse
    if (wantsJson) {
      return await this.getClient().chat.completions.parse(requestParams);
    }
    return await this.getClient().chat.completions.create(requestParams);
  }

  /**
   * Default models lister function that fetches real models from OpenAI API
   * @return {Promise<Object>} - Models response
   */
  async _defaultModelsLister() {
    return await this.getClient().models.list();
  }

  /**
   * Performs instruction replacements in a template string
   * @param {Object} params - Parameters object
   * @param {string} params.instruction - The instruction template
   * @param {Array} [params.replacements=[]] - Array of replacement objects with key/value pairs
   * @return {string} - The instruction with replacements applied
   */
  instructionReplacements({instruction, replacements = []}) {
    if (replacements) {
      for (const replacement of replacements) {
        instruction = instruction.replaceAll(`%${replacement.key}%`, replacement.value);
      }
    }
    return instruction;
  }

  /**
   * Sends a request to OpenRouter using the global prompts system
   * @param {Object} request - Request parameters
   * @param {string} request.prompt - The prompt key from globalPrompts
   * @param {string} request.message - The message to send
   * @param {Array} [request.replacements=[]] - Template replacements
   * @param {Array} [request.history=[]] - Chat history
   * @param {boolean} [request.retry=true] - Whether to retry on errors
   * @param {string} [request.instructionOverride] - Override the default instruction
   * @param {string} [request.responseKey] - Optional response key for tracking
   * @param {string} [request.modelOverride] - Override the default model
   * @param {Object} [request.providerOverride] - Override the default provider
   * @param {OpenRouterMockResponse} [request.mockResponse] - Mock response to use (only in mock mode)
   * @return {Promise<Object>} - Response object with result, tokensUsed, and responseKey
   */
  async sendRequest(request) {
    const {
      prompt,
      message,
      replacements = [],
      history = [],
      retry = true,
      instructionOverride,
      promptOverride,
      responseKey,
      modelOverride,
      providerOverride = null,
      mockResponse,
      logVerbose = true,
    } = request;

    const globalPrompt = promptOverride || globalPrompts[prompt];

    if (!globalPrompt) {
      logger.error(`Prompt configuration not found for key: ${prompt}`);
      return {error: `Prompt configuration not found: ${prompt}`};
    }

    if (globalPrompt.responseSchema && typeof globalPrompt.responseSchema !== "object") {
      logger.error(`Prompt configuration for ${prompt} requires JSON but responseSchema is missing or invalid.`);
      return {error: `Missing or invalid responseSchema for prompt: ${prompt}`};
    }

    let instruction = this.instructionReplacements({
      instruction: globalPrompt.systemInstruction,
      replacements,
    });

    if (instructionOverride) {
      instruction = instructionOverride;
    }

    const model = modelOverride || globalPrompt.openRouterModel;
    if (!model) {
      throw new Error(`Model not found for prompt '${prompt}'`);
    }

    const provider = providerOverride || globalPrompt.openRouterProvider;
    const generationConfig = globalPrompt.openAIGenerationConfig;
    const wantsJson = globalPrompt.responseSchema ? true : false;

    if (logVerbose) {
      logger.debug(`Sending request to OpenRouter model ${model}`);
      logger.debug(`Instruction: ${instruction.substring(0, 600)}`);
    }


    try {
      // Prepare messages array
      const messages = [
        {role: "system", content: instruction},
        ...history,
        {role: "user", content: message},
      ];

      // Prepare request parameters
      const params = {
        model: model,
        provider: provider,
        messages: messages,
        temperature: generationConfig?.temperature || 0.7,
        max_tokens: generationConfig?.max_tokens || 4096,
        top_p: generationConfig?.top_p || 1,
        frequency_penalty: generationConfig?.frequency_penalty || 0,
        presence_penalty: generationConfig?.presence_penalty || 0,
      };

      if (generationConfig) {
        // Copy all generationConfig keys to params except provider which is handled separately
        for (const [key, value] of Object.entries(generationConfig)) {
          params[key] = value;
        }
      }
      logger.debug(`params.provider: ${JSON.stringify(params.provider)}`);
      logger.debug(`Params keys: ${Object.keys(params).join(", ")}`);
      // Add JSON response format if needed
      if (wantsJson) {
        if (globalPrompt.responseSchema) {
          // We only use Zod schemas for response format
          params.response_format = zodResponseFormat(globalPrompt.responseSchema, "response");
          if (logVerbose) {
            logger.debug("params.response_format", JSON.stringify(params.response_format));
          }
        }
      }

      // Use mock API if in mock mode and mockResponse provided
      let result;
      if (this.isMockMode && mockResponse) {
        result = await mockApiCall(params, wantsJson, mockResponse, logVerbose);
      } else if (this.isMockMode && !mockResponse) {
        throw new Error("Mock mode is enabled but no mockResponse provided. Please provide an OpenRouterMockResponse instance.");
      } else {
        result = await this._apiCaller(params, wantsJson, mockResponse);
      }

      const tokensUsed = result.usage?.total_tokens || 0;
      const responseText = result.choices[0]?.message?.content || "";
      if (logVerbose) {
        logger.debug(`OpenRouter response received - id: ${result.id}, provider: ${result.provider}, model: ${result.model}, usage: ${JSON.stringify(result.usage)}`);
        logger.debug(JSON.stringify(responseText).substring(0, 150));
      }
      if (wantsJson) {
        const parseResult = this.parseJsonSafely(responseText);
        if (parseResult.error) {
          logger.error("Error trying to parse result JSON from response.", parseResult.error);
          return {result: responseText, error: "JSON parsing error", details: parseResult.error, tokensUsed, responseKey};
        }
        return {result: parseResult.data, tokensUsed, responseKey};
      } else {
        return {result: responseText, tokensUsed, responseKey};
      }
    } catch (error) {
      // Check if this is a parsing error from the OpenAI SDK
      if (retry && error.message && error.message.includes(`Cannot read properties of undefined`)) {
        logger.warn(`OpenRouter API parsing error (likely malformed response). Retrying immediately.`);
        request.retry = false;
        return await this.sendRequest(request);
      }
      // Check if this is a syntax error from the OpenAI SDK
      if (retry && error.message && error.message.includes(`SyntaxError`)) {
        logger.warn(`OpenRouter API syntax error (likely malformed response). Retrying immediately.`);
        request.retry = false;
        return await this.sendRequest(request);
      }

      logger.error("Error sending message to OpenRouter:", error);

      // Check if this is a network error
      const isNetworkError =
        error.message?.includes("terminated") ||
        error.code === "UND_ERR_SOCKET" ||
        error.code === "ECONNRESET" ||
        error.code === "ETIMEDOUT" ||
        error.type === "system";

      // Check if this is a retryable error
      // Retry on:
      // - Network errors (connection issues)
      // - OpenRouter 404s (temporary provider availability issues)
      // - Rate limits (429)
      // - All server errors (5xx)
      if (retry && (isNetworkError || error.status === 404 || error.status === 429 || (error.status >= 500 && error.status < 600))) {
        const errorType = isNetworkError ? "network/socket error" : error.status ? `HTTP ${error.status}` : error.type || "unknown";
        logger.warn(`OpenRouter API error (${errorType}). Waiting 10 seconds before retrying.`);
        await new Promise((resolve) => setTimeout(resolve, 10000));
        request.retry = false;
        return await this.sendRequest(request);
      }

      return {error: "OpenRouter API error", details: error.message || error.toString(), responseKey};
    }
  }

  /**
   * Safely parses JSON from response text
   * @param {string} text - The text to parse
   * @return {Object} - Object with data or error property
   */
  parseJsonSafely(text) {
    try {
      if (typeof text === "string") {
        text = text.replace(/^```json\s*/, "").replace(/\s*```$/, "");
        text = text.replace(/\n/g, "");
        return {data: JSON.parse(text)};
      }
      // If not a string, should be a json object already
      return {data: text};
    } catch (e) {
      logger.error("Error trying to parse result to JSON:", e);
      logger.debug("================================================");
      logger.debug(`Original text for JSON parsing: ${text.substring(0, 100)} ... ${text.substring(text.length - 100)}`);
      logger.debug("================================================");
      return {error: e.message, originalText: text};
    }
  }

  /**
   * Sends a direct chat completion request without using global prompts
   * @param {Object} params - Request parameters
   * @param {Array} params.messages - Array of message objects
   * @param {string} params.model - Model to use
   * @param {Object} [params.options] - Additional options (temperature, max_tokens, etc.)
   * @param {OpenRouterMockResponse} [params.mockResponse] - Mock response to use (only in mock mode)
   * @return {Promise<Object>} - Response object
   */
  async chatCompletion(params) {
    const {messages, model, options = {}, mockResponse} = params;

    try {
      const requestParams = {
        model,
        messages,
        temperature: options.temperature || 0.7,
        max_tokens: options.max_tokens || 4096,
        top_p: options.top_p || 1,
        frequency_penalty: options.frequency_penalty || 0,
        presence_penalty: options.presence_penalty || 0,
        ...options,
      };

      // Use mock API if in mock mode and mockResponse provided
      if (this.isMockMode && mockResponse) {
        return await mockApiCall(requestParams, false, mockResponse);
      } else if (this.isMockMode && !mockResponse) {
        throw new Error("Mock mode is enabled but no mockResponse provided. Please provide an OpenRouterMockResponse instance.");
      } else {
        return await this._apiCaller(requestParams, false, mockResponse);
      }
    } catch (error) {
      logger.error("Error in chat completion:", error);
      throw error;
    }
  }

  /**
   * Gets available models from OpenRouter
   * @return {Promise<Array>} - Array of available models
   */
  async getModels() {
    try {
      const response = await this._modelsLister();
      return response.data;
    } catch (error) {
      logger.error("Error fetching OpenRouter models:", error);
      throw error;
    }
  }
}

export {
  OpenRouterClient,
  OpenRouterMockResponse,
};
