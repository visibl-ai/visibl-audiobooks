/**
 * @fileoverview PostHog implementation of AnalyticsProvider
 */

import {PostHog} from "posthog-node";
import AnalyticsProvider from "./base.js";
import logger from "../util/logger.js";
import {ENVIRONMENT, GPT_4_1_MINI_FT_INPUT_COST_PER_1M, GPT_4_1_MINI_FT_OUTPUT_COST_PER_1M} from "../config/config.js";

/**
 * PostHog analytics provider implementation
 */
class PostHogProvider extends AnalyticsProvider {
  /**
   * Create a new PostHogProvider instance
   * @param {Object} config - Configuration with apiKey and host
   */
  constructor(config = {}) {
    super(config);
    this.client = null;
  }

  /**
   * Initialize the PostHog client
   * @return {Promise<boolean>} Whether initialization was successful
   */
  async initialize() {
    const {apiKey, host} = this.config;

    if (!apiKey || apiKey === "") {
      logger.debug("PostHog API key not configured, analytics disabled");
      return false;
    }

    try {
      // Initialize PostHog instance
      this.client = new PostHog(apiKey, {
        host: host || "https://app.posthog.com",
        flushAt: 20, // Number of events to batch before sending
        flushInterval: 10000, // Send events every 10 seconds
      });

      this.isInitialized = true;
      logger.info("PostHog analytics initialized successfully");
      return true;
    } catch (error) {
      logger.error("Failed to initialize PostHog:", error);
      return false;
    }
  }

