/* eslint-disable require-jsdoc */
import {storeData, getData, deleteData, updateData} from "./database.js";
import {getScene} from "../storage.js";
import {sanitizeSceneForCache} from "../../util/sceneHelpers.js";
import {createSceneTimeIndex} from "./scenesTimeline.js";
import {catalogueGetRtdb} from "./catalogue.js";
import logger from "../../util/logger.js";
function sceneToDbRef({sceneId}) {
  return `scenes/${sceneId}`;
}

async function storeScenesInCache(params) {
  const {scenes, sku} = params.body;
  if (!sku) {
    throw new Error("storeScenesInCache: catalogueId is required");
  }
  for (const scene of scenes) {
    try {
      const thisScene = await getScene({sceneId: scene.id});
      if (!thisScene) {
        logger.error(`Scene ${scene.id} not found in getScene`);
        throw new Error(`Scene ${scene.id} not found in getScene`);
      }
      const sanitizedScene = sanitizeSceneForCache(thisScene, scene.id);
      const dbRef = sceneToDbRef({sceneId: scene.id});
      await storeData({ref: dbRef, data: sanitizedScene});

      // Also store individual scenes at the path expected by styleScenesWithQueue
      for (const [chapter, scenes] of Object.entries(sanitizedScene)) {
        if (Array.isArray(scenes)) {
          for (const individualScene of scenes) {
            const individualSceneRef = `scenes/${scene.id}/${chapter}/${individualScene.scene_number}`;
            await storeData({ref: individualSceneRef, data: individualScene});
          }
        }
      }

      // Create time index for this scene
      await createSceneTimeIndex({sceneId: scene.id});
    } catch (error) {
      console.error(`Error storing scene ${scene.id} in cache:`, error);
    }
  }
  return;
}

async function storeSceneInCacheFromMemory({sceneId, sceneData}) {
  try {
    if (!sceneId) {
      logger.error("storeSceneInCacheFromMemory: sceneId is required");
      return;
    }

    if (!sceneData || typeof sceneData !== "object") {
      logger.warn(`storeSceneInCacheFromMemory: Invalid or empty scene data for sceneId ${sceneId}`);
      return;
    }

    const dbRef = sceneToDbRef({sceneId});
    const sanitizedData = sanitizeSceneForCache(sceneData, sceneId);
    await storeData({ref: dbRef, data: sanitizedData});

    // Create time index for efficient lookups (will handle invalid data gracefully)
    await createSceneTimeIndex({sceneId});
  } catch (error) {
    logger.error(`storeSceneInCacheFromMemory: Error storing scene ${sceneId}: ${error.message}`);
    // Re-throw to let caller handle the error
    throw error;
  }
}

async function getScenesFromCache({sceneId}) {
  const dbRef = sceneToDbRef({sceneId});
  return await getData({ref: dbRef});
}

async function deleteSceneFromCache({styleId, sceneId, sku}) {
  if (!sku && !sceneId) {
    throw new Error("deleteSceneFromCache: sku or sceneId is required");
  }

  // Get default sceneId from sku if sceneId is not provided
  if (!sceneId) {
    const catalogueItem = await catalogueGetRtdb({sku});
    if (!catalogueItem?.defaultSceneId) {
      logger.warn("deleteSceneFromCache: default sceneId not found");
      return null;
    }
    sceneId = catalogueItem.defaultSceneId;
  }

  if (styleId) {
    // Delete styleId from scene.styles in RTDB
    // We need to iterate through all chapters and scenes to remove the style
    const sceneData = await getScenesFromCache({sceneId});
    if (sceneData) {
      for (const [chapter, scenes] of Object.entries(sceneData)) {
        if (Array.isArray(scenes)) {
          for (let i = 0; i < scenes.length; i++) {
            // Delete the style from this scene
            const stylePath = `scenes/${sceneId}/${chapter}/${i}/styles/${styleId}`;
            await deleteData({ref: stylePath});
          }
        }
      }
    }
    logger.info(`Deleted styleId ${styleId} from all scenes in ${sceneId}`);
    return sceneId;
  }

  // Disallow deletion of the default scene
  throw new Error("deleteSceneFromCache: default scene cannot be deleted");
}

