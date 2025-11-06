/* eslint-disable require-jsdoc */
import logger from "../../../util/logger.js";
import {getGraph, storeGraph} from "../../../storage/storage.js";
import {batchDispatchOpenaiRequests} from "../../../ai/queue/dispatcher.js";
import graphPrompts from "../graphV0_1Prompts.js";
import {OpenAIMockResponse} from "../../../ai/openai/mock.js";

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

  // Step 2: Prepare batch requests for OpenAI queue
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
      prompt: "v0_1_augment_scene_prompt",
      promptOverride: graphPrompts["v0_1_augment_scene_prompt"],
      message: JSON.stringify(sceneData),
      responseKey: `${sku}_scene_${chapter}_${index}`,
      mockResponse: new OpenAIMockResponse({
        content: `Image prompt for ${sku} chapter ${chapter} scene ${scene.scene_number}`,
        tokensUsed: 50,
        model: "ft:gpt-4.1-mini-2025-04-14:visibl:image-compose-ft:CDRdKUfs",
      }),
    };
  });

  // Step 3: Process all requests in parallel using the batch dispatch system
  logger.debug(`${graphId} Dispatching ${requests.length} requests to OpenAI fine-tuned model`);

  let results;
  try {
    results = await batchDispatchOpenaiRequests({
      requests,
      model: "ft:gpt-4.1-mini-2025-04-14:visibl:image-compose-ft:CDRdKUfs",
      maxAttempts: 60,
      pollInterval: 1000,
    });
  } catch (error) {
    logger.error(`${graphId} Batch dispatch failed: ${error.message}`);
    return {error: "Failed to process scene prompts"};
  }

  // Step 4: Add prompts to scenes
  const augmentedChapterScenes = chapterScenes.map((scene, index) => {
    const responseKey = `${sku}_scene_${chapter}_${index}`;
    const result = results[responseKey];

    if (result) {
      // Extract the string content from the result
      const promptText = typeof result === "string" ? result :
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

  // Calculate total tokens used
  const totalTokens = Object.values(results).reduce((sum, r) => sum + (r.tokensUsed || 0), 0);
  logger.info(`${graphId} Successfully augmented ${augmentedChapterScenes.length} scenes for chapter ${chapter}, used ${totalTokens} tokens`);

  return {
    chapter: chapter,
    scenes: augmentedChapterScenes,
    tokensUsed: totalTokens,
  };
}

export {augmentScenePrompts};
