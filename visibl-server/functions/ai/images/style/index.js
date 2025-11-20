/**
 * @fileoverview Main style provider orchestrator
 * Handles provider selection and delegation for scene styling operations
 */

import {v4 as uuidv4} from "uuid";
import logger from "../../../util/logger.js";
import {
  styleImage as styleImageSeededit3,
  convertThemeToPrompt as convertThemeToPromptSeededit3,
} from "./seededit3.js";
import {
  catalogueAddStyleRtdb,
} from "../../../storage/realtimeDb/catalogue.js";
import {
  dispatchTask,
} from "../../../util/dispatch.js";
import {
  catalogueGetRtdb,
} from "../../../storage/realtimeDb/catalogue.js";
/**
 * Add scenes to the queue for styling with the specified provider
 * @param {Object} params - The parameters object
 * @param {Array} params.scenes - Array of scene objects to style
 * @param {string} params.styleId - The style ID to save styled images to
 * @param {string} params.styleTitle - The style title to save styled images to
 * @param {string} params.theme - The style/theme prompt to apply
 * @param {string} params.defaultSceneId - The default scene ID for getting origin images
 * @param {string} [params.provider="stability"] - The provider to use (stability, seededit3)
 * @param {Object} [params.modelConfig={}] - Provider-specific model configuration
 * @return {Promise<void>}
 */
async function styleScenesWithQueue(params) {
  const {
    scenes,
    styleId,
    styleTitle,
    theme,
    defaultSceneId,
    provider = "seededit3",
    modelConfig = {},
    sku,
    uid,
  } = params;

  if (styleId === defaultSceneId) {
    logger.warn(`styleScenesWithQueue: Skipping styling for default scene ${styleId} - this should not happen!`);
    return;
  }

  logger.debug(`styleScenesWithQueue: Using provider ${provider} for scene ${styleId} | Theme: ${theme} | Processing ${scenes.length} scenes`);
  // Validate provider
  const supportedProviders = ["seededit3"];
  if (!supportedProviders.includes(provider)) {
    logger.warn(`Unknown provider ${provider}, falling back to seededit3`);
  }

  // Delegate to provider-specific implementation
  switch (provider) {
    default:
      return await styleImageSeededit3({
        scenes,
        styleId,
        styleTitle,
        theme,
        defaultSceneId,
        modelConfig,
        sku,
        uid,
      });
  }
}

/**
 * Create a new style for a catalogue item
 * @param {Object} params - The parameters object
 * @param {string} params.uid - User ID creating the style
 * @param {string} params.sku - SKU of the catalogue item
 * @param {string} params.prompt - The style prompt/theme from user
 * @param {string} params.provider - The provider to use for styling (e.g., "seededit3")
 * @param {number} [params.currentTime] - Optional current playback time for partial generation
 * @param {number} [params.chapter=0] - Chapter number for generation
 * @return {Promise<Object>} The created style object
 */
async function createStyle({uid, sku, prompt, provider = "seededit3", currentTime, chapter = 0}) {
  // Check if prompt is undefined
  if (prompt === undefined) {
    throw new Error("Prompt cannot be undefined");
  }

  // Check if sku is undefined
  if (sku === undefined) {
    throw new Error("sku must be specified");
  }

  // Get graphId from catalogue
  const catalogueItem = await catalogueGetRtdb({sku});
  if (!catalogueItem) {
    throw new Error(`Catalogue item not found for sku ${sku}`);
  }
  const graphId = catalogueItem.defaultGraphId;
  if (!graphId) {
    throw new Error(`Default graph not found for sku ${sku}`);
  }

  // Process prompt through provider-specific conversion
  let sanitizedPrompt;
  switch (provider) {
    case "seededit3":
      sanitizedPrompt = await convertThemeToPromptSeededit3({uid, graphId, sku, prompt});
      break;
    default:
      throw new Error(`Unsupported provider: ${provider}`);
  }

  logger.debug(`Using provider ${provider} for style creation`);

  // Generate UUID for styleId
  const styleId = uuidv4();
  logger.debug(`Creating style for sku: ${sku} with id: ${styleId}`);

  const newStyle = {
    uid,
    prompt: sanitizedPrompt.prompt,
    title: sanitizedPrompt.title,
    category: sanitizedPrompt.category,
    sku,
    styleId,
    userPrompt: prompt,
    provider,
  };

  // Add style to catalogue RTDB
  await catalogueAddStyleRtdb(newStyle);

  // Dispatch image generation tasks
  if (currentTime) {
    logger.debug(`New Style: currentTime found, generating scenes at currentTime: ${currentTime}`);
    await dispatchTask({
      functionName: "generateSceneImagesCurrentTime",
      data: {styleId, currentTime, sku},
    });
  } else {
    logger.warn(`New Style: No currentTime found! Assuming it is 0. This is not supported yet. Client Error!`);
  }

  return {id: styleId, ...newStyle};
}

export {styleScenesWithQueue, createStyle};
