/**
 * Queue configuration parameters
 * @fileoverview Defines queue-related configuration parameters
 */

import {defineString} from "firebase-functions/params";
import {createRateLimiter} from "../../storage/realtimeDb/rateLimiter.js";

/**
 * Size threshold for storing queue data in GCS (in bytes)
 * Default: 1MB (1024 * 1024 bytes)
 */
const FBDB_STORAGE_THRESHOLD = defineString("FBDB_STORAGE_THRESHOLD", {
  default: "0", // By default we store params and results in GCS
  // default: "1048576", // 1MB in bytes is the firestore limit
});

/**
 * Maximum number of items to retrieve from the queue at once
 * This helps optimize batch processing
 */
const QUEUE_BATCH_LIMIT = parseInt(process.env.QUEUE_BATCH_LIMIT || "2000", 10);

/**
 * Maximum number of retry attempts for failed queue items
 * This controls how many times a failed task will be retried before being marked as error
 */
const QUEUE_RETRY_LIMIT = parseInt(process.env.QUEUE_RETRY_LIMIT || "3", 10);

// Default high-limit rate limiter for generic queues
// This provides a very permissive default that effectively acts as no rate limiting
const defaultRateLimiter = createRateLimiter({
  serviceName: "generic-queue-default",
  options: {
    maxRequests: parseInt(process.env.DEFAULT_MAX_REQUESTS || "100000", 10), // 100k requests
    maxTokens: parseInt(process.env.DEFAULT_MAX_TOKENS || "100000000", 10), // 100M tokens
    windowSize: parseInt(process.env.DEFAULT_WINDOW_SIZE || "60000", 10), // 1 minute window
  },
});

