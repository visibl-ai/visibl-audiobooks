import {createRateLimiter} from "./rateLimiter.js";
import logger from "../../util/logger.js";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * User rate limit configurations by action
 */
export const userRateLimits = {
  addStyle: {
    maxRequests: parseInt(process.env.USER_RATE_LIMIT_ADD_STYLE || "10", 10),
    windowSize: parseInt(process.env.USER_RATE_LIMIT_ADD_STYLE_WINDOW || String(ONE_DAY_MS), 10),
    errorMessage: "You have reached your daily limit of 10 styles. Please try again tomorrow.",
  },
  bookImport: {
    maxRequests: parseInt(process.env.USER_RATE_LIMIT_BOOK_IMPORT || "50", 10),
    windowSize: parseInt(process.env.USER_RATE_LIMIT_BOOK_IMPORT_WINDOW || String(ONE_DAY_MS), 10),
    errorMessage: "You have reached your daily limit of 50 book imports. Please try again tomorrow.",
  },
};

const _limiters = {};

/**
 * Check user rate limit for an action
 * @param {Object} params - The parameters object
 * @param {string} params.uid - User ID
 * @param {string} params.action - Action name
 * @throws {Error} If rate limit exceeded
 */
export async function checkUserRateLimit({uid, action}) {
  if (uid === "admin") return;

  const config = userRateLimits[action];
  if (!config) {
    logger.warn(`No rate limiter configured for action: ${action}`);
    return;
  }

  const key = `user/${action}/${uid}`;
  if (!_limiters[key]) {
    _limiters[key] = createRateLimiter({
      serviceName: key,
      options: {
        maxRequests: config.maxRequests,
        maxTokens: Infinity,
        windowSize: config.windowSize,
      },
    });
  }

  const limiter = _limiters[key];
  if (await limiter.wouldExceedLimit({tokens: 0})) {
    const usage = await limiter.getUsage();
    const now = Date.now();
    const resetTime = usage.resetTime instanceof Date ? usage.resetTime.getTime() : now + config.windowSize;
    const timeRemainingMs = Math.max(0, resetTime - now);

    const error = new Error(config.errorMessage);
    error.code = "resource-exhausted";
    error.details = {
      action,
      currentRequests: usage.currentRequests,
      maxRequests: config.maxRequests,
      resetTime: new Date(resetTime),
      timeRemainingMs,
      timeRemainingFormatted: formatTimeRemaining(timeRemainingMs),
    };
    throw error;
  }
}

/**
 * Record usage for user rate limit (call after successful operation)
 * @param {Object} params - The parameters object
 * @param {string} params.uid - User ID
 * @param {string} params.action - Action name
 */
export async function recordUserRateLimit({uid, action}) {
  if (uid === "admin") return;

  const key = `user/${action}/${uid}`;
  const limiter = _limiters[key];
  if (limiter) {
    await limiter.recordUsage({tokens: 0});
  }
}

/**
 * Format milliseconds to human readable string
 * @param {number} ms - Milliseconds
 * @return {string} Formatted string
 */
function formatTimeRemaining(ms) {
  const hours = Math.floor(ms / (1000 * 60 * 60));
  const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}
