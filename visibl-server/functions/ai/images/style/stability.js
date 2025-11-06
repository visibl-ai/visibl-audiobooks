/**
 * @fileoverview Stability-specific implementation for scene styling
 * Uses Stability AI's structure control for style transfer
 */

import logger from "../../../util/logger.js";
import {getData} from "../../../storage/realtimeDb/database.js";
import {queueAddEntries, stabilityQueueToUnique} from "../../../storage/firestore/queue.js";
import {dispatchTask} from "../../../util/dispatch.js";

/**
 * Style scenes using Stability AI's structure control
 * @param {Object} params - The parameters object
 * @param {Array} params.scenes - Array of scene objects to style
 * @param {string} params.sceneId - The scene ID to save styled images to
 * @param {string} params.theme - The style/theme prompt to apply
 * @param {string} params.defaultSceneId - The default scene ID for getting origin images
 * @return {Promise<void>}
 */
export async function styleWithStability(params) {
  let {scenes, sceneId, theme, defaultSceneId} = params;

  // Prepare queue entries
  const types = [];
  const entryTypes = [];
  const entryParams = [];
  const uniques = [];

  // Get tall images from origin scenes if needed
  for (const scene of scenes) {
    if (!scene.tall) {
      const ref = `scenes/${defaultSceneId}/${scene.chapter}/${scene.scene_number}`;
      logger.debug(`styleWithStability: scene_number ${scene.scene_number} in chapter ${scene.chapter} has no tall image, checking origin scene ${defaultSceneId}, ref ${ref}`);
      const originScene = await getData({ref});
      if (originScene && originScene.image) {
        logger.debug(`styleWithStability: Origin scene found for scene_number ${scene.scene_number} in chapter ${scene.chapter}`);
        scene.tall = originScene.image;
        scene.image = originScene.image;
        scene.prompt = originScene.prompt;
        scene.sceneId = originScene.sceneId;
      }
    }
  }

  // Filter out scenes without images
  scenes = scenes.filter((scene) => scene.tall !== undefined);
  logger.debug(`Filtered out scenes without images, there are ${scenes.length} remaining.`);
  logger.debug(`styleWithStability: Scenes to process: ${JSON.stringify(scenes.map((s) => ({
    chapter: s.chapter,
    scene_number: s.scene_number,
    has_tall: !!s.tall,
  })))}`);

  // Create queue entries for each scene
  for (const scene of scenes) {
    if (scene.tall && sceneId) {
      types.push("stability");
      entryTypes.push("structure");
      const timestamp = Date.now();

      // Output path for styled image
      const imagePath = `Scenes/${sceneId}/${scene.chapter}_scene${scene.scene_number}_${timestamp}`;

      // Source image path
      let bucketPath = scene.tallBucketPath;
      if (!bucketPath) {
        try {
          const filename = new URL(scene.tall).pathname.split("/").pop();
          bucketPath = `Scenes/${scene.sceneId}/${filename}`;
        } catch (error) {
          // If URL parsing fails, treat scene.tall as a filename directly
          logger.debug(`Failed to parse URL for scene.tall: ${scene.tall}. Treating as filename.`);
          bucketPath = scene.tall.startsWith("Scenes/") ? scene.tall : `Scenes/${scene.sceneId}/${scene.tall}`;
        }
      }

      entryParams.push({
        inputPath: bucketPath,
        outputPathWithoutExtension: imagePath,
        prompt: theme,
        sceneId: sceneId,
        chapter: scene.chapter,
        scene_number: scene.scene_number,
        retry: true,
      });

      uniques.push(stabilityQueueToUnique({
        type: "stability",
        entryType: "structure",
        sceneId: sceneId,
        chapter: scene.chapter,
        scene_number: scene.scene_number,
        retry: true,
      }));
    }
  }

  // Add entries to queue
  await queueAddEntries({
    types,
    entryTypes,
    entryParams,
    uniques,
  });

  // Dispatch the Stability queue processor
  await dispatchTask({
    functionName: "launchStabilityQueue",
    data: {},
  });

  logger.debug(`styleWithStability: Queued ${types.length} scenes for styling`);
}
