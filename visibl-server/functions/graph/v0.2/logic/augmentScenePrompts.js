/* eslint-disable require-jsdoc */
import logger from "../../../util/logger.js";
import {getGraph, storeGraph} from "../../../storage/storage.js";
import {openaiLLMRequest} from "../../../ai/openai/openaiLLM.js";
import {OpenAIMockResponse} from "../../../ai/openai/mock.js";
import graphPrompts from "../graphV0_2Prompts.js";
import {createAnalyticsOptions} from "../../../analytics/index.js";

/**
 * Remove markdown the model adds around an image prompt: a leading label line such as
 * "**Image generation prompt:**", heading markers, and bold/italic markers.
 * @param {string} text - Model output
 * @return {string} Plain-text prompt
 */
function stripMarkdown(text) {
  return text
      .replace(/^\s*(#+\s*)?(\*\*|__)?[\w\s-]{0,40}prompt(\*\*|__)?\s*(:(\*\*|__)?|\n)\s*/i, "")
      .replace(/^#+\s*/gm, "")
      .replace(/(\*\*|__)(.+?)\1/g, "$2")
      .replace(/\*\*/g, "")
      .replace(/(^|[^*\w])\*(?!\s)([^*\n]+?)\*(?!\w)/g, "$1$2")
      .trim();
}

async function augmentScenePrompts(params) {
  const {uid, sku, visibility, chapter, graphId} = params;
  logger.info(`${graphId} Augmenting scene prompts for chapter ${chapter}`);

  // Step 1: Load scenes from storage
  let globalScenes;
  try {
    globalScenes = await getGraph({
      uid,
      sku,
      visibility,
      type: "scenes",
      graphId,
    });
  } catch (error) {
    logger.error(`${graphId} Failed to load scenes for augmentation: ${error.message}`);
    return {error: "Failed to load scenes"};
  }

  // Get scenes for current chapter
  const chapterScenes = globalScenes[chapter];
  if (!chapterScenes || chapterScenes.length === 0) {
    logger.warn(`${graphId} No scenes found for chapter ${chapter}`);
    return {scenes: []};
  }

  logger.info(`${graphId} Processing ${chapterScenes.length} scenes for prompt augmentation`);

  // Step 2: Prepare one request per scene
  const scenesData = []; // Store scene data for fallback
  const requests = chapterScenes.map((scene, index) => {
    // Extract only the required fields for the prompt
    const sceneData = {
      description: scene.description,
      characters: scene.characters,
      locations: scene.locations,
      viewpoint: scene.viewpoint,
    };

    scenesData.push(sceneData); // Store for potential fallback

    return {
      promptOverride: graphPrompts["v0_2_augment_scene_prompt"],
      message: JSON.stringify(sceneData),
      responseKey: `${sku}_scene_${chapter}_${index}`,
      mockResponse: new OpenAIMockResponse({
        content: `Image prompt for ${sku} chapter ${chapter} scene ${scene.scene_number}`,
      }),
      analyticsOptions: createAnalyticsOptions({
        uid,
        graphId,
        sku,
        promptId: "v0_2_augment_scene_prompt",
      }),
    };
  });

  // Step 3: Process all requests in parallel; a scene whose request fails falls back to its JSON below
  logger.debug(`${graphId} Sending ${requests.length} scene augmentation requests`);

  const results = {};
  let totalTokens = 0;
  await Promise.all(requests.map(async (request) => {
    const response = await openaiLLMRequest(request);
    if (response.error) {
      logger.warn(`${graphId} Scene augmentation failed for ${request.responseKey}: ${response.error}`);
      return;
    }
    results[request.responseKey] = response.result;
    totalTokens += response.tokensUsed || 0;
  }));

  // Step 4: Add prompts to scenes
  const augmentedChapterScenes = chapterScenes.map((scene, index) => {
    const responseKey = `${sku}_scene_${chapter}_${index}`;
    const result = results[responseKey];

    if (result) {
      // Extract the string content from the result
      const promptText = typeof result === "string" ? stripMarkdown(result) :
                        (result.content || result.response || JSON.stringify(result));

      const truncatedPrompt = typeof promptText === "string" ?
                             promptText.substring(0, 100) :
                             String(promptText).substring(0, 100);

      if (typeof result !== "string") {
        logger.warn(`${graphId} Generated prompt for scene ${scene.scene_number} is not a string: ${JSON.stringify(result)}...`);
      } else {
        logger.debug(`${graphId} Generated prompt for scene ${scene.scene_number}: ${truncatedPrompt}...`);
      }

      return {
        ...scene,
        prompt: promptText,
      };
    } else {
      // Fallback if no result
      logger.warn(`${graphId} No prompt generated for scene ${scene.scene_number}, using JSON stringify of scene data as fallback`);
      return {
        ...scene,
        prompt: JSON.stringify(scenesData[index]), // Fallback to JSON stringify of scene data
      };
    }
  });

  // Step 5: Create/update augmented scenes object
  let augmentedScenes;
  try {
    // Try to load existing augmented scenes
    augmentedScenes = await getGraph({
      uid,
      sku,
      visibility,
      type: "augmentedScenes",
      graphId,
    });
  } catch (error) {
    // If augmented scenes don't exist yet, start fresh
    augmentedScenes = {};
  }

  // Update with the current chapter's augmented scenes
  augmentedScenes[chapter] = augmentedChapterScenes;

  // Step 6: Store augmented scenes
  await storeGraph({
    uid,
    sku,
    visibility,
    data: augmentedScenes,
    type: "augmentedScenes",
    graphId,
  });

  logger.info(`${graphId} Successfully augmented ${augmentedChapterScenes.length} scenes for chapter ${chapter}, used ${totalTokens} tokens`);

  return {
    chapter: chapter,
    scenes: augmentedChapterScenes,
    tokensUsed: totalTokens,
  };
}

export {augmentScenePrompts, stripMarkdown};
