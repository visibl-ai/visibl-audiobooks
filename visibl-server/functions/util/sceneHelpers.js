import logger from "./logger.js";
import {IMAGE_GEN_PRECEDING_SCENES, IMAGE_GEN_FOLLOWING_SCENES} from "../config/config.js";

const PRECEDING_SCENES = parseInt(IMAGE_GEN_PRECEDING_SCENES, 10);
const FOLLOWING_SCENES = parseInt(IMAGE_GEN_FOLLOWING_SCENES, 10);
/**
 * Finds the scene that is currently playing based on the current time.
 * @param {Object} fullScenes - The full scenes object.
 * @param {number} currentTime - The current time in seconds.
 * @return {Object|null} - The scene object if found, null otherwise.
 */
function sceneFromCurrentTime(fullScenes, currentTime) {
  let nearestScene = null;
  let minTimeDifference = Infinity;
  for (const [chapter, scenes] of Object.entries(fullScenes)) {
    for (const scene of scenes) {
      if (currentTime >= scene.startTime && currentTime < scene.endTime) {
        return {chapter: parseInt(chapter), sceneNumber: scene.scene_number};
      }
      // Calculate the time difference to the start of the scene
      const timeDifference = Math.abs(currentTime - scene.startTime);
      if (timeDifference < minTimeDifference) {
        minTimeDifference = timeDifference;
        nearestScene = {chapter: parseInt(chapter), sceneNumber: scene.scene_number};
      }
    }
  }

  return nearestScene; // Return the nearest scene if no exact match is found
}

/**
 * Generates a list of scenes to generate from the current scene.
 * @param {Object} fullScenes - The full scenes object.
 * @param {number} currentSceneNumber - The current scene number.
 * @param {number} currentChapter - The current chapter.
 * @return {Array} - The list of scenes to generate.
 */
function scenesToGenerateFromCurrentTime({
  currentSceneNumber,
  currentChapter,
  fullScenes,
  precedingScenes = PRECEDING_SCENES,
  followingScenes = FOLLOWING_SCENES,
}) {
  const result = [];
  const chapters = Object.keys(fullScenes).map(Number).sort((a, b) => a - b);
  const currentChapterIndex = chapters.indexOf(currentChapter);

  /**
   * Adds a scene to the result if it exists.
   * @param {number} chapter - The chapter number.
   * @param {number} sceneNumber - The scene number.
   */
  function addScene(chapter, sceneNumber) {
    if (fullScenes[chapter] && fullScenes[chapter][sceneNumber] !== undefined) {
      result.push({chapter, scene_number: sceneNumber});
    }
  }

  // Add 2 scenes before
  for (let i = precedingScenes; i > 0; i--) {
    if (currentSceneNumber - i >= 0) {
      addScene(currentChapter, currentSceneNumber - i);
    } else if (currentChapterIndex > 0) {
      const prevChapter = chapters[currentChapterIndex - 1];
      const prevChapterLastScene = fullScenes[prevChapter].length - 1;
      addScene(prevChapter, prevChapterLastScene - (i - currentSceneNumber - 1));
    }
  }

  // Add current scene
  addScene(currentChapter, currentSceneNumber);

  // Add 10 scenes after
  let remainingScenes = followingScenes;
  let nextChapter = currentChapter;
  let nextScene = currentSceneNumber + 1;

  while (remainingScenes > 0 && nextChapter !== undefined) {
    if (fullScenes[nextChapter] && fullScenes[nextChapter][nextScene] !== undefined) {
      addScene(nextChapter, nextScene);
      nextScene++;
      remainingScenes--;
    } else {
      const nextChapterIndex = chapters.indexOf(nextChapter) + 1;
      nextChapter = chapters[nextChapterIndex];
      nextScene = 0;
    }
  }

  return result;
}

/**
 * Generates a list of scenes to generate from the current scene.
 * @param {Object} fullScenes - The full scenes object.
 * @param {number} currentSceneNumber - The current scene number.
 * @param {number} currentChapter - The current chapter.
 * @return {Array} - The list of scenes to generate.
 */
function scenesFromCurrentTime({
  currentSceneNumber,
  currentChapter,
  fullScenes,
  precedingScenes = PRECEDING_SCENES,
  followingScenes = FOLLOWING_SCENES,
}) {
  const returnScenes = [];
  const scenesToPopulate = scenesToGenerateFromCurrentTime({
    currentSceneNumber,
    currentChapter,
    fullScenes,
    precedingScenes,
    followingScenes,
  });
  for (const sceneToPopulate of scenesToPopulate) {
    const chapterScenes = fullScenes[sceneToPopulate.chapter];
    if (chapterScenes) {
      const scene = chapterScenes.find((s) => s.scene_number === sceneToPopulate.scene_number);
      if (scene) {
        scene.chapter = sceneToPopulate.chapter;
        returnScenes.push(scene);
      }
    }
  }
  return returnScenes;
}

