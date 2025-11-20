/**
 * @fileoverview Base class for analytics providers
 * Defines the interface that all analytics providers must implement
 */

import logger from "../util/logger.js";

/**
 * Abstract base class for analytics providers
 * All analytics providers (PostHog, Mixpanel, Amplitude, etc.) should extend this class
 */
class AnalyticsProvider {
  /**
   * Initialize the analytics provider
   * @param {Object} config - Provider-specific configuration
   */
  constructor(config = {}) {
    if (new.target === AnalyticsProvider) {
      throw new Error("AnalyticsProvider is an abstract class and cannot be instantiated directly");
    }

    this.config = config;
    this.isInitialized = false;
    this.providerName = this.constructor.name;
  }

  /**
   * Initialize the analytics client
   * Must be implemented by subclasses
   * @return {Promise<boolean>} Whether initialization was successful
   */
  async initialize() {
    throw new Error(`${this.providerName} must implement initialize() method`);
  }

  /**
   * Capture an analytics event
   * Must be implemented by subclasses
   * @param {string} eventName - Name of the event
   * @param {Object} properties - Event properties
   * @param {string} distinctId - Unique identifier for the user/session
   * @return {Promise<void>}
   */
  async captureEvent(eventName, properties = {}, distinctId = "system") { // eslint-disable-line no-unused-vars
    throw new Error(`${this.providerName} must implement captureEvent() method`);
  }

  /**
   * Flush pending events to the analytics service
   * Override in subclasses that support batching
   * @return {Promise<void>}
   */
  async flush() {
    // Default implementation - no-op for providers that don't batch
    logger.debug(`${this.providerName}: Flush not implemented (provider may not batch events)`);
  }

  /**
   * Shutdown the analytics provider gracefully
   * Override in subclasses that need cleanup
   * @return {Promise<void>}
   */
  async shutdown() {
    // Default implementation - just mark as not initialized
    this.isInitialized = false;
    logger.info(`${this.providerName}: Analytics provider shut down`);
  }

  /**
   * Check if the provider is properly configured and ready
   * @return {boolean}
   */
  isConfigured() {
    return this.isInitialized;
  }
}

export default AnalyticsProvider;
