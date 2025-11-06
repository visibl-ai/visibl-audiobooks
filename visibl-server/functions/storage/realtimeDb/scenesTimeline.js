/* eslint-disable require-jsdoc */
import {storeData, getData} from "./database.js";
import logger from "../../util/logger.js";

/**
 * Creates a time-based index for efficient scene lookups
 * @param {string} sceneId - The scene ID
 */
async function createSceneTimeIndex({sceneId}) {
  try {
    // Validate input
    if (!sceneId) {
      logger.warn("createSceneTimeIndex: sceneId is required");
      return;
    }

    // Get scenes from RTDB cache
    const fullScenes = await getData({
      ref: `scenes/${sceneId}`,
    });

    if (!fullScenes || typeof fullScenes !== "object") {
      logger.warn(`createSceneTimeIndex: No scenes found in RTDB for sceneId ${sceneId}`);
      return;
    }

    const timeIndex = {};
    const chapterRanges = {};
    let hasValidScenes = false;

    // Build time index and chapter ranges
    for (const [chapter, scenes] of Object.entries(fullScenes)) {
      const chapterNum = parseInt(chapter, 10);

      // Skip invalid chapters
      if (isNaN(chapterNum) || !Array.isArray(scenes) || scenes.length === 0) {
        continue;
      }

      const firstScene = scenes[0];

      // Validate first scene has required fields
      if (!firstScene || typeof firstScene.startTime !== "number" || typeof firstScene.endTime !== "number") {
        logger.warn(`createSceneTimeIndex: Invalid scene data in chapter ${chapter} for sceneId ${sceneId}`);
        continue;
      }

      let chapterStartTime = firstScene.startTime;
      let chapterEndTime = firstScene.endTime;

      for (const scene of scenes) {
        // Validate each scene
        if (!scene || typeof scene.startTime !== "number" || typeof scene.endTime !== "number" ||
            scene.scene_number === undefined) {
          continue;
        }

        // Store time -> scene mapping using startTime converted to string without dots
        // Convert time to milliseconds and use as key to avoid RTDB key restrictions
        const timeKey = Math.floor(scene.startTime * 1000).toString();
        timeIndex[timeKey] = {
          chapter: chapterNum,
          scene_number: scene.scene_number,
          startTime: scene.startTime,
          endTime: scene.endTime,
        };

        // Track chapter time range
        chapterStartTime = Math.min(chapterStartTime, scene.startTime);
        chapterEndTime = Math.max(chapterEndTime, scene.endTime);
        hasValidScenes = true;
      }

      // Store chapter range info if we had valid scenes
      if (hasValidScenes) {
        chapterRanges[chapterNum] = {
          startTime: chapterStartTime,
          endTime: chapterEndTime,
          sceneCount: scenes.length,
        };
      }
    }

    // Only store if we have valid data
    if (Object.keys(timeIndex).length > 0) {
      // Store the time index at a separate path to avoid interfering with array coercion
      await storeData({
        ref: `scenesMetadata/${sceneId}/timeIndex`,
        data: timeIndex,
      });

      // Store chapter ranges at a separate path
      await storeData({
        ref: `scenesMetadata/${sceneId}/chapterRanges`,
        data: chapterRanges,
      });

      logger.debug(`Created time index for scene ${sceneId} with ${Object.keys(timeIndex).length} entries`);
    } else {
      logger.warn(`createSceneTimeIndex: No valid scenes found to index for sceneId ${sceneId}`);
    }
  } catch (error) {
    logger.error(`createSceneTimeIndex: Error creating time index for scene ${sceneId}: ${error.message}`);
    // Don't throw - let the main operation continue
  }
}

/**
 * Gets scene at specific time using time index
 * @param {string} sceneId - The scene ID
 * @param {number} currentTime - Current playback time in seconds
 * @return {Object} Scene info with chapter and scene_number
 */
async function getSceneAtTime({sceneId, currentTime}) {
  // Get all time indices to find the scene containing currentTime
  const timeIndex = await getData({
    ref: `scenesMetadata/${sceneId}/timeIndex`,
  });

  if (!timeIndex) {
    logger.error(`No time index found for scene ${sceneId}`);
    return null;
  }

  let nearestScene = null;
  let minTimeDifference = Number.MAX_VALUE;

  // timeIndex keys are now milliseconds as strings, but sceneInfo still has seconds
  for (const sceneInfo of Object.values(timeIndex)) {
    if (currentTime >= sceneInfo.startTime && currentTime < sceneInfo.endTime) {
      return {
        chapter: sceneInfo.chapter,
        sceneNumber: sceneInfo.scene_number,
      };
    }

    const timeDifference = Math.abs(currentTime - sceneInfo.startTime);
    if (timeDifference < minTimeDifference) {
      minTimeDifference = timeDifference;
      nearestScene = {
        chapter: sceneInfo.chapter,
        sceneNumber: sceneInfo.scene_number,
      };
    }
  }

  return nearestScene;
}

/**
 * Gets specific scenes from RTDB
 * @param {string} sceneId - The scene ID
 * @param {Array} scenesToFetch - Array of {chapter, scene_number} objects
 * @return {Array} Array of scene objects
 */
