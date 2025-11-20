/**
 * @fileoverview Main entry point for analytics module
 * Exports the analytics manager and base provider class
 */

export {default as analyticsManager, createAnalyticsOptions} from "./manager.js";
export {default as AnalyticsProvider} from "./base.js";
export {default as PostHogProvider} from "./posthog.js";

// Convenience exports for common operations
import analyticsManager from "./manager.js";

// Initialize analytics with configured provider when module is loaded
let initialized = false;

/**
 * Ensure analytics is initialized before use
 * Uses the ANALYTICS_PROVIDER environment variable or defaults to posthog
 * @private
 */
async function ensureInitialized() {
  if (!initialized) {
    // Will use ANALYTICS_PROVIDER env var by default
    initialized = await analyticsManager.initialize();
  }
}

/**
 * Initialize analytics with default or custom provider
 * @param {string} provider - Provider name (default: uses ANALYTICS_PROVIDER env var)
 * @param {Object} config - Provider configuration
 * @return {Promise<boolean>} Success status
 */
export async function initializeAnalytics(provider = null, config = null) {
  return analyticsManager.initialize(provider, config);
}

/**
 * Capture an analytics event
 * @param {string} eventName - Event name
 * @param {Object} properties - Event properties
 * @param {string} distinctId - User/session ID
 */
export async function captureEvent(eventName, properties = {}, distinctId = "system") {
  await ensureInitialized();
  return analyticsManager.captureEvent(eventName, properties, distinctId);
}

/**
 * Flush pending analytics events
 */
export async function flushAnalytics() {
  await ensureInitialized();
  return analyticsManager.flush();
}

/**
 * Shutdown analytics gracefully
 */
export async function shutdownAnalytics() {
  await ensureInitialized();
  return analyticsManager.shutdown();
}
