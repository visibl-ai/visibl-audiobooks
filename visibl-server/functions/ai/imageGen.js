/* eslint-disable require-jsdoc */
import logger from "../util/logger.js";

import {
  ENVIRONMENT,
  IMAGE_GEN_PRECEDING_SCENES,
  IMAGE_GEN_FOLLOWING_SCENES,
} from "../config/config.js";
import {
  getScene,
} from "../storage/storage.js";

import {
  getScenesFromCache,
  storeSceneInCacheFromMemory,
} from "../storage/realtimeDb/scenesCache.js";

import {
  catalogueGetRtdb,
  getStylesFromCatalogueRtdb,
  // catalogueUpdateGraphProgress,
} from "../storage/realtimeDb/catalogue.js";

import {
  dispatchTask,
} from "../util/dispatch.js";

import {
  getSceneAtTime,
  getScenesForImageGeneration,
  createSceneTimeIndex,
  hasTimeIndex,
} from "../storage/realtimeDb/scenesTimeline.js";
import {isNetworkError} from "../util/errorHelper.js";

import {
  queueAddEntries,
  dalleQueueToUnique,
  stabilityQueueToUnique,
  modalQueueToUnique,
} from "../storage/firestore/queue.js";

import {styleScenesWithQueue} from "./images/style/index.js";
import {getGraphFirestore} from "../storage/firestore/graph.js";
import GraphPipelineFactory from "../graph/GraphPipelineFactory.js";

// const TIMEOUT = 60000;

// Check if cached scenes have all required fields for image generation
function isSceneCacheValidForImageGen(scenes, chapter) {
  if (!scenes || !Array.isArray(scenes)) return false;
  if (!scenes[chapter] || !Array.isArray(scenes[chapter])) return false;

  // Check if at least one scene in the chapter has required fields
  const hasRequiredFields = scenes[chapter].some((scene) => {
    // Essential fields for image generation
    return scene.scene_number !== undefined &&
           scene.prompt !== undefined &&
           scene.startTime !== undefined &&
           scene.endTime !== undefined;
  });

  return hasRequiredFields;
}

// Check if cache is valid for multiple chapters (used in saveImageResults)
function isSceneCacheValidForChapters(scenes, chapters) {
  if (!scenes || !Array.isArray(scenes)) return false;

  // Check all unique chapters
  const uniqueChapters = [...new Set(chapters)];
  return uniqueChapters.every((chapter) => isSceneCacheValidForImageGen(scenes, chapter));
}

// Return actual scene objects from the fullScenes array.
// based on the scenesToGenerate array.
function formatScenesForGeneration(fullScenes, scenesToGenerate) {
  const scenes = [];
  for (const sceneToGenerate of scenesToGenerate) {
    const sceneToAdd = fullScenes[sceneToGenerate.chapter].find(
        (scene) => scene.scene_number === sceneToGenerate.scene_number,
    );
    if (sceneToAdd) {
      sceneToAdd.chapter = sceneToGenerate.chapter;
      scenes.push(sceneToAdd);
    } else {
      logger.warn(`Scene ${sceneToGenerate.scene_number} not found in chapter ${sceneToGenerate.chapter}`);
    }
  }
  return scenes;
}

async function saveImageResultsMultipleScenes(params) {
  const {results} = params;
  const groupedResults = groupResultsBySceneId(results);
  for (const [sceneId, sceneResults] of Object.entries(groupedResults)) {
    logger.debug(`Saving image results for sceneId ${sceneId}`);
    await saveImageResults({
      images: sceneResults,
      sceneId: sceneId,
    });
  }
}

