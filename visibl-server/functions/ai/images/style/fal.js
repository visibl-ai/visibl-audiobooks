/**
 * @fileoverview Generic fal.ai image-edit adapter for model comparisons.
 */

import logger from "../../../util/logger.js";
import {queueAddEntries} from "../../../storage/firestore/queue.js";
import {falQueueToUnique} from "../../queue/falQueue.js";
import {dispatchTask} from "../../../util/dispatch.js";
import {getOriginImagesForScenes} from "./styleHelpers.js";

/**
 * Queue scenes for a configurable fal.ai image-edit endpoint.
 * @param {Object} params - Styling parameters.
 * @return {Promise<void>}
 */
export async function styleImage(params) {
  let {scenes, styleId, styleTitle, theme, defaultSceneId, modelConfig = {}, sku, uid} = params;

  if (!theme || theme.trim() === "") {
    throw new Error("Theme/prompt is required for styling");
  }
  if (!modelConfig.model) {
    throw new Error("A fal model endpoint is required");
  }

  const imageParam = modelConfig.imageParam || "image_urls";
  const promptParam = modelConfig.promptParam || "prompt";
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
    const imageInput = imageParam === "image_url" ? imageUrl : [imageUrl];
    const timestamp = Date.now();
    const imagePath = `Scenes/${defaultSceneId}/${scene.chapter}_scene${scene.scene_number}_${styleId}_${styleTitle}_${timestamp}.styled`;

    types.push("fal");
    entryTypes.push("generate");
    entryParams.push({
      prompt: theme,
      promptParam,
      model: modelConfig.model,
      outputPath: `${imagePath}.jpeg`,
      outputFormat: "jpeg",
      modelParams: {
        [imageParam]: imageInput,
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
    });
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
    logger.debug(`styleImage: Queued ${types.length} scenes for styling with model ${modelConfig.model}`);
  } else {
    logger.warn("styleImage: No scenes to process");
  }
}