  /**
   * Map generic properties to PostHog format for AI events
   * @private
   * @param {Object} properties - Generic properties
   * @return {Object} PostHog-formatted properties
   */
  mapAIProperties(properties) {
    const mapped = {};

    // Determine provider-specific details
    const provider = properties.provider || "unknown";

    // Set library info based on provider
    const libInfo = {
      wavespeed: {lib: "wavespeed-sdk", version: "1.0.0"},
      groq: {lib: "groq-sdk", version: "1.0.0"},
      openrouter: {lib: "openai", version: "5.8.2"},
      openai: {lib: "openai", version: "5.8.2"},
    }[provider] || {lib: provider, version: "1.0.0"};

    // Core mappings
    mapped.$ai_provider = provider;
    mapped.$ai_lib = libInfo.lib;
    mapped.$ai_lib_version = libInfo.version;

    // Model and tracing
    if (properties.model) mapped.$ai_model = properties.model;
    if (properties.traceId) {
      mapped.$ai_trace_id = properties.traceId;
      mapped.$ai_span_id = properties.traceId;
    }

    // Input/Output
    if (properties.input) mapped.$ai_input = properties.input;
    if (properties.output !== undefined) {
      if (typeof properties.output === "string") {
        mapped.$ai_output_choices = [{role: "assistant", content: properties.output}];
      } else if (Array.isArray(properties.output)) {
        mapped.$ai_output_choices = properties.output;
      } else if (properties.output) {
        mapped.$ai_output_choices = [{role: "assistant", content: JSON.stringify(properties.output)}];
      }
    }

    // Performance metrics
    if (properties.latency !== undefined) {
      mapped.$ai_latency = properties.latency / 1000; // Convert ms to seconds
    }

    // Status
    if (properties.success !== undefined) {
      mapped.$ai_is_error = !properties.success;
      mapped.$ai_http_status = properties.success ? 200 : 500;
    }

    // Error handling
    if (properties.error) {
      if (typeof properties.error === "string") {
        mapped.$ai_error = properties.error;
      } else if (properties.error.message) {
        mapped.$ai_error = properties.error.message;
        if (properties.error.type) mapped.$ai_error_type = properties.error.type;
        if (properties.error.code) mapped.$ai_error_code = properties.error.code;
        if (properties.error.status) mapped.$ai_http_status = properties.error.status;
        if (properties.error.stack) mapped.error_stack = properties.error.stack;
      }
    }

    // Manual cost tracking (Wavespeed, Groq, and Fine-tuned OpenAI)
    const isFineTunedModel = properties.model?.startsWith("ft:");
    if (properties.cost !== undefined || isFineTunedModel) {
      mapped.$ai_cost = properties.cost;
      mapped.$ai_total_cost_usd = properties.cost;

      // Provider-specific cost handling
      if (provider === "wavespeed") {
        mapped.$ai_input_cost_usd = 0;
        mapped.$ai_output_cost_usd = properties.cost;
        mapped.$ai_cost_model_provider = "default";
      } else if (provider === "groq") {
        mapped.$ai_input_cost_usd = 0;
        mapped.$ai_output_cost_usd = properties.cost;
        mapped.$ai_cost_model_provider = "default";
      } else if (isFineTunedModel && properties.result?.usage) {
        // Calculate cost for fine-tuned models
        // OpenAI responses.create uses input_tokens/output_tokens
        const inputTokens = properties.result.usage.input_tokens ||
                           properties.result.usage.prompt_tokens || 0;
        const outputTokens = properties.result.usage.output_tokens ||
                            properties.result.usage.completion_tokens || 0;

        // Fine-tuned model pricing from configuration
        if (properties.model.startsWith("ft:gpt-4.1-mini-2025-04-14")) {
          const inputCostPer1M = parseFloat(GPT_4_1_MINI_FT_INPUT_COST_PER_1M.value());
          const outputCostPer1M = parseFloat(GPT_4_1_MINI_FT_OUTPUT_COST_PER_1M.value());
          const inputCost = (inputTokens / 1000000) * inputCostPer1M;
          const outputCost = (outputTokens / 1000000) * outputCostPer1M;
          const totalCost = inputCost + outputCost;

          mapped.$ai_input_cost_usd = inputCost;
          mapped.$ai_output_cost_usd = outputCost;
          mapped.$ai_cost = totalCost;
          mapped.$ai_total_cost_usd = totalCost;
          mapped.$ai_cost_model_provider = "openai";
        } else {
          logger.warn(`PostHog: Unknown fine-tuned model: ${properties.model}`);
        }
      }
    }

    // Token usage
    if (provider === "wavespeed") {
      // Image generation proxy
      mapped.$ai_input_tokens = 0;
      mapped.$ai_output_tokens = 1;
    } else if (provider === "groq") {
      mapped.$ai_input_tokens = 0;
      mapped.$ai_output_tokens = properties.tokens || 0;
    } else if (provider === "openai" && properties.result?.usage) {
      // OpenAI responses.create API uses input_tokens/output_tokens
      mapped.$ai_input_tokens = properties.result.usage.input_tokens || 0;
      mapped.$ai_output_tokens = properties.result.usage.output_tokens || 0;
    } else if (provider === "openrouter" && properties.result?.usage) {
      // OpenRouter uses prompt_tokens/completion_tokens
      mapped.$ai_input_tokens = properties.result.usage.prompt_tokens || 0;
      mapped.$ai_output_tokens = properties.result.usage.completion_tokens || 0;
    }

    // Extract custom properties from entry if provided
    if (properties.entry) {
      const entry = properties.entry;
      if (entry.params) {
        if (entry.params.uid) mapped.uid = entry.params.uid;
        if (entry.params.sku) mapped.sku = entry.params.sku;
        if (entry.params.graphId) mapped.graph_id = entry.params.graphId;
        if (entry.params.identifier) mapped.identifier = entry.params.identifier;
        if (entry.params.chapter) mapped.chapter = entry.params.chapter;
        if (entry.params.outputFormat) mapped.output_format = entry.params.outputFormat;
        if (entry.params.modelParams) {
          mapped.$ai_model_parameters = {
            outputFormat: entry.params.outputFormat || "jpeg",
            ...entry.params.modelParams,
          };
        }
      }
      if (entry.entryType) mapped.queue_entry_type = entry.entryType;
    }

    // Add root fields for filtering in PostHog
    mapped.sku = properties.sku || properties.groups?.sku;
    mapped.uid = properties.uid || properties.groups?.uid;
    mapped.graph_id = properties.graphId || properties.groups?.graph_id;
    mapped.environment = ENVIRONMENT.value();

    return mapped;
  }