// saves image results. Expects an output from dalle3 or batchStabilityRequest.
async function saveImageResults(params) {
  const {
    images,
    sceneId,
  } = params;
  logger.debug(`Reloading scenes before editing.`);
  logger.debug(`saveImageResults called with ${images.length} images`);
  let fullScenes = await getScenesFromCache({sceneId});

  // Get all chapters that need to be updated
  const chaptersToUpdate = images.map((img) => img.chapter);

  // Validate cache and fallback to Storage if needed
  if (!isSceneCacheValidForChapters(fullScenes, chaptersToUpdate)) {
    logger.warn(`Cache invalid or missing required fields for scene ${sceneId}, falling back to Storage`);
    fullScenes = await getScene({sceneId});
  }
  for (const image of images) {
    // logger.debug(`image = ${JSON.stringify(image)}`);
    if (image.result) {
      const sceneIndex = fullScenes[image.chapter].findIndex((s) => s.scene_number === image.scene_number);
      logger.debug(`chapter ${image.chapter}, sceneIndex ${sceneIndex}, sceneNumber ${image.scene_number}`);
      if (sceneIndex !== -1) {
        if (image.tall) fullScenes[image.chapter][sceneIndex].image = image.tall;
        if (image.square) fullScenes[image.chapter][sceneIndex].square = image.square;
        if (image.squareBucketPath) fullScenes[image.chapter][sceneIndex].squareBucketPath = image.squareBucketPath;
        if (image.tall) fullScenes[image.chapter][sceneIndex].tall = image.tall;
        if (image.tallBucketPath) fullScenes[image.chapter][sceneIndex].tallBucketPath = image.tallBucketPath;
        if (image.wide) fullScenes[image.chapter][sceneIndex].wide = image.wide;
        if (image.wideBucketPath) fullScenes[image.chapter][sceneIndex].wideBucketPath = image.wideBucketPath;
        if (image.description) {
          fullScenes[image.chapter][sceneIndex].prompt = image.description;
          logger.debug(`Set prompt for chapter ${image.chapter}, scene ${image.scene_number}: ${image.description.substring(0, 50)}...`);
        } else {
          logger.warn(`No description provided for chapter ${image.chapter}, scene ${image.scene_number}`);
        }
        fullScenes[image.chapter][sceneIndex].sceneId = sceneId;
      }
    }
  }
  // Only update the RTDB cache, no longer writing to scenes.json to avoid race conditions
  await storeSceneInCacheFromMemory({sceneId, sceneData: fullScenes});

  // Note: graphAvailable is now set in GraphPipelineV0_1 after UPDATE_SCENE_CACHE step
  // Update graph progress if applicable


  // COMMENTED OUT AS I DON'T THINK THIS IS USED AND I DELETED getSceneFirestore - Moe

  // const hasFirstScene = images.some((img) => img.chapter === 0 && img.scene_number === 0 && img.result && (img.tall || img.square));
  // if (hasFirstScene) {
  //   try {
  //     const scene = await getSceneFirestore(sceneId);
  //     if (scene && scene.sku) {
  //       const catalogue = await catalogueGetRtdb({sku: scene.sku});
  //       // Update graph progress if graphAvailable is already set
  //       if (catalogue && catalogue.graphAvailable && catalogue.defaultGraphId) {
  //         await catalogueUpdateGraphProgress({sku: scene.sku, graphId: catalogue.defaultGraphId});
  //       }
  //     }
  //   } catch (error) {
  //     logger.error(`Error updating graph progress: ${error.message}`);
  //     // Don't throw - this is not critical to the image saving process
  //   }
  // }

  logger.debug(`Stored updated scenes.`);
  return fullScenes;
}

// Returns an array of scenes to generate, assuming chapter traversal.
// The number of scenes to generate is limited by OPENAI_DALLE_3_IMAGES_PER_MINUTE.
// function getScenesToGenerate(lastSceneGenerated, totalScenes, chapter) {
//   const scenesToGenerate = [];
//   const i = lastSceneGenerated;
//   for (let j = i; j < i + OPENAI_DALLE_3_IMAGES_PER_MINUTE && j < totalScenes; j++) {
//     scenesToGenerate.push({scene_number: j, chapter: chapter});
//   }
//   return scenesToGenerate;
// }

function groupResultsBySceneId(results) {
  return results.reduce((acc, result) => {
    if (!acc[result.sceneId]) {
      acc[result.sceneId] = [];
    }
    acc[result.sceneId].push(result);
    return acc;
  }, {});
}

