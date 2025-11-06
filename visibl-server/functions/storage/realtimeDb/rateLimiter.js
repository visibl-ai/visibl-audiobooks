/* eslint-disable require-jsdoc */
import {storeData, getData} from "./database.js";
import logger from "../../util/logger.js";

/**
 * Convert a service name to a rate limiter reference
 * @param {Object} params - The parameters object
 * @param {string} params.serviceName - Name of the AI service
 * @return {string} Rate limiter reference
 */
function ratelimiterToRef({serviceName}) {
  return `ratelimiter/${serviceName}`;
}

/**
 * Store the rate limiter data for a given service name
 * @param {Object} params - The parameters object
 * @param {string} params.serviceName - Name of the AI service
 * @param {Object} params.data - Rate limiter data
 */
async function storeRateLimiter({serviceName, data}) {
  const dbRef = ratelimiterToRef({serviceName});
  await storeData({ref: dbRef, data});
}

/**
 * Get the rate limiter data for a given service name
 * @param {Object} params - The parameters object
 * @param {string} params.serviceName - Name of the AI service
 * @return {Promise<Object>} Rate limiter data
 */
async function getRateLimiter({serviceName}) {
  const dbRef = ratelimiterToRef({serviceName});
  return await getData({ref: dbRef});
}

/**
 * Rate limiter class for managing AI service rate limits
 */
class RateLimiter {
  /**
   * @param {Object} params - The parameters object
   * @param {string} params.serviceName - Name of the AI service (e.g., 'openai', 'gemini')
   * @param {Object} params.options - Rate limit configuration
   * @param {number} params.options.maxTokens - Maximum tokens allowed per window
   * @param {number} params.options.maxRequests - Maximum requests allowed per window
   * @param {number} params.options.windowSize - Time window in milliseconds
   */
  constructor({serviceName, options}) {
    this.serviceName = serviceName;
    this.maxTokens = options.maxTokens;
    this.maxRequests = options.maxRequests;
    this.windowSize = options.windowSize;
  }

  /**
   * Check if the service has exceeded its rate limit
   * @param {Object} params - The parameters object
   * @param {number} params.tokens - Number of tokens to check
   * @return {Promise<boolean>} True if rate limit would be exceeded
   */
  async wouldExceedLimit({tokens}) {
    const data = await getRateLimiter({serviceName: this.serviceName});
    const now = Date.now();

    if (!data || data.windowStart < now - this.windowSize) {
      return false;
    }

    return (data.totalTokens + tokens) > this.maxTokens ||
           (data.totalRequests + 1) > this.maxRequests;
  }

  /**
   * Record token usage and request count for the service
   * @param {Object} params - The parameters object
   * @param {number} params.tokens - Number of tokens used
   * @return {Promise<void>}
   */
  async recordUsage({tokens}) {
    const now = Date.now();

    try {
      const data = await getRateLimiter({serviceName: this.serviceName});

      if (!data || data.windowStart < now - this.windowSize) {
        // Start new window
        await storeRateLimiter({
          serviceName: this.serviceName,
          data: {
            windowStart: now,
            totalTokens: tokens,
            totalRequests: 1,
          },
        });
      } else {
        // Update current window
        await storeRateLimiter({
          serviceName: this.serviceName,
          data: {
            windowStart: data.windowStart,
            totalTokens: data.totalTokens + tokens,
            totalRequests: data.totalRequests + 1,
          },
        });
      }
    } catch (error) {
      logger.error(`Error recording usage for ${this.serviceName}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get current usage for the service
   * @return {Promise<Object>} Current usage statistics
   */
  async getUsage() {
    const data = await getRateLimiter({serviceName: this.serviceName});
    const now = Date.now();

    if (!data || data.windowStart < now - this.windowSize) {
      return {
        currentUsage: 0,
        currentRequests: 0,
        remainingTokens: this.maxTokens,
        remainingRequests: this.maxRequests,
        resetTime: new Date(now + this.windowSize),
      };
    }

    return {
      currentUsage: data.totalTokens,
      currentRequests: data.totalRequests,
      remainingTokens: Math.max(0, this.maxTokens - data.totalTokens),
      remainingRequests: Math.max(0, this.maxRequests - data.totalRequests),
      resetTime: new Date(data.windowStart + this.windowSize),
    };
  }

  /**
   * Reset usage for the service
   * @return {Promise<void>}
   */
  async resetUsage() {
    await storeRateLimiter({
      serviceName: this.serviceName,
      data: null,
    });
  }
}

/**
 * Create a rate limiter instance for an AI service
 * @param {Object} params - The parameters object
 * @param {string} params.serviceName - Name of the AI service
 * @param {Object} params.options - Rate limit configuration
 * @return {RateLimiter} Rate limiter instance
 */
export function createRateLimiter({serviceName, options}) {
  return new RateLimiter({serviceName, options});
}

// Example usage:
// const openaiLimiter = createRateLimiter('openai', {
//   maxTokens: 100000,
//   maxRequests: 1000,
//   windowSize: 24 * 60 * 60 * 1000, // 24 hours
// });
//
// const geminiLimiter = createRateLimiter('gemini', {
//   maxTokens: 50000,
//   maxRequests: 500,
//   windowSize: 60 * 60 * 1000, // 1 hour
// });
