/* eslint-disable camelcase */
/* eslint-disable require-jsdoc */
import {fal} from "@fal-ai/client";
import axios from "axios";
import {Readable} from "stream";
import logger from "../../util/logger.js";
import {
  FAL_API_KEY,
  MOCK_IMAGES,
} from "../../config/config.js";

import {
  uploadStreamAndGetCDNLink,
} from "../../storage/storage.js";

import {
  sharpStream,
} from "../../util/sharp.js";

import path from "path";
import fs from "fs/promises";

// Model configurations for different Fal.ai models
const FAL_MODELS = {
  "imagen4-ultra": {
    endpoint: "fal-ai/imagen4/preview/ultra",
    params: {
      aspect_ratio: "9:16", // default
      num_images: 1,
    },
  },
  "seedream-v3": {
    endpoint: "fal-ai/bytedance/seedream/v3/text-to-image",
    params: {
      num_images: 1,
      guidance_scale: 2.5,
    },
  },
};

async function generateImage(request) {
  // Initialize Fal client with API key at runtime
  fal.config({
    credentials: FAL_API_KEY.value(),
  });
  const {
    prompt,
    negativePrompt,
    model = "imagen4-ultra",
    outputPath,
    outputFormat = "jpg",
    modelParams = {},
  } = request;

  if (MOCK_IMAGES.value() === true) {
    // Read from mock image file
    logger.info("Mocking Fal response");
    const mockImagePath = path.join(path.dirname(new URL(import.meta.url).pathname), "fal-mock.jpeg");
    const mockImageBuffer = await fs.readFile(mockImagePath);
    const stream = Readable.from(mockImageBuffer);
    return await uploadStreamAndGetCDNLink({stream: sharpStream({format: outputFormat, sourceStream: stream}), filename: outputPath});
  }

  let endpoint;
  let input;

  try {
    // Check if model is a full endpoint path (contains "/")
    if (model.includes("/")) {
      // Use model directly as endpoint
      endpoint = model;
      input = {
        prompt: prompt,
        ...modelParams, // User has full control over parameters
      };
      // Add negative prompt if provided
      if (negativePrompt) {
        input.negative_prompt = negativePrompt;
      }
      logger.debug(`Generating image with Fal - using direct endpoint: ${endpoint}, prompt: ${prompt.substring(0, 100)}`);
    } else {
      // Use existing FAL_MODELS lookup for convenience
      const modelConfig = FAL_MODELS[model];
      if (!modelConfig) {
        throw new Error(`Unknown Fal model preset: ${model}. Available presets: ${Object.keys(FAL_MODELS).join(", ")}. You can also provide a full endpoint path like "fal-ai/model-name"`);
      }
      endpoint = modelConfig.endpoint;
      // Merge default params with model-specific params and user-provided params
      input = {
        prompt: prompt,
        ...modelConfig.params,
        ...modelParams,
      };
      // Add negative prompt if provided
      if (negativePrompt) {
        input.negative_prompt = negativePrompt;
      }
      logger.debug(`Generating image with Fal - using preset model: ${model} (${endpoint}), prompt: ${prompt.substring(0, 100)}`);
    }

    // Use fal.run as requested
    const result = await fal.run(endpoint, {
      input: input,
    });

    logger.debug(`Fal API response: ${JSON.stringify(result)}`);

    // Extract image URL from response
    // Response can be either { images: [...] } or { data: { images: [...] } }
    const images = result.images || result.data?.images;
    const imageUrl = images?.[0]?.url;

    if (!imageUrl) {
      logger.error(`Fal response missing URL. Model: ${model}, Response: ${JSON.stringify(result)}`);
      logger.error(`Failed prompt (first 200 chars): ${prompt.substring(0, 200)}...`);
      throw new Error(`No image URL in response from model ${model}. Response: ${JSON.stringify(result)}`);
    }

    logger.debug(`Fal returned image URL: ${imageUrl}`);

    // Download the image from the URL
    const imageResponse = await axios.get(imageUrl, {
      responseType: "arraybuffer",
    });

    const buffer = Buffer.from(imageResponse.data);
    const stream = Readable.from(buffer);
    logger.debug(`Fal image generation complete ${outputPath}`);

    return await uploadStreamAndGetCDNLink({stream: sharpStream({format: outputFormat, sourceStream: stream}), filename: outputPath});
  } catch (error) {
    // Log error details in a structured way
    logger.error(`Fal API error: ${error.message}`);
    logger.error(`Timestamp: ${new Date().toISOString()}`);

    // Log if API key is present
    logger.error(`API key present: ${!!FAL_API_KEY.value()}`);

    // Log the full input that was sent to FAL
    logger.error(`Input sent to FAL: ${JSON.stringify(input, null, 2)}`);

    // Log endpoint and model
    logger.error(`Failed endpoint: ${endpoint}`);
    logger.error(`Model: ${model}`);

    // Check for different error structures
    if (error.status) {
      logger.error(`HTTP Status: ${error.status}`);
    }

    // Log axios error response if available
    if (error.response) {
      logger.error(`Axios response status: ${error.response.status}`);
      logger.error(`Axios response data: ${JSON.stringify(error.response.data, null, 2)}`);
      logger.error(`Axios response statusText: ${error.response.statusText}`);
    }

    // Log the full error body if available
    if (error.body) {
      logger.error(`Error body: ${JSON.stringify(error.body, null, 2)}`);

      // Check if it's a validation error with detailed information
      if (error.body.detail && Array.isArray(error.body.detail)) {
        const details = error.body.detail[0];
        const isContentViolation = details.type === "content_policy_violation";
        const logLevel = isContentViolation ? "warn" : "error";

        if (isContentViolation) {
          logger.warn(`Content policy violation for prompt: ${prompt.substring(0, 100)}...`);
        }
        logger[logLevel](`Error type: ${details.type || "unknown"}`);
        logger[logLevel](`Error message: ${details.msg || "No message"}`);
        if (details.url) {
          logger.error(`More info: ${details.url}`);
        }
      }
    }

    // Log any additional error properties
    const errorKeys = Object.keys(error).filter((key) => !["message", "status", "response", "body"].includes(key));
    if (errorKeys.length > 0) {
      logger.error(`Additional error properties: ${errorKeys.join(", ")}`);
      errorKeys.forEach((key) => {
        try {
          logger.error(`error.${key}: ${JSON.stringify(error[key], null, 2)}`);
        } catch (e) {
          logger.error(`error.${key}: [Unable to stringify]`);
        }
      });
    }

    throw error;
  }
}

const queueEntryTypeToFunction = (entryType) => {
  switch (entryType) {
    case "generate":
      return generateImage;
    case "failure":
      return () => {
        throw new Error("This is a test error");
      };
    default:
      throw new Error(`Unknown entry type: ${entryType}`);
  }
};

export {
  generateImage,
  queueEntryTypeToFunction,
  FAL_MODELS,
};