async function outpaintWithQueue(params) {
  const {results} = params;
  // First we group results by sceneId.
  const groupedResults = groupResultsBySceneId(results);
  // For each sceneId group, we batch add the outpaint requests to the queue.
  for (const [sceneId, sceneResults] of Object.entries(groupedResults)) {
    // Now we need to outpaint the generated images.
    const types = [];
    const entryTypes = [];
    const entryParams = [];
    const uniques = [];
    sceneResults.forEach((image) => {
      if (image.square) {
        const timestamp = Date.now();
        const imagePath = `Scenes/${sceneId}/${image.chapter}_scene${image.scene_number}_${timestamp}`;
        types.push("modal");
        entryTypes.push("outpaintTall");
        entryParams.push({
          inputPath: image.squareBucketPath,
          outputPathWithoutExtension: imagePath,
          sceneId: sceneId,
          chapter: image.chapter,
          scene_number: image.scene_number,
          retry: true,
        });
        uniques.push(modalQueueToUnique({
          type: "modal",
          entryType: "outpaintTall",
          sceneId: sceneId,
          chapter: image.chapter,
          scene_number: image.scene_number,
          retry: true,
        }));
      }
    });
    await queueAddEntries({
      types,
      entryTypes,
      entryParams,
      uniques,
    });
  }
  // Now we dispatch the queue.
  await dispatchTask({
    functionName: "launchModalQueue",
    data: {},
  });
}

async function composeScenesWithQueue(params) {
  const {scenes, sceneId} = params;
  // Simply add to the queue, and dispatch the queue.
  const types = [];
  const entryTypes = [];
  const entryParams = [];
  const uniques = [];
  scenes.forEach((scene) => {
    logger.debug(`Adding scene to DALL-E queue: chapter ${scene.chapter}, scene ${scene.scene_number}`);
    types.push("dalle");
    entryTypes.push("dalle3");
    entryParams.push({
      scene,
      sceneId,
      retry: true,
    });
    uniques.push(dalleQueueToUnique({
      type: "dalle",
      entryType: "dalle3",
      sceneId,
      chapter: scene.chapter,
      scene_number: scene.scene_number,
      retry: true,
    }));
  });
  await queueAddEntries({
    types,
    entryTypes,
    entryParams,
    uniques,
  });
  await dispatchTask({
    functionName: "launchDalleQueue",
    data: {},
  });
  return;
}

