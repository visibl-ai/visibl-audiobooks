/**
 * @fileoverview Scene styling via fal.ai's ByteDance Seedream v4 edit model.
 */

import logger from "../../../util/logger.js";
import {queueAddEntries} from "../../../storage/firestore/queue.js";
import {falQueueToUnique} from "../../queue/falQueue.js";
import {FAL_PORTRAIT_SIZE, FAL_SEEDREAM_EDIT_MODEL} from "../../fal/fal.js";
import {dispatchTask} from "../../../util/dispatch.js";
import {getOriginImagesForScenes} from "./styleHelpers.js";

/**
 * Style scenes using fal's ByteDance Seedream v4 edit model
 * @param {Object} params - The parameters object
 * @param {Array} params.scenes - Array of scene objects to style
 * @param {string} params.styleId - The style ID to save styled images to
 * @param {string} params.styleTitle - The style title to save styled images to
 * @param {string} params.theme - The style/theme prompt to apply
 * @param {string} params.defaultSceneId - The default scene ID for getting origin images
 * @param {Object} params.modelConfig - Model configuration
 * @param {string} [params.modelConfig.model] - Specific fal endpoint to use
 * @param {Object} [params.modelConfig.modelParams] - Additional model parameters
 * @param {string} params.sku - Book SKU
 * @param {string} params.uid - User ID
 * @return {Promise<void>}
 */
export async function styleImage(params) {
  let {scenes, styleId, styleTitle, theme, defaultSceneId, modelConfig = {}, sku, uid} = params;

  if (!theme || theme.trim() === "") {
    logger.error(`styleImage: Cannot style without a valid theme/prompt for styleId ${styleId}`);
    throw new Error("Theme/prompt is required for styling");
  }

  const model = modelConfig.model || FAL_SEEDREAM_EDIT_MODEL;
  logger.debug(`styleImage: Using model ${model}`);

  const types = [];
  const entryTypes = [];
  const entryParams = [];
  const uniques = [];

  scenes = await getOriginImagesForScenes({scenes, defaultSceneId});

  for (const scene of scenes) {
    if (!scene.image) {
      logger.debug(`Skipping scene ${scene.scene_number} in chapter ${scene.chapter} - no image`);
      continue;
    }

    const imageUrl = scene.imageGcp || scene.image;
    logger.debug(`Processing scene ${scene.scene_number} in chapter ${scene.chapter} with image URL: ${imageUrl}`);

    types.push("fal");
    entryTypes.push("generate");
    const timestamp = Date.now();
    const imagePath = `Scenes/${defaultSceneId}/${scene.chapter}_scene${scene.scene_number}_${styleId}_${styleTitle}_${timestamp}.styled`;

    const queueParams = {
      prompt: theme,
      model,
      outputPath: `${imagePath}.jpeg`,
      outputFormat: "jpeg",
      modelParams: {
        image_urls: [imageUrl],
        image_size: FAL_PORTRAIT_SIZE,
        ...modelConfig.modelParams,
      },
      sku,
      uid,
      graphId: defaultSceneId,
      type: "sceneImage",
      defaultSceneId,
      styleId,
      styleTitle,
      chapter: scene.chapter,
      sceneNumber: scene.scene_number,
    };

    entryParams.push(queueParams);
    uniques.push(falQueueToUnique({
      type: "fal",
      entryType: "generate",
      graphId: defaultSceneId,
      identifier: `${styleId}_${scene.chapter}_${scene.scene_number}`,
      chapter: scene.chapter,
      retry: true,
    }));
  }

  if (types.length > 0) {
    await queueAddEntries({types, entryTypes, entryParams, uniques});
    await dispatchTask({functionName: "launchFalQueue", data: {}});
    logger.debug(`styleImage: Queued ${types.length} scenes for styling with model ${model}`);
  } else {
    logger.warn("styleImage: No scenes to process");
  }
}
