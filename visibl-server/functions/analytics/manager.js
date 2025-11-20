/**
 * @fileoverview Analytics Manager that handles provider selection and management
 */

import PostHogProvider, {createPosthogOptions} from "./posthog.js";
import {POSTHOG_API_KEY, POSTHOG_HOST, ANALYTICS_PROVIDER} from "../config/config.js";
import logger from "../util/logger.js";

/**
 * Analytics Manager class
 * Manages analytics providers and provides a unified interface
 */
class AnalyticsManager {
  /**
   * Create a new AnalyticsManager instance
   */
  constructor() {
    this.provider = null;
    this.isInitialized = false;
  }

  /**
   * Initialize the analytics manager with the configured provider
   * @param {string} providerName - Name of the provider to use (default: from ANALYTICS_PROVIDER env)
   * @param {Object} config - Provider-specific configuration
   * @return {Promise<boolean>} Whether initialization was successful
   */
  async initialize(providerName = null, config = null) {
    if (this.isInitialized) {
      logger.debug("Analytics manager already initialized");
      return true;
    }

    try {
      // Use environment variable if providerName not specified
      const selectedProvider = providerName || ANALYTICS_PROVIDER.value() || "posthog";

      // Select and initialize provider based on selectedProvider
      switch (selectedProvider.toLowerCase()) {
        case "posthog": {
          // Use provided config or fall back to environment variables
          const posthogConfig = config || {
            apiKey: POSTHOG_API_KEY.value(),
            host: POSTHOG_HOST.value(),
          };
          this.provider = new PostHogProvider(posthogConfig);
          break;
        }

        // Add more providers here as needed

        default:
          logger.error(`Unknown analytics provider: ${selectedProvider}`);
          return false;
      }

      // Initialize the selected provider
      const success = await this.provider.initialize();
      if (success) {
        this.isInitialized = true;
        logger.info(`Analytics manager initialized with ${selectedProvider} provider`);
      }
      return success;
    } catch (error) {
      logger.error(`Failed to initialize analytics manager: ${error.message}`);
      return false;
    }
  }

  /**
   * Capture an analytics event
   * @param {string} eventName - Name of the event
   * @param {Object} properties - Event properties
   * @param {string} distinctId - Unique identifier for the user/session
   * @return {Promise<void>}
   */
  async captureEvent(eventName, properties = {}, distinctId = "system") {
    if (!this.provider) {
      logger.debug("Analytics provider not initialized");
      return;
    }

    try {
      await this.provider.captureEvent(eventName, properties, distinctId);
    } catch (error) {
      // Never let analytics errors break the main process
      logger.debug(`Analytics: Failed to capture event '${eventName}' (non-critical): ${error.message}`);
    }
  }

  /**
   * Flush pending events
   * @return {Promise<void>}
   */
  async flush() {
    if (!this.provider) {
      return;
    }

    try {
      await this.provider.flush();
    } catch (error) {
      // Never let analytics errors break the main process
      logger.debug(`Analytics: Failed to flush events (non-critical): ${error.message}`);
    }
  }

  /**
   * Shutdown the analytics manager and its provider
   * @return {Promise<void>}
   */
  async shutdown() {
    if (!this.provider) {
      return;
    }

    try {
      await this.provider.shutdown();
    } catch (error) {
      logger.debug(`Analytics: Failed to shutdown provider (non-critical): ${error.message}`);
    } finally {
      this.provider = null;
      this.isInitialized = false;
    }
  }

  /**
   * Get the current provider instance
   * @return {AnalyticsProvider|null}
   */
  getProvider() {
    return this.provider;
  }

  /**
   * Check if analytics is configured and ready
   * @return {boolean}
   */
  isConfigured() {
    return this.isInitialized && this.provider?.isConfigured();
  }
}

// Create singleton instance
const analyticsManager = new AnalyticsManager();

/**
 * Creates analytics options object based on the current provider
 * @param {Object} params - Parameters object
 * @param {string} params.uid - User ID
 * @param {string} params.graphId - Graph ID (optional)
 * @param {string} params.sku - Book SKU
 * @param {number} params.chapter - Chapter number (optional)
 * @param {string} params.promptId - Prompt ID
 * @param {string} params.traceId - Trace ID (optional)
 * @return {Object} Analytics options object formatted for the current provider
 */
export function createAnalyticsOptions(params) {
  // PostHog is now the only provider
  return createPosthogOptions(params);
}

export default analyticsManager;
