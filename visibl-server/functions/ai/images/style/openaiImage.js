/**
 * @fileoverview Direct OpenAI image-edit adapter for scene styling.
 */

import logger from "../../../util/logger.js";
import {queueAddEntries} from "../../../storage/firestore/queue.js";
import {openaiImageQueueToUnique} from "../../queue/openaiImageQueue.js";
import {OPENAI_SCENE_IMAGE_MODEL, OPENAI_STREAMED_SCENE_IMAGE_PARAMS} from "../../openai/openaiImage.js";
import {dispatchTask} from "../../../util/dispatch.js";
import {getOriginImagesForScenes} from "./styleHelpers.js";

/**
 * Queue scenes for direct OpenAI image editing.
 * @param {Object} params Styling parameters.
 * @return {Promise<void>}
 */
export async function styleImage(params) {
  let {scenes, styleId, styleTitle, theme, defaultSceneId, modelConfig = {}, sku, uid} = params;

  if (!theme || theme.trim() === "") {
    throw new Error("Theme/prompt is required for styling");
  }
  const model = modelConfig.model || OPENAI_SCENE_IMAGE_MODEL;

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

    const timestamp = Date.now();
    const imagePath = `Scenes/${defaultSceneId}/${scene.chapter}_scene${scene.scene_number}_${styleId}_${styleTitle}_${timestamp}.styled`;
    types.push("openaiImage");
    entryTypes.push("edit");
    entryParams.push({
      prompt: theme,
      inputImageUrl: scene.imageGcp || scene.image,
      model,
      outputPath: `${imagePath}.jpeg`,
      outputFormat: "jpeg",
      modelParams: {
        ...OPENAI_STREAMED_SCENE_IMAGE_PARAMS,
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
    uniques.push(openaiImageQueueToUnique({
      type: "openaiImage",
      entryType: "edit",
      graphId: defaultSceneId,
      identifier: `${styleId}_${scene.chapter}_${scene.scene_number}`,
      chapter: scene.chapter,
      retry: true,
    }));
  }

  if (types.length > 0) {
    await queueAddEntries({types, entryTypes, entryParams, uniques});
    await dispatchTask({functionName: "launchOpenAiImageQueue", data: {}});
    logger.debug(`styleImage: Queued ${types.length} scenes for direct OpenAI editing with ${model}`);
  } else {
    logger.warn("styleImage: No scenes to process");
  }
}