async function imageGenCurrentTime(req) {
  logger.info(`imageGenCurrentTime body: ${JSON.stringify(req.body)}`);
  const {styleId, currentTime, sku, uid} = req.body;
  if (!styleId || currentTime === undefined || !sku) {
    throw new Error("styleId, currentTime, and sku are required");
  }

  // Get defaultSceneId from catalogue
  const catalogue = await catalogueGetRtdb({sku});
  if (!catalogue) {
    logger.error(`No catalogue found for sku ${sku}`);
    throw new Error(`No catalogue found for sku ${sku}`);
  }

  const defaultSceneId = catalogue.defaultSceneId;
  if (!defaultSceneId) {
    logger.error(`No defaultSceneId found in catalogue for sku ${sku}`);
    throw new Error(`No defaultSceneId found in catalogue for sku ${sku}`);
  }

  try {
    // Check if scene has time index, create it if missing
    const hasIndex = await hasTimeIndex(defaultSceneId);
    if (!hasIndex) {
      logger.info(`Scene ${defaultSceneId} missing time index, creating it now`);
      await createSceneTimeIndex({sceneId: defaultSceneId});
    }

    // Get current scene using RTDB time index
    const currentScene = await getSceneAtTime({sceneId: defaultSceneId, currentTime});
    if (!currentScene) {
      logger.warn(`No matching scene found for the given currentTime ${currentTime}`);
      return;
    }

    logger.debug(`Found scene: Chapter ${currentScene.chapter}, Scene ${currentScene.sceneNumber}`);

    let precedingScenes = parseInt(IMAGE_GEN_PRECEDING_SCENES.value(), 10);
    let followingScenes = parseInt(IMAGE_GEN_FOLLOWING_SCENES.value(), 10);
    if (ENVIRONMENT.value() === "development") {
      precedingScenes = 1;
      followingScenes = 1;
    }

    // Get scenes for image generation from RTDB
    // scenes are a list of scenes images should exist for. This will be filtered down.
    const scenes = await getScenesForImageGeneration({
      sceneId: defaultSceneId,
      currentTime,
      precedingScenes,
      followingScenes,
    });

    if (!scenes || scenes.length === 0) {
      logger.warn(`No scenes found for defaultSceneId ${defaultSceneId} at currentTime ${currentTime}`);
      return;
    }

    // Get scene metadata from RTDB
    let theme = null;
    let styleTitle = null;
    // Get style from catalogue RTDB
    const catalogueStyles = await getStylesFromCatalogueRtdb({sku, type: "object"});
    if (catalogueStyles && catalogueStyles[styleId]) {
      theme = catalogueStyles[styleId].prompt;
      styleTitle = catalogueStyles[styleId].title;
      if (theme) {
        logger.debug(`imageGenCurrentTime: Found style for sceneId ${styleId}: ${styleTitle}`);
      }
    }

    // Filter scenes that need generation: remove any scene where scene.styles[styleId].image exists
    const filteredScenes = scenes.filter((scene) => {
    // Be defensive: styles or styles[styleId] may be undefined/null
      const hasImageForStyle = Boolean(scene?.styles?.[styleId]?.image);
      return !hasImageForStyle;
    });

    logger.debug(`Filtered out ${scenes.length - filteredScenes.length} scenes already styled for styleId ${styleId}`);

    // Get the graph version to determine which pipeline to use
    const graphId = catalogue?.defaultGraphId;

    if (!graphId) {
      logger.error(`No defaultGraphId found for SKU ${sku}`);
      throw new Error(`No defaultGraphId found for SKU ${sku}`);
    }

    if (styleId === defaultSceneId) {
      // This is an origin image for the scene. We must compose.

      // Get graph information including version
      const graphItem = await getGraphFirestore({graphId});
      const graphVersion = graphItem?.version || "v0.1";
      logger.debug(`Using graph version ${graphVersion} for graphId ${graphId}`);
      // Format scenes for composeSceneImages - it expects {chapter, scene} format
      const formattedScenes = filteredScenes.map((scene) => ({
        chapter: scene.chapter,
        scene: scene.scene_number,
      }));

      // Call composeSceneImages through the GraphPipelineFactory
      await GraphPipelineFactory.composeSceneImages(
          graphVersion,
          {
            graphId,
            defaultSceneId,
            scenes: formattedScenes,
            sku,
            uid,
          },
      );
    } else {
      if (!theme || theme.trim() === "") {
        logger.warn(`imageGenCurrentTime: No valid theme found for styleId ${styleId}`);
        return;
      }
      // this is a styled image, we must style.
      logger.info(`imageGenCurrentTime: Scene ID ${defaultSceneId} has a style: "${styleTitle}", styling ${filteredScenes.length} scenes`);
      logger.info(`imageGenCurrentTime: Calling styleScenesWithQueue with defaultSceneId: ${defaultSceneId}`);
      return await styleScenesWithQueue({
        scenes: filteredScenes,
        styleId,
        styleTitle,
        theme,
        defaultSceneId,
        sku,
        uid,
      });
    }
  } catch (error) {
    logger.error(`Error in imageGenCurrentTime for ${styleId}: ${error.message}`);
    // Log more details for network errors to help with debugging
    if (isNetworkError(error)) {
      logger.warn(`Network connectivity issue detected for scene ${styleId}. This should retry automatically.`);
    }
    throw error;
  }
}

async function retryFailedStabilityRequests({results}) {
  const failedRequests = results.filter((request) => request.result === false);
  if (failedRequests.length > 0) {
    logger.debug(`STABILITY: Number of failed requests: ${failedRequests.length}`);
    const types = [];
    const entryTypes = [];
    const entryParams = [];
    const uniques = [];
    failedRequests.forEach((request) => {
      logger.debug(`STABILITY: retryFailedStabilityRequests: request = ${JSON.stringify(request)}`);
      if (request.retry) {
        types.push("stability");
        entryTypes.push(request.entryType);
        entryParams.push({
          inputPath: request.inputPath,
          outputPathWithoutExtension: request.outputPathWithoutExtension,
          prompt: request.prompt,
          chapter: request.chapter,
          scene_number: request.scene_number,
          sceneId: request.sceneId,
          retry: false, // retry once.
        });
        uniques.push(stabilityQueueToUnique({
          type: "stability",
          entryType: request.entryType,
          sceneId: request.sceneId,
          chapter: request.chapter,
          scene_number: request.scene_number,
          retry: false,
        }));
      }
    });
    await queueAddEntries({
      types,
      entryTypes,
      entryParams,
      uniques,
    });
  }
}

export {
  imageGenCurrentTime,
  saveImageResults,
  saveImageResultsMultipleScenes,
  outpaintWithQueue,
  retryFailedStabilityRequests,
  composeScenesWithQueue,
  formatScenesForGeneration,
};