/**
 * Gets the adjacent scenes to the given sceneId.
 * @param {Array} scenesList - The list of scenes.
 * @param {string} sceneId - The id of the scene to get the adjacent scenes for.
 * @param {number} adjacentCount - The number of adjacent scenes to get.
 * @return {Array} - The list of adjacent scenes.
 */
function getAdjacentScenes({scenesList, sceneId, adjacentCount = 5}) {
  if (scenesList.length === 0) return [];
  if (scenesList.length <= 2) return scenesList; // can't really center anything.
  if (scenesList.length < (adjacentCount * 2 + 1)) {
    adjacentCount = Math.floor(scenesList.length / 2);
  }
  let index = scenesList.findIndex((scene) => scene.id === sceneId);
  if (index === -1) {
    logger.warn(`getAdjacentScenes: Scene with id ${sceneId} not found in scenesList`);
    // If scene not found, find the index of the global default scene
    index = scenesList.findIndex((scene) => scene.globalDefault === true);
    if (index === -1) {
      logger.warn("getAdjacentScenes: No global default scene found, using first scene in list");
      index = 0;
    }
  }
  const result = [];

  for (let i = index - adjacentCount; i < index + adjacentCount + 1; i++) {
    const wrappedIndex = (i + scenesList.length) % scenesList.length;
    result.push(scenesList[wrappedIndex]);
  }
  return result;
}

/**
 * Sanitizes the scenes for the cache.
 * @param {Object|Array} scenes - The scenes object or array.
 * @param {string} [sceneId] - Optional sceneId to add to each scene.
 * @return {Object} - The sanitized scenes object.
 */
function sanitizeSceneForCache(scenes, sceneId) {
  const sanitizedScenes = {};

  // Handle array input (from RTDB cache due to Firebase coercion)
  if (Array.isArray(scenes)) {
    scenes.forEach((chapterScenes, index) => {
      if (chapterScenes && Array.isArray(chapterScenes)) {
        sanitizedScenes[index] = chapterScenes.map((scene) => {
          const sanitizedScene = {};
          if (scene.startTime !== undefined) sanitizedScene.startTime = scene.startTime;
          if (scene.endTime !== undefined) sanitizedScene.endTime = scene.endTime;
          if (scene.scene_number !== undefined) sanitizedScene.scene_number = scene.scene_number;
          if (scene.image !== undefined) sanitizedScene.image = scene.image;
          // Always ensure we have a prompt field - use prompt if available, otherwise use description
          if (scene.prompt !== undefined) {
            sanitizedScene.prompt = scene.prompt;
          } else if (scene.description !== undefined) {
            sanitizedScene.prompt = scene.description;
          }
          // Set sceneId: use provided sceneId if available, otherwise use scene's existing sceneId
          if (sceneId !== undefined) {
            sanitizedScene.sceneId = sceneId;
          } else if (scene.sceneId !== undefined) {
            sanitizedScene.sceneId = scene.sceneId;
          }
          if (scene.graphId !== undefined) sanitizedScene.graphId = scene.graphId;
          sanitizedScene.chapter = index;

          // Image variants for image generation
          if (scene.square !== undefined) sanitizedScene.square = scene.square;
          if (scene.tall !== undefined) sanitizedScene.tall = scene.tall;
          if (scene.wide !== undefined) sanitizedScene.wide = scene.wide;

          // Bucket paths for image generation
          if (scene.squareBucketPath !== undefined) sanitizedScene.squareBucketPath = scene.squareBucketPath;
          if (scene.tallBucketPath !== undefined) sanitizedScene.tallBucketPath = scene.tallBucketPath;
          if (scene.wideBucketPath !== undefined) sanitizedScene.wideBucketPath = scene.wideBucketPath;

          // Graph nodes
          if (scene.description !== undefined) sanitizedScene.description = scene.description;
          // Convert characters and locations from objects to arrays of names for RTDB
          if (scene.characters !== undefined) {
            if (typeof scene.characters === "object" && !Array.isArray(scene.characters)) {
              // Convert object to array of names
              sanitizedScene.characters = Object.keys(scene.characters);
            } else {
              sanitizedScene.characters = scene.characters;
            }
          }
          if (scene.locations !== undefined) {
            if (typeof scene.locations === "object" && !Array.isArray(scene.locations)) {
              // Convert object to array of names
              sanitizedScene.locations = Object.keys(scene.locations);
            } else {
              sanitizedScene.locations = scene.locations;
            }
          }
          if (scene.viewpoint !== undefined) sanitizedScene.viewpoint = scene.viewpoint;

          return sanitizedScene;
        });
      }
    });
    return sanitizedScenes;
  }

  // Handle object input (from Storage)
  for (const [chapter, chapterScenes] of Object.entries(scenes)) {
    if (Array.isArray(chapterScenes)) {
      sanitizedScenes[chapter] = chapterScenes.map((scene) => {
        const sanitizedScene = {};
        if (scene.startTime !== undefined) sanitizedScene.startTime = scene.startTime;
        if (scene.endTime !== undefined) sanitizedScene.endTime = scene.endTime;
        if (scene.scene_number !== undefined) sanitizedScene.scene_number = scene.scene_number;
        if (scene.image !== undefined) sanitizedScene.image = scene.image;
        // Always ensure we have a prompt field - use prompt if available, otherwise use description
        if (scene.prompt !== undefined) {
          sanitizedScene.prompt = scene.prompt;
        } else if (scene.description !== undefined) {
          sanitizedScene.prompt = scene.description;
        }
        sanitizedScene.sceneId = sceneId || scene.sceneId;
        if (scene.graphId !== undefined) sanitizedScene.graphId = scene.graphId;
        sanitizedScene.chapter = parseInt(chapter);

        // Image variants for image generation
        if (scene.square !== undefined) sanitizedScene.square = scene.square;
        if (scene.tall !== undefined) sanitizedScene.tall = scene.tall;
        if (scene.wide !== undefined) sanitizedScene.wide = scene.wide;

        // Bucket paths for image generation
        if (scene.squareBucketPath !== undefined) sanitizedScene.squareBucketPath = scene.squareBucketPath;
        if (scene.tallBucketPath !== undefined) sanitizedScene.tallBucketPath = scene.tallBucketPath;
        if (scene.wideBucketPath !== undefined) sanitizedScene.wideBucketPath = scene.wideBucketPath;

        // Graph nodes
        if (scene.description !== undefined) sanitizedScene.description = scene.description;
        // Convert characters and locations from objects to arrays of names for RTDB
        if (scene.characters !== undefined) {
          if (typeof scene.characters === "object" && !Array.isArray(scene.characters)) {
            // Convert object to array of names
            sanitizedScene.characters = Object.keys(scene.characters);
          } else {
            sanitizedScene.characters = scene.characters;
          }
        }
        if (scene.locations !== undefined) {
          if (typeof scene.locations === "object" && !Array.isArray(scene.locations)) {
            // Convert object to array of names
            sanitizedScene.locations = Object.keys(scene.locations);
          } else {
            sanitizedScene.locations = scene.locations;
          }
        }
        if (scene.viewpoint !== undefined) sanitizedScene.viewpoint = scene.viewpoint;

        return sanitizedScene;
      });
    }
  }
  return sanitizedScenes;
}