// Rate limiter configurations for different AI models
const rateLimiters = {
  gemini: {
    "gemini-1.5-pro": createRateLimiter({
      serviceName: "gemini-pro",
      options: {
        maxRequests: parseInt(process.env.GEMINI_PRO_MAX_REQUESTS || "1000", 10),
        maxTokens: parseInt(process.env.GEMINI_PRO_MAX_TOKENS || "4000000", 10),
        windowSize: parseInt(process.env.GEMINI_PRO_WINDOW_SIZE || "60000", 10),
      },
    }),
    "gemini-1.5-flash": createRateLimiter({
      serviceName: "gemini-flash",
      options: {
        maxRequests: parseInt(process.env.GEMINI_FLASH_MAX_REQUESTS || "2000", 10),
        maxTokens: parseInt(process.env.GEMINI_FLASH_MAX_TOKENS || "4000000", 10),
        windowSize: parseInt(process.env.GEMINI_FLASH_WINDOW_SIZE || "60000", 10),
      },
    }),
  },
  openai: {
    "gpt-4": createRateLimiter({
      serviceName: "openai-gpt4",
      options: {
        maxRequests: parseInt(process.env.OPENAI_MAX_REQUESTS || "30000", 10),
        maxTokens: parseInt(process.env.OPENAI_MAX_TOKENS || "30000000", 10),
        windowSize: parseInt(process.env.OPENAI_WINDOW_SIZE || "60000", 10),
      },
    }),
    "gpt-4o": createRateLimiter({
      serviceName: "openai-gpt-4o",
      options: {
        maxRequests: parseInt(process.env.OPENAI_GPT4O_MAX_REQUESTS || "30000", 10),
        maxTokens: parseInt(process.env.OPENAI_GPT4O_MAX_TOKENS || "30000000", 10),
        windowSize: parseInt(process.env.OPENAI_GPT4O_WINDOW_SIZE || "60000", 10),
      },
    }),
    "gpt-4.1-mini": createRateLimiter({
      serviceName: "openai-gpt-4-1-mini",
      options: {
        maxRequests: parseInt(process.env.OPENAI_GPT41MINI_MAX_REQUESTS || "30000", 10),
        maxTokens: parseInt(process.env.OPENAI_GPT41MINI_MAX_TOKENS || "30000000", 10),
        windowSize: parseInt(process.env.OPENAI_GPT41MINI_WINDOW_SIZE || "60000", 10),
      },
    }),
    "ft:gpt-4.1-mini-2025-04-14:visibl:image-compose-ft:CDRdKUfs": createRateLimiter({
      serviceName: "openai-ft-gpt-4-1-mini",
      options: {
        maxRequests: parseInt(process.env.OPENAI_GPT41MINI_MAX_REQUESTS || "30000", 10),
        maxTokens: parseInt(process.env.OPENAI_GPT41MINI_MAX_TOKENS || "30000000", 10),
        windowSize: parseInt(process.env.OPENAI_GPT41MINI_WINDOW_SIZE || "60000", 10),
      },
    }),
    "gpt-4o-2024-08-06": createRateLimiter({
      serviceName: "openai-gpt-4o-2024-08-06",
      options: {
        maxRequests: parseInt(process.env.OPENAI_GPT4O20240806_MAX_REQUESTS || "30000", 10),
        maxTokens: parseInt(process.env.OPENAI_GPT4O20240806_MAX_TOKENS || "30000000", 10),
      },
    }),
  },
  modal: {
    "sdxl-outpaint-diffusers": createRateLimiter({
      serviceName: "modal-sdxl-outpaint",
      options: {
        maxRequests: parseInt(process.env.MODAL_SDXL_MAX_REQUESTS || "1000", 10), // 100 requests per minute
        windowSize: parseInt(process.env.MODAL_SDXL_WINDOW_SIZE || "60000", 10),
      },
    }),
  },
  imagerouter: {
    default: createRateLimiter({
      serviceName: "imagerouter-default",
      options: {
        maxRequests: parseInt(process.env.IMAGEROUTER_MAX_REQUESTS || "10", 10), // Default: 10 images per second.
        windowSize: parseInt(process.env.IMAGEROUTER_WINDOW_SIZE || "1000", 10), // 1 second window
      },
    }),
  },
  fal: {
    default: createRateLimiter({
      serviceName: "fal-default",
      options: {
        maxRequests: parseInt(process.env.FAL_MAX_REQUESTS || "10", 10), // Default: 10 images per second
        windowSize: parseInt(process.env.FAL_WINDOW_SIZE || "1000", 10), // 1 second window
      },
    }),
  },
  wavespeed: {
    default: createRateLimiter({
      serviceName: "wavespeed-default",
      options: {
        maxRequests: parseInt(process.env.WAVESPEED_MAX_REQUESTS || "100", 10), // 100 images per minute
        windowSize: parseInt(process.env.WAVESPEED_WINDOW_SIZE || "60000", 10), // 60 seconds (1 minute)
      },
    }),
  },
  openrouter: {
    default: createRateLimiter({
      serviceName: "openrouter-default",
      options: {
        maxRequests: parseInt(process.env.OPENROUTER_MAX_REQUESTS || "50", 10), // 50 requests per 5 seconds
        maxTokens: parseInt(process.env.OPENROUTER_MAX_TOKENS || "100000", 10), // 100k tokens per 5 seconds
        windowSize: parseInt(process.env.OPENROUTER_WINDOW_SIZE || "5000", 10), // 5-second window
      },
    }),
    transcription: createRateLimiter({
      serviceName: "openrouter-transcription",
      options: {
        maxRequests: parseInt(process.env.OPENROUTER_TRANSCRIPTION_MAX_REQUESTS || "50", 10), // 50 concurrent requests
        maxTokens: parseInt(process.env.OPENROUTER_TRANSCRIPTION_MAX_TOKENS || "100000", 10), // 100k tokens per 5 seconds
        windowSize: parseInt(process.env.OPENROUTER_TRANSCRIPTION_WINDOW_SIZE || "5000", 10), // 5-second window
      },
    }),
  },
  groq: {
    "whisper-large-v3-turbo": createRateLimiter({
      serviceName: "groq-whisper",
      options: {
        maxRequests: parseInt(process.env.GROQ_WHISPER_MAX_REQUESTS || "275", 10), // 275 requests per minute
        maxTokens: parseInt(process.env.GROQ_WHISPER_MAX_TOKENS || "1000000", 10), // 1M tokens per minute
        windowSize: parseInt(process.env.GROQ_WHISPER_WINDOW_SIZE || "60000", 10), // 60-second window
      },
    }),
  },
};

export {rateLimiters, defaultRateLimiter, FBDB_STORAGE_THRESHOLD, QUEUE_BATCH_LIMIT, QUEUE_RETRY_LIMIT};