async function storeChapterSceneInCache({sceneId, chapter, chapterScenes}) {
  try {
    if (!sceneId) {
      logger.error("storeChapterSceneInCache: sceneId is required");
      return;
    }

    if (!chapterScenes || !Array.isArray(chapterScenes)) {
      logger.warn(`storeChapterSceneInCache: Invalid or empty scene data for chapter ${chapter}`);
      return;
    }

    // Store at chapter-specific path to avoid concurrency issues
    const chapterRef = `scenes/${sceneId}/${chapter}`;
    const sanitizedChapterScenes = chapterScenes.map((scene) => {
      // Add chapter number to each scene
      const sceneWithChapter = {...scene, chapter: parseInt(chapter)};

      // Convert characters and locations objects to arrays if needed
      if (sceneWithChapter.characters && typeof sceneWithChapter.characters === "object" && !Array.isArray(sceneWithChapter.characters)) {
        sceneWithChapter.characters = Object.keys(sceneWithChapter.characters);
      }
      if (sceneWithChapter.locations && typeof sceneWithChapter.locations === "object" && !Array.isArray(sceneWithChapter.locations)) {
        sceneWithChapter.locations = Object.keys(sceneWithChapter.locations);
      }

      return sceneWithChapter;
    });

    await storeData({ref: chapterRef, data: sanitizedChapterScenes});

    // Don't store individual scenes separately to avoid duplication
    // The array at the chapter level is sufficient

    logger.info(`Stored ${chapterScenes.length} scenes for chapter ${chapter} in cache`);
  } catch (error) {
    logger.error(`storeChapterSceneInCache: Error storing chapter ${chapter} scenes: ${error.message}`);
    throw error;
  }
}

async function updateSceneImageUrl({defaultSceneId, styleId, styleTitle, chapter, sceneNumber, imageUrl, imageGcpUrl}) {
  try {
    if (!defaultSceneId || !styleId || !styleTitle || chapter === undefined || sceneNumber === undefined || !imageUrl) {
      logger.error(`updateSceneImageUrl: Missing required parameters - defaultSceneId: ${defaultSceneId}, styleId: ${styleId}, styleTitle: ${styleTitle}, chapter: ${chapter}, sceneNumber: ${sceneNumber}, imageUrl: ${imageUrl}`);
      return;
    }

    // First, get the chapter scenes array to find the index
    const chapterRef = `scenes/${defaultSceneId}/${chapter}`;

    // This is an origin image for the scene.
    if (styleId === defaultSceneId) {
      await updateData({
        ref: chapterRef,
        data: {
          [`${sceneNumber}/image`]: imageUrl,
          [`${sceneNumber}/imageGcp`]: imageGcpUrl,
          [`${sceneNumber}/sceneId`]: defaultSceneId,
        },
      });
    }
    // Update style object for the scene
    await updateData({
      ref: chapterRef,
      data: {
        [`${sceneNumber}/styles/${styleId}`]: {
          styleId,
          image: imageUrl,
          imageGcp: imageGcpUrl,
          title: styleTitle,
        },
      },
    });

    logger.info(`updateSceneImageUrl: Updated scene image URLs for scene ${sceneNumber} in chapter ${chapter} of ${defaultSceneId} with styleId ${styleId} and title ${styleTitle}`);
  } catch (error) {
    logger.error(`updateSceneImageUrl: Error updating scene image: ${error.message}`);
    // Don't throw - we don't want to break the queue processing
  }
}

export {
  storeScenesInCache,
  getScenesFromCache,
  storeSceneInCacheFromMemory,
  deleteSceneFromCache,
  storeChapterSceneInCache,
  updateSceneImageUrl,
};