async function getScenesFromRTDB({sceneId, scenesToFetch}) {
  const scenes = [];

  // First try to get individual scenes from their specific paths
  for (const sceneToFetch of scenesToFetch) {
    let sceneData = await getData({
      ref: `scenes/${sceneId}/${sceneToFetch.chapter}/${sceneToFetch.scene_number}`,
    });

    // If not found at individual path, try to get from main structure
    if (!sceneData) {
      const allScenes = await getData({
        ref: `scenes/${sceneId}/${sceneToFetch.chapter}`,
      });

      if (allScenes && Array.isArray(allScenes)) {
        sceneData = allScenes.find((s) => s.scene_number === sceneToFetch.scene_number);
      }
    }

    if (sceneData) {
      // Ensure we have the chapter field set correctly
      const sceneWithChapter = {
        ...sceneData,
        chapter: sceneToFetch.chapter,
      };

      // Ensure sceneId is set - if not present, use the current sceneId
      // This is important for styled scenes that need to filter by sceneId
      if (!sceneWithChapter.sceneId) {
        sceneWithChapter.sceneId = sceneId;
      }

      scenes.push(sceneWithChapter);
    }
  }

  return scenes;
}

/**
 * Gets scenes needed for image generation based on current time
 * @param {string} sceneId - The scene ID
 * @param {number} currentTime - Current playback time
 * @param {number} precedingScenes - Number of scenes before current
 * @param {number} followingScenes - Number of scenes after current
 * @return {Array} Array of scene objects
 */
async function getScenesForImageGeneration({sceneId, currentTime, precedingScenes, followingScenes}) {
  // Get current scene
  const currentScene = await getSceneAtTime({sceneId, currentTime});
  if (!currentScene) {
    logger.warn(`No scene found for time ${currentTime} in scene ${sceneId}`);
    return [];
  }

  // Get chapter ranges to know boundaries
  const chapterRanges = await getData({
    ref: `scenesMetadata/${sceneId}/chapterRanges`,
  });

  if (!chapterRanges) {
    logger.error(`No chapter ranges found for scene ${sceneId}`);
    return [];
  }

  const scenesToFetch = [];
  const chapters = Object.keys(chapterRanges).map(Number).sort((a, b) => a - b);
  const currentChapterIndex = chapters.indexOf(currentScene.chapter);

  // Add preceding scenes
  let remainingPreceding = precedingScenes;
  let checkChapter = currentScene.chapter;
  let checkScene = currentScene.sceneNumber - 1;

  while (remainingPreceding > 0) {
    if (checkScene >= 0) {
      scenesToFetch.unshift({chapter: checkChapter, scene_number: checkScene});
      checkScene--;
      remainingPreceding--;
    } else if (currentChapterIndex > 0) {
      // Move to previous chapter
      const prevChapterIndex = chapters.indexOf(checkChapter) - 1;
      if (prevChapterIndex >= 0) {
        checkChapter = chapters[prevChapterIndex];
        checkScene = chapterRanges[checkChapter].sceneCount - 1;
      } else {
        break;
      }
    } else {
      break;
    }
  }

  // Add current scene
  scenesToFetch.push({chapter: currentScene.chapter, scene_number: currentScene.sceneNumber});

  // Add following scenes
  let remainingFollowing = followingScenes;
  checkChapter = currentScene.chapter;
  checkScene = currentScene.sceneNumber + 1;

  while (remainingFollowing > 0) {
    if (checkScene < chapterRanges[checkChapter].sceneCount) {
      scenesToFetch.push({chapter: checkChapter, scene_number: checkScene});
      checkScene++;
      remainingFollowing--;
    } else {
      // Move to next chapter
      const nextChapterIndex = chapters.indexOf(checkChapter) + 1;
      if (nextChapterIndex < chapters.length) {
        checkChapter = chapters[nextChapterIndex];
        checkScene = 0;
      } else {
        break;
      }
    }
  }

  // Fetch the actual scene data
  return await getScenesFromRTDB({sceneId, scenesToFetch});
}

/**
 * Checks if a scene has a complete time index for all available chapters
 * @param {string} sceneId - The scene ID
 * @return {boolean} True if time index exists and is complete, false otherwise
 */
async function hasTimeIndex(sceneId) {
  try {
    // Check if time index exists
    const timeIndex = await getData({
      ref: `scenesMetadata/${sceneId}/timeIndex`,
    });

    if (!timeIndex) {
      return false;
    }

    // Check if chapter ranges exist
    const chapterRanges = await getData({
      ref: `scenesMetadata/${sceneId}/chapterRanges`,
    });

    if (!chapterRanges) {
      return false;
    }

    // Get the actual scenes from cache to compare
    const cachedScenes = await getData({
      ref: `scenes/${sceneId}`,
    });

    if (!cachedScenes) {
      // If no cached scenes, index shouldn't exist either
      return false;
    }

    // Check if all chapters in cached scenes are in the index
    const cachedChapters = Object.keys(cachedScenes)
        .filter((key) => !isNaN(parseInt(key, 10)))
        .map((key) => parseInt(key, 10));

    const indexedChapters = Object.keys(chapterRanges)
        .map((key) => parseInt(key, 10));

    // Check if all cached chapters are indexed
    for (const chapter of cachedChapters) {
      if (!indexedChapters.includes(chapter)) {
        logger.info(`hasTimeIndex: Chapter ${chapter} missing from time index for scene ${sceneId}`);
        return false;
      }
    }

    return true;
  } catch (error) {
    logger.error(`hasTimeIndex: Error checking time index for scene ${sceneId}: ${error.message}`);
    return false;
  }
}

export {
  createSceneTimeIndex,
  getSceneAtTime,
  getScenesFromRTDB,
  getScenesForImageGeneration,
  hasTimeIndex,
};