/**
 * Fixes discontinuities between chapter timestamps in scenes data.
 * Makes the last scene's endTime of each chapter match the first scene's startTime of the next chapter.
 *
 * @param {Object} scenes - The scenes object with chapter keys and scene arrays
 * @return {Object} - The fixed scenes object
 */
function fixChapterContinuity(scenes) {
  const fixedScenes = JSON.parse(JSON.stringify(scenes)); // Deep copy

  for (let i = 0; i < Object.keys(fixedScenes).length - 1; i++) {
    const currentChapter = fixedScenes[i];
    const nextChapter = fixedScenes[i + 1];

    if (currentChapter?.length && nextChapter?.length) {
      const lastSceneOfCurrentChapter = currentChapter[currentChapter.length - 1];
      const firstSceneOfNextChapter = nextChapter[0];

      // Make the last scene's endTime equal to the next chapter's first scene startTime
      lastSceneOfCurrentChapter.endTime = firstSceneOfNextChapter.startTime;
    }
  }

  return fixedScenes;
}

/**
 * Verifies chapter timestamp continuity and returns any discontinuities found.
 *
 * @param {Object} scenes - The scenes object with chapter keys and scene arrays
 * @return {Array} - Array of discontinuities, each with chapterTransition, lastSceneEndTime,
 *                  nextSceneStartTime, and timeDifference properties
 */
function findChapterDiscontinuities(scenes) {
  const discontinuities = [];

  for (let i = 0; i < Object.keys(scenes).length - 1; i++) {
    const currentChapter = scenes[i];
    const nextChapter = scenes[i + 1];

    if (currentChapter && nextChapter) {
      const lastSceneOfCurrentChapter = currentChapter[currentChapter.length - 1];
      const firstSceneOfNextChapter = nextChapter[0];

      if (lastSceneOfCurrentChapter.endTime !== firstSceneOfNextChapter.startTime) {
        discontinuities.push({
          chapterTransition: `${i} → ${i + 1}`,
          lastSceneEndTime: lastSceneOfCurrentChapter.endTime,
          nextSceneStartTime: firstSceneOfNextChapter.startTime,
          timeDifference: firstSceneOfNextChapter.startTime - lastSceneOfCurrentChapter.endTime,
        });
      }
    }
  }

  return discontinuities;
}

export {
  sceneFromCurrentTime,
  scenesToGenerateFromCurrentTime,
  getAdjacentScenes,
  scenesFromCurrentTime,
  sanitizeSceneForCache,
  fixChapterContinuity,
  findChapterDiscontinuities,
};