  /**
   * Check if properties are already in PostHog format
   * @private
   * @param {Object} properties - Properties to check
   * @return {boolean} True if already in PostHog format
   */
  isAlreadyMapped(properties) {
    const keys = Object.keys(properties);
    const posthogKeys = keys.filter((k) => k.startsWith("$"));
    return posthogKeys.length > keys.length * 0.3;
  }

  /**
   * Capture an analytics event
   * @param {string} eventName - Name of the event
   * @param {Object} properties - Event properties (can be raw data or already formatted)
   * @param {string} distinctId - Unique identifier for the user/session
   * @return {Promise<void>}
   */
  async captureEvent(eventName, properties = {}, distinctId = "system") {
    if (!this.isInitialized) {
      logger.debug("PostHog: Cannot capture event - provider not initialized");
      return;
    }

    try {
      let finalProperties = properties;

      // Check if properties need mapping
      if (!this.isAlreadyMapped(properties)) {
        finalProperties = this.mapAIProperties(properties);
      }

      // Add timestamp and internal event name to all events
      const enrichedProperties = {
        ...finalProperties,
        timestamp: new Date().toISOString(),
        internal_event_name: eventName, // The event name if not using PostHog
      };

      this.client.capture({
        distinctId,
        event: "$ai_generation", // PostHog expects this event name for the llm dashboard
        properties: enrichedProperties,
      });
    } catch (error) {
      // Don't let analytics errors break the application
      logger.debug(`PostHog: Failed to capture event (non-critical): ${error.message}`);
    }
  }

  /**
   * Flush pending events to PostHog
   * @return {Promise<void>}
   */
  async flush() {
    if (!this.isInitialized) {
      logger.debug("PostHog: Cannot flush - provider not initialized");
      return;
    }

    try {
      if (this.client) {
        await this.client.flush();
      }
    } catch (error) {
      logger.debug(`PostHog: Failed to flush events (non-critical): ${error.message}`);
    }
  }

  /**
   * Shutdown PostHog client
   * @return {Promise<void>}
   */
  async shutdown() {
    if (!this.isInitialized) {
      return;
    }

    try {
      if (this.client) {
        await this.client.shutdown();
        this.client = null;
      }
      this.isInitialized = false;
      logger.info("PostHog: Analytics provider shut down successfully");
    } catch (error) {
      logger.error(`PostHog: Failed to shutdown properly: ${error.message}`);
    }
  }
}

/**
 * Creates PostHog options object for analytics tracking
 * @param {Object} params - Parameters object
 * @param {string} params.uid - User ID
 * @param {string} params.graphId - Graph ID (optional)
 * @param {string} params.sku - Book SKU
 * @param {number} params.chapter - Chapter number (optional)
 * @param {string} params.promptId - Prompt ID
 * @param {string} params.traceId - Trace ID (optional)
 * @return {Object} PostHog options object with distinctId, traceId, and groups
 */
export function createPosthogOptions({uid, graphId=null, sku, chapter=null, promptId, traceId=null}) {
  // Construct traceId if not provided
  // Use graphId with promptId if provided, otherwise use sku with promptId
  // Also add chapter if provided
  if (!traceId) {
    traceId = `${graphId || sku}_${chapter ? `ch${chapter}` : ""}_${promptId}`;
  }
  return {
    distinctId: uid,
    traceId: traceId,
    uid: uid,
    sku: sku,
    graphId: graphId,
    promptId: promptId,
    properties: {
      uid: uid,
      sku: sku,
      graphId: graphId,
      promptId: promptId,
    },
    groups: {
      sku: sku,
      graphId: graphId,
    },
  };
}

export default PostHogProvider;
