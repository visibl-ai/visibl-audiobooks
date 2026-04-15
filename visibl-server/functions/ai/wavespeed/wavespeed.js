/* eslint-disable camelcase */
/* eslint-disable require-jsdoc */
import axios from "axios";
import logger from "../../util/logger.js";
import {
  WAVESPEED_API_KEY,
  MOCK_IMAGES,
} from "../../config/config.js";

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

async function generateImage(request) {
  const {
    prompt,
    model = "wavespeed-ai/flux-kontext-dev/multi",
    modelParams = {},
    webhookUrl,
  } = request;

  if (MOCK_IMAGES.value() === true) {
    logger.info("Mocking Wavespeed response - returning mock task ID");
    return {id: `mock-${Date.now()}`};
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
      };
      logger.debug(`Generating image with Wavespeed - using model path: ${model}, endpoint: ${endpoint}, prompt: ${prompt.substring(0, 100)}`);
    }

    // Add webhook URL as query parameter
    endpoint = `${endpoint}?webhook=${encodeURIComponent(webhookUrl)}`;
    logger.debug(`Wavespeed webhook URL: ${webhookUrl}`);

    // Submit task to Wavespeed
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

    // Return the task data - webhook will handle completion
    const result = submitResponse.data?.data;
    logger.debug(`Wavespeed task submitted, waiting for webhook callback. Task ID: ${result?.id}`);
    return result;
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
