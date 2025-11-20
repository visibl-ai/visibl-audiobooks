/**
 * @fileoverview Wavespeed-specific implementation for scene styling
 * Uses Wavespeed's ByteDance SeededEdit-v3 model for style transfer
 */

import logger from "../../../util/logger.js";
import {queueAddEntries} from "../../../storage/firestore/queue.js";
import {wavespeedQueueToUnique} from "../../queue/wavespeedQueue.js";
import {dispatchTask} from "../../../util/dispatch.js";
import {getOriginImagesForScenes} from "./styleHelpers.js";
import {OpenRouterClient} from "../../openrouter/base.js";
import {OpenRouterMockResponse} from "../../openrouter/mock.js";
import stylePrompts from "../../prompts/stylePrompts.js";
import {createAnalyticsOptions} from "../../../analytics/index.js";

/**
 * Convert theme to prompt for Wavespeed provider
 * @param {string|Object} prompt - The user's theme/prompt input
 * @param {string} uid - User ID
 * @param {string} graphId - Graph ID
 * @param {string} sku - Book SKU
 * @return {Promise<Object>} Sanitized prompt object with title and prompt fields
 */
export async function convertThemeToPrompt({uid, graphId, sku, prompt}) {
  // IN TESTS - we can pass in a prompt object for testing.
  if (typeof prompt === "object" && prompt !== null) {
    // If prompt is already an object, use it as is
    return prompt;
  }

  const openRouterClient = new OpenRouterClient();
  const sanitizedPrompt = await openRouterClient.sendRequest({
    promptOverride: stylePrompts.seededit3Style,
    message: prompt,
    replacements: [],
    mockResponse: new OpenRouterMockResponse({
      content: {
        title: "mockTitle",
        prompt: `Transform this image into a scene that belongs in the world of ${prompt}, with cinematic lighting, costumes, and atmosphere fully adapted to that universe`,
      },
    }),
    analyticsOptions: createAnalyticsOptions({uid, graphId, sku, promptId: "seededit3_style"}),
  });

  if (sanitizedPrompt.result) {
    logger.debug(`Sanitized prompt ${sanitizedPrompt.result.title}:${sanitizedPrompt.result.prompt} from ${prompt}`);
    return sanitizedPrompt.result;
  } else {
    logger.error(`No sanitized prompt found for ${sanitizedPrompt}`);
    throw new Error("No sanitized prompt found");
  }
}

/**
 * Style scenes using Wavespeed's ByteDance SeededEdit-v3 model
 * @param {Object} params - The parameters object
 * @param {Array} params.scenes - Array of scene objects to style
 * @param {string} params.styleId - The style ID to save styled images to
 * @param {string} params.styleTitle - The style title to save styled images to
 * @param {string} params.theme - The style/theme prompt to apply
 * @param {string} params.defaultSceneId - The default scene ID for getting origin images
 * @param {Object} params.modelConfig - Model configuration
 * @param {string} [params.modelConfig.model] - Specific Wavespeed model to use
 * @param {Object} [params.modelConfig.modelParams] - Additional model parameters
 * @param {string} params.sku - Book SKU
 * @param {string} params.uid - User ID
 * @param {string} params.graphId - Graph ID
 * @return {Promise<void>}
 */
export async function styleImage(params) {
  let {scenes, styleId, styleTitle, theme, defaultSceneId, modelConfig = {}, sku, uid} = params;

  if (!theme || theme.trim() === "") {
    logger.error(`styleWithWavespeed: Cannot style without a valid theme/prompt for styleId ${styleId}`);
    throw new Error("Theme/prompt is required for styling");
  }

  // Default to ByteDance SeededEdit-v3 model
  const model = modelConfig.model || "bytedance/seededit-v3";

  logger.debug(`styleImage: Using model ${model}`);

  // Prepare queue entries
  const types = [];
  const entryTypes = [];
  const entryParams = [];
  const uniques = [];

  scenes = await getOriginImagesForScenes({scenes, defaultSceneId});

  // Create queue entries for each scene
  for (const scene of scenes) {
    // Skip scenes without images
    if (!scene.image) {
      logger.debug(`Skipping scene ${scene.scene_number} in chapter ${scene.chapter} - no image`);
      continue;
    }

    // Use the image URL directly - it's already a public URL
    let imageUrl;
    if (scene.imageGcp) {
      imageUrl = scene.imageGcp;
    } else {
      imageUrl = scene.image; // If this is not JPEG it will fail.
    }
    logger.debug(`Processing scene ${scene.scene_number} in chapter ${scene.chapter} with image URL: ${imageUrl}`);

    types.push("wavespeed");
    entryTypes.push("generate");
    const timestamp = Date.now();

    // Output path for styled image
    const imagePath = `Scenes/${defaultSceneId}/${scene.chapter}_scene${scene.scene_number}_${styleId}_${styleTitle}_${timestamp}.styled`;

    // Build the parameters for Wavespeed queue
    // The wavespeed generateImage function expects modelParams.image to contain the public URL
    const params = {
      prompt: theme,
      model: model,
      outputPath: `${imagePath}.jpeg`,
      outputFormat: "jpeg",
      modelParams: {
        // SeededEdit-v3 API expects 'image' parameter with the source image URL
        image: imageUrl,
        // Default parameters for SeededEdit-v3
        guidance_scale: modelConfig.modelParams?.guidance_scale || 0.75,
        seed: modelConfig.modelParams?.seed || -1,
        // Additional parameters from config (will override defaults if provided)
        ...modelConfig.modelParams,
        // Ensure these are set for the API
        enable_base64_output: true,
        enable_sync_mode: true,
      },
      pollingConfig: {
        initialWait: 8000, // 5 seconds
        interval: 1000, // 1 second
        maxAttempts: 45, // Max 60 attempts
      },
      sku: sku,
      uid: uid,
      graphId: defaultSceneId,
    };

    // Store scene metadata for tracking
    params.type = "sceneImage"; // Critical for triggering RTDB update
    params.defaultSceneId = defaultSceneId;
    params.styleId = styleId;
    params.styleTitle = styleTitle;
    params.chapter = scene.chapter;
    params.sceneNumber = scene.scene_number; // Use sceneNumber (not scene_number) for consistency

    entryParams.push(params);

    // Generate unique identifier for deduplication
    uniques.push(wavespeedQueueToUnique({
      type: "wavespeed",
      entryType: "generate",
      graphId: defaultSceneId, // Using defaultSceneId as graphId for consistency
      identifier: `${styleId}_${scene.chapter}_${scene.scene_number}`,
      chapter: scene.chapter,
      retry: true,
    }));
  }

  // Add entries to queue
  if (types.length > 0) {
    await queueAddEntries({
      types,
      entryTypes,
      entryParams,
      uniques,
    });

    // Dispatch the Wavespeed queue processor
    await dispatchTask({
      functionName: "launchWavespeedQueue",
      data: {},
    });

    logger.debug(`styleImage: Queued ${types.length} scenes for styling with model ${model}`);
  } else {
    logger.warn(`styleImage: No scenes to process`);
  }
}
