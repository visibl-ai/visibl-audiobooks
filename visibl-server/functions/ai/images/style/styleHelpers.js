import {getData} from "../../../storage/realtimeDb/database.js";
import logger from "../../../util/logger.js";
import {openaiLLMRequest} from "../../openai/openaiLLM.js";
import {OpenAIMockResponse} from "../../openai/mock.js";
import {createAnalyticsOptions} from "../../../analytics/index.js";
import stylePrompts from "../../prompts/stylePrompts.js";

/**
 * Retrieves the origin images and related metadata for each scene in the provided array.
 * Updates each scene object in-place with the image, prompt, sceneId, and imageBucketPath from the origin scene.
 *
 * @async
 * @function getOriginImagesForScenes
 * @param {Object} params - The parameters object.
 * @param {Array<Object>} params.scenes - Array of scene objects to update with origin image data.
 * @param {string} params.defaultSceneId - The default scene ID for getting origin images.
 * @return {Promise<void>} Resolves when all scenes have been processed.
 */
async function getOriginImagesForScenes({scenes, defaultSceneId}) {
  // Get the images to style from origin scene
  for (const scene of scenes) {
    // Scene numbers start at 0.
    const ref = `scenes/${defaultSceneId}/${scene.chapter}/${scene.scene_number}`;
    const originScene = await getData({ref});
    if (originScene && originScene.image) {
      scene.image = originScene.image;
      scene.prompt = originScene.prompt;
      scene.sceneId = originScene.sceneId;
      scene.imageBucketPath = originScene.imageBucketPath; // Also get bucket path if available
      if (originScene.imageGcp) {
        scene.imageGcp = originScene.imageGcp;
      }
    }
  }
  // Filter out scenes without images
  scenes = scenes.filter((scene) => scene.image !== undefined);
  logger.debug(`Filtered out scenes without images, there are ${scenes.length} remaining.`);
  logger.debug(`getOriginImagesForScenes: Scenes to process: ${JSON.stringify(scenes.map((s) => ({
    chapter: s.chapter,
    scene_number: s.scene_number,
    has_image: !!s.image,
  })))}`);
  return scenes;
}

/**
 * Convert theme to prompt for a generic provider
 * @param {string|Object} prompt - The user's theme/prompt input
 * @param {string} uid - User ID
 * @param {string} graphId - Graph ID
 * @param {string} sku - Book SKU
 * @return {Promise<Object>} Sanitized prompt object with title and prompt fields
 */
async function convertThemeToPrompt({uid, graphId, sku, prompt}) {
  // IN TESTS - we can pass in a prompt object for testing.
  if (typeof prompt === "object" && prompt !== null) {
    // If prompt is already an object, use it as is
    return prompt;
  }

  const sanitizedPrompt = await openaiLLMRequest({
    promptOverride: stylePrompts.genericStyle,
    message: prompt,
    replacements: [],
    mockResponse: new OpenAIMockResponse({
      content: {
        title: "mockTitle",
        prompt: `Transform this image into a scene that belongs in the world of ${prompt}, with cinematic lighting, costumes, and atmosphere fully adapted to that universe`,
      },
    }),
    analyticsOptions: createAnalyticsOptions({uid, graphId, sku, promptId: "genericStyle"}),
  });

  if (sanitizedPrompt.result) {
    logger.debug(`Sanitized prompt ${sanitizedPrompt.result.title}:${sanitizedPrompt.result.prompt} from ${prompt}`);
    return sanitizedPrompt.result;
  } else {
    logger.error(`No sanitized prompt found for ${sanitizedPrompt}`);
    throw new Error("No sanitized prompt found");
  }
}

export {
  getOriginImagesForScenes,
  convertThemeToPrompt,
};
