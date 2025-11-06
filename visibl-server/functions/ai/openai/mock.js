/* eslint-disable require-jsdoc */
import logger from "../../util/logger.js";

/**
 * Class for creating mock responses for OpenAI API calls
 */
export class OpenAIMockResponse {
  /**
   * Creates a new mock response
   * @param {Object} options - Configuration options
   * @param {any} options.content - The response content (required)
   * @param {number} [options.tokensUsed=100] - Number of tokens to report as used
   * @param {string} [options.model="mock-model"] - Model name to report
   * @param {string} [options.id] - Response ID (auto-generated if not provided)
   * @param {number} [options.delay=10] - Delay in milliseconds to simulate API latency
   */
  constructor(options) {
    if (!options || options.content === undefined) {
      throw new Error("OpenAIMockResponse requires content");
    }
    this.content = options.content;
    this.tokensUsed = options.tokensUsed || 100;
    this.model = options.model || "mock-model";
    this.id = options.id || `mock-${Date.now()}`;
    this.delay = options.delay || 10;
  }

  /**
   * Formats the mock response to match OpenAI responses.create API structure
   * @param {boolean} wantsJson - Whether the response should be JSON stringified
   * @return {Object} - Formatted response
   */
  format(wantsJson) {
    const content = wantsJson && typeof this.content === "object" ?
      JSON.stringify(this.content) :
      String(this.content);

    return {
      id: this.id,
      model: this.model,
      output_text: content,
      usage: {
        total_tokens: this.tokensUsed,
        prompt_tokens: Math.floor(this.tokensUsed * 0.3),
        completion_tokens: Math.ceil(this.tokensUsed * 0.7),
      },
    };
  }
}

/**
 * Mock API caller function that simulates OpenAI API calls
 * @param {Object} params - Request parameters
 * @param {boolean} wantsJson - Whether to return a JSON response
 * @param {OpenAIMockResponse} mockResponse - The mock response to use (required)
 * @return {Promise<Object>} - Mock response
 */
async function mockApiCall(params, wantsJson, mockResponse) {
  if (!mockResponse || !(mockResponse instanceof OpenAIMockResponse)) {
    throw new Error("mockApiCall requires an OpenAIMockResponse instance");
  }

  logger.debug("***** Mock OpenAI API Call *****");
  logger.debug(`Using mock response with content: ${JSON.stringify(mockResponse.content).substring(0, 100)}...`);

  // Simulate API delay
  await new Promise((resolve) => setTimeout(resolve, mockResponse.delay));

  return mockResponse.format(wantsJson);
}

export {mockApiCall};
