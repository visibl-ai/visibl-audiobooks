/* eslint-disable camelcase */
/* eslint-disable require-jsdoc */
import axios from "axios";
import {Readable} from "stream";
import logger from "../../util/logger.js";
import {
  WAVESPEED_API_KEY,
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

// Model configurations for different Wavespeed models
const WAVESPEED_MODELS = {
  "wavespeed-ai/flux-kontext-dev/multi": {
    endpoint: "https://api.wavespeed.ai/api/v3/wavespeed-ai/flux-kontext-dev/multi",
    params: {
      num_inference_steps: 28,
      guidance_scale: 2.5,
      num_images: 1,
      output_format: "jpeg",
    },
  },
  "wavespeed-ai/flux-kontext-dev-ultra-fast": {
    endpoint: "https://api.wavespeed.ai/api/v3/wavespeed-ai/flux-kontext-dev-ultra-fast",
    params: {
      num_inference_steps: 28,
      guidance_scale: 2.5,
      num_images: 1,
      output_format: "jpeg",
    },
  },
};

async function pollWavespeedResult(pollUrl, pollingConfig) {
  const {
    initialWait = 5000,
    interval = 1000,
    maxAttempts = 60,
  } = pollingConfig;

  // Track start time for duration logging
  const startTime = Date.now();

  logger.info(`Starting polling for Wavespeed task. URL: ${pollUrl}`);

  // Wait initial time before first poll
  logger.debug(`Waiting ${initialWait}ms before first poll...`);
  await new Promise((resolve) => setTimeout(resolve, initialWait));

  // Poll for the result
  let attempts = 0;

  while (attempts < maxAttempts) {
    attempts++;
    logger.debug(`Wavespeed: Polling attempt ${attempts}/${maxAttempts}...`);

    const pollResponse = await axios.get(
        pollUrl,
        {
          headers: {
            "Authorization": `Bearer ${WAVESPEED_API_KEY.value()}`,
            "Content-Type": "application/json",
          },
          validateStatus: undefined,
          timeout: 2000,
        },
    );

    if (pollResponse.status !== 200) {
      logger.error(`Polling failed with status ${pollResponse.status}: ${JSON.stringify(pollResponse.data)}`);
      throw new Error(`Polling failed with status ${pollResponse.status}`);
    }

    const pollResult = pollResponse.data?.data;

    // Check if the task is completed
    if (pollResult && pollResult.status === "completed") {
      if (pollResult.outputs && pollResult.outputs[0]) {
        const duration = Date.now() - startTime;
        logger.info(`Wavespeed polling completed successfully after ${attempts} attempts in ${duration}ms (${(duration / 1000).toFixed(2)}s)`);
        return pollResult.outputs[0];
      } else {
        throw new Error(`Task completed but no image data found in response`);
      }
    } else if (pollResult && (pollResult.status === "failed" || pollResult.status === "error" ||
                              pollResult?.data?.status === "failed" || pollResult?.data?.status === "error")) {
      const errorMessage = pollResult.error || pollResult?.data?.error || "Unknown error";
      const status = pollResult.status || pollResult?.data?.status || "failed";
      const duration = Date.now() - startTime;
      logger.error(`Wavespeed task failed after ${duration}ms (${(duration / 1000).toFixed(2)}s)`);

      // Check if content was filtered (content policy violation)
      if (
        errorMessage.toLowerCase().includes("filtered") ||
        errorMessage.toLowerCase().includes("violated") ||
        errorMessage.toLowerCase().includes("content policy")
      ) {
        logger.warn(`Content was filtered by safety checks: ${errorMessage}`);
        const error = new Error(`Wavespeed content policy violation: ${errorMessage}`);
        error.isContentFiltered = true; // Add a flag to identify filtered content
        throw error;
      }

      throw new Error(`Wavespeed task ${status}: ${errorMessage}`);
    }

    // Task still processing, wait before next poll
    // logger.debug(`Task status: ${pollResult?.status || "unknown"}, waiting ${interval}ms before next poll...`);
    await new Promise((resolve) => setTimeout(resolve, interval));
  }

  // Max attempts reached
  const duration = Date.now() - startTime;
  logger.error(`Wavespeed polling timeout after ${duration}ms (${(duration / 1000).toFixed(2)}s) and ${maxAttempts} attempts`);
  throw new Error(`Polling timeout: Task did not complete within ${maxAttempts} attempts`);
}

async function generateImage(request) {
  const {
    prompt,
    model = "wavespeed-ai/flux-kontext-dev/multi",
    outputPath,
    outputFormat = "jpg",
    modelParams = {},
    pollingConfig = {},
  } = request;

  if (MOCK_IMAGES.value() === true) {
    // Read from mock image file
    logger.info("Mocking Wavespeed response");
    const mockImagePath = path.join(path.dirname(new URL(import.meta.url).pathname), "wavespeed-mock.jpeg");
    const mockImageBuffer = await fs.readFile(mockImagePath);
    const stream = Readable.from(mockImageBuffer);
    return await uploadStreamAndGetCDNLink({stream: sharpStream({format: outputFormat, sourceStream: stream}), filename: outputPath});
  }

  let endpoint;
  let input;
  let modelConfig;

  try {
    // Check if model is in our presets
    modelConfig = WAVESPEED_MODELS[model];
    if (modelConfig) {
      // Use preset configuration
      endpoint = modelConfig.endpoint;
      // Merge default params with model-specific params and user-provided params
      input = {
        prompt: prompt,
        ...modelConfig.params,
        ...modelParams,
        enable_safety_checker: false, // Always override to false
        enable_base64_output: true, // Always override to true
        enable_sync_mode: true, // Always override to true
      };
      logger.debug(`Generating image with Wavespeed - using preset model: ${model}, prompt: ${prompt.substring(0, 100)}`);
    } else {
      // Assume it's a model path like "wavespeed-ai/some-model/variant"
      // Construct the endpoint URL
      endpoint = `https://api.wavespeed.ai/api/v3/${model}`;
      input = {
        prompt: prompt,
        ...modelParams, // User has full control over parameters
        enable_safety_checker: false, // Always override to false
        enable_base64_output: true, // Always override to true
        enable_sync_mode: true, // Always override to true
      };
      logger.debug(`Generating image with Wavespeed - using model path: ${model}, endpoint: ${endpoint}, prompt: ${prompt.substring(0, 100)}`);
    }

    // Step 1: Submit task to Wavespeed
    logger.debug(`Submitting to Wavespeed endpoint: ${endpoint}`);
    logger.debug(`Request payload: ${JSON.stringify(input)}`);

    const submitResponse = await axios.post(
        endpoint,
        input,
        {
          headers: {
            "Authorization": `Bearer ${WAVESPEED_API_KEY.value()}`,
            "Content-Type": "application/json",
          },
          validateStatus: undefined,
        },
    );

    logger.debug(`Wavespeed task submission response status: ${submitResponse.status}`);

    if (submitResponse.status !== 200) {
      const errorMessage = JSON.stringify(submitResponse.data);
      logger.error(`Wavespeed API error: ${submitResponse.status} - ${errorMessage}`);
      throw new Error(`Wavespeed API error: ${submitResponse.status} - ${errorMessage}`);
    }

    // Get the result data
    const result = submitResponse.data?.data;
    let base64Image;

    // Check if sync mode returned the image directly
    if (result && result.outputs && result.outputs[0]) {
      base64Image = result.outputs[0];
      logger.debug(`Wavespeed sync mode returned base64 image`);
    } else if (result && result.urls && result.urls.get) {
      // Need to poll for the result
      logger.debug(`Wavespeed sync response missing base64 image data, polling required. Response: ${JSON.stringify(submitResponse.data)}`);
      base64Image = await pollWavespeedResult(result.urls.get, pollingConfig);
    } else {
      // Neither sync response nor polling URL available
      logger.error(`Wavespeed response has neither outputs nor polling URL. Response: ${JSON.stringify(submitResponse.data)}`);
      throw new Error(`No base64 image data or polling URL in response from Wavespeed`);
    }

    // Process the base64 image (common code path)
    // Extract base64 data (remove data URL prefix if present)
    let base64Data = base64Image;
    if (base64Image.startsWith("data:")) {
      const commaIndex = base64Image.indexOf(",");
      if (commaIndex !== -1) {
        base64Data = base64Image.substring(commaIndex + 1);
      }
    }

    // Convert base64 string to buffer
    const buffer = Buffer.from(base64Data, "base64");
    const stream = Readable.from(buffer);
    logger.debug(`Wavespeed image generation complete ${outputPath}`);

    const cdnResult = await uploadStreamAndGetCDNLink({stream: sharpStream({format: outputFormat, sourceStream: stream}), filename: outputPath});
    return {
      ...cdnResult,
      ...result,
    };
  } catch (error) {
    // Log error details in a structured way
    logger.error(`Wavespeed API error: ${error.message}`);

    // Check if it's a validation error with detailed information
    if (error.response && error.response.data) {
      const errorData = error.response.data;
      logger.error(`Error response: ${JSON.stringify(errorData)}`);
      logger.error(`Failed endpoint: ${endpoint}`);
      logger.error(`Model: ${model}`);
      if (error.response.status) {
        logger.error(`Status: ${error.response.status}`);
      }
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

/**
 * Search for billing information for a given prediction UUID
 * @param {Object} params - The parameters object
 * @param {Array} params.prediction_uuids - The prediction UUIDs to search for (required)
 * @param {number} params.start_time - The start time to search for
 * @param {number} params.end_time - The end time to search for
 * @param {number} params.page_size - The page size of results to return
 * @param {number} params.page - The page number of results to return
 * @param {string} params.sort - The field to sort by
 * @param {string} params.billing_type - The billing type to search for
 * @return {Promise<Object>} The billing information
 */
async function searchBilling(params) {
  const {prediction_uuids} = params;
  if (!prediction_uuids || prediction_uuids.length === 0) {
    throw new Error("prediction_uuids is required");
  }
  const response = await axios.post(
      "https://api.wavespeed.ai/api/v3/billings/search",
      params,
      {
        headers: {
          "Authorization": `Bearer ${WAVESPEED_API_KEY.value()}`,
          "Content-Type": "application/json",
        },
      },
  );
  return response.data;
}

export {
  generateImage,
  queueEntryTypeToFunction,
  searchBilling,
  WAVESPEED_MODELS,
};
