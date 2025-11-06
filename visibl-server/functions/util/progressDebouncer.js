/* eslint-disable require-jsdoc */
import {createRateLimiter} from "../storage/realtimeDb/rateLimiter.js";
import {MOCK_IMAGES} from "../config/config.js";
import logger from "./logger.js";

/**
 * Default configuration for progress update rate limiting (1 request per 5 seconds)
 * Can be overridden via environment variables
 */
const PROGRESS_UPDATE_WINDOW_SIZE = parseInt(process.env.PROGRESS_UPDATE_WINDOW_SIZE || "5000", 10); // 5 seconds
const PROGRESS_UPDATE_MAX_REQUESTS = parseInt(process.env.PROGRESS_UPDATE_MAX_REQUESTS || "1", 10); // 1 request per window

/**
 * Check if a progress update should be processed based on rate limiting
 * Uses the existing rate limiter infrastructure to throttle progress updates per user/sku combination
 * @param {string} uid - User ID
 * @param {string} sku - SKU (book identifier)
 * @return {Promise<boolean>} True if the update should be processed, false if throttled
 */
export async function shouldProcessProgressUpdate({uid, sku}) {
  logger.debug(`shouldProcessProgressUpdate: ${uid}_${sku} (mock mode: ${MOCK_IMAGES.value()})`);
  // Always allow progress updates in mock mode
  if (MOCK_IMAGES.value() === true) {
    logger.debug(`Progress update ALLOWED for ${uid}_${sku} (mock mode)`);
    return true;
  }

  const key = `${uid}_${sku}`;

  // Create a rate limiter instance for this specific user/sku combination
  const limiter = createRateLimiter({
    serviceName: `progress-${key}`,
    options: {
      maxRequests: PROGRESS_UPDATE_MAX_REQUESTS,
      maxTokens: 1, // Simple token tracking, we only care about request count
      windowSize: PROGRESS_UPDATE_WINDOW_SIZE,
    },
  });

  try {
    // Check if processing this update would exceed the rate limit
    const wouldExceed = await limiter.wouldExceedLimit({tokens: 1});

    if (!wouldExceed) {
      // Record this usage and allow processing
      await limiter.recordUsage({tokens: 1});
      logger.debug(`Progress update ALLOWED for ${key} (window: ${PROGRESS_UPDATE_WINDOW_SIZE}ms)`);
      return true;
    }

    // Rate limit exceeded, throttle this update
    logger.debug(`Progress update THROTTLED for ${key} (window: ${PROGRESS_UPDATE_WINDOW_SIZE}ms)`);
    return false;
  } catch (error) {
    // If there's an error with the rate limiter, err on the side of allowing the update
    // to prevent blocking legitimate progress updates
    logger.warn(`Error checking progress update rate limit for ${key}: ${error.message}. Allowing update.`);
    return true;
  }
}

