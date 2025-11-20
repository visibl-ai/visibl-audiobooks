/* eslint-disable require-jsdoc */
import logger from "../../../util/logger.js";
import {getScenesFromCache} from "../../../storage/realtimeDb/scenesCache.js";
import {getGraphCharactersRtdb} from "../../../storage/realtimeDb/graph.js";
import {getGraphLocationsRtdb} from "../../../storage/realtimeDb/graph.js";
import {
  queueAddEntries,
} from "../../../storage/firestore/queue.js";
import {dispatchTask} from "../../../util/dispatch.js";
import {wavespeedQueueToUnique} from "../../../ai/queue/wavespeedQueue.js";
import {sanitizeFirebaseKey} from "../../../storage/utils.js";
import {getGraphFirestore} from "../../../storage/firestore/graph.js";

/**
 * Normalize entity names to handle space/underscore variations
 * Converts underscores and special characters to spaces, then trims multiple spaces
 * @param {Object} params - Object containing the name to normalize
 * @param {string} params.name - The entity name to normalize
 * @return {string} The normalized name
 */
function normalizeEntityName({name}) {
  // Use sanitizeFirebaseKey to ensure consistency
  return sanitizeFirebaseKey({key: name});
}

/**
 * Compose images for specific scenes
 * @param {Object} params - Parameters for scene image composition
 * @param {string} params.graphId - The graph ID
 * @param {string} params.defaultSceneId - The scene ID for RTDB cache access
 * @param {string} params.sku - The SKU identifier
 * @param {Array<{chapter: number, scene: number}>} params.scenes - Array of scene identifiers, each object containing:
 *   - chapter: The chapter number (e.g., 0, 1, 2)
 *   - scene: The scene number within that chapter (e.g., 1, 2, 3)
 *   Example: [{chapter: 0, scene: 1}, {chapter: 0, scene: 2}, {chapter: 1, scene: 1}]
 * @return {Promise<Object>} Result of scene image composition
 */
async function composeSceneImages({graphId, defaultSceneId, scenes, sku, uid}) {
  logger.info(`${graphId} Composing images for ${scenes.length} scenes in graph ${graphId} using scene ${defaultSceneId}`);

  // Fetch the graph to get the seed for consistent image generation
  const graph = await getGraphFirestore({graphId});
  const seed = graph?.seed || Math.floor(Math.random() * 2 ** 32); // Fallback to random seed if not available
  logger.debug(`${graphId} Using seed ${seed} for scene image generation`);

  // Load all scenes from RTDB cache
  const cachedScenes = await getScenesFromCache({sceneId: defaultSceneId});
  if (!cachedScenes) {
    throw new Error(`${graphId} No scenes found in cache for scene ID ${defaultSceneId}`);
  }

  // We'll load character and location descriptions per chapter as needed
  const chapterDescriptionsCache = {};

  // Prepare queue entries
  const types = [];
  const entryTypes = [];
  const entryParams = [];
  const uniques = [];
  let processedCount = 0;
  let skippedCount = 0;

  // Process each requested scene
  for (const sceneRequest of scenes) {
    const {chapter, scene: sceneNumber} = sceneRequest;
    logger.debug(`${graphId} Processing scene request: chapter=${chapter}, sceneNumber=${sceneNumber}`);

    // Find the scene in the cached data
    if (!cachedScenes[chapter]) {
      logger.warn(`${graphId} Chapter ${chapter} not found in cached scenes`);
      skippedCount++;
      continue;
    }

    const sceneData = cachedScenes[chapter].find((s) => s.scene_number === sceneNumber);
    if (!sceneData) {
      logger.warn(`${graphId} Scene ${sceneNumber} not found in chapter ${chapter}`);
      skippedCount++;
      continue;
    }

    // Load descriptions for this chapter if not already cached
    if (!chapterDescriptionsCache[chapter]) {
      const rtdbCharacters = await getGraphCharactersRtdb({graphId, chapter}) || {};
      const rtdbLocations = await getGraphLocationsRtdb({graphId, chapter}) || {};

      // Build normalized description maps for this chapter
      const characterDescriptionsNormalized = {};
      const locationDescriptionsNormalized = {};

      Object.entries(rtdbCharacters).forEach(([sanitizedName, data]) => {
        // Normalize the key and use lowercase for case-insensitive matching
        if (data.description) {
          const normalized = normalizeEntityName({name: sanitizedName});
          characterDescriptionsNormalized[normalized.toLowerCase()] = data.description;
        }
      });

      Object.entries(rtdbLocations).forEach(([sanitizedName, data]) => {
        // Normalize the key and use lowercase for case-insensitive matching
        if (data.description) {
          const normalized = normalizeEntityName({name: sanitizedName});
          locationDescriptionsNormalized[normalized.toLowerCase()] = data.description;
        }
      });

      // Cache the descriptions for this chapter
      chapterDescriptionsCache[chapter] = {
        charactersNormalized: characterDescriptionsNormalized,
        locationsNormalized: locationDescriptionsNormalized,
      };
    }

    // Get the descriptions for this chapter
    const chapterDescriptions = chapterDescriptionsCache[chapter];

    // Enrich characters with descriptions from RTDB
    let enrichedCharacters = sceneData.characters;
    if (sceneData.characters && Array.isArray(sceneData.characters) && sceneData.characters.length > 0) {
      const charactersObj = {};
      sceneData.characters.forEach((charName) => {
        // Normalize the character name to match RTDB key format
        const normalizedName = normalizeEntityName({name: charName});

        // Look up using normalized name (handles space/underscore/special char variations)
        const description = chapterDescriptions.charactersNormalized[normalizedName.toLowerCase()] || "";

        charactersObj[charName] = description;

        if (description) {
          logger.debug(`${graphId} Found description for character ${charName}: ${description.substring(0, 50)}...`);
        } else {
          logger.debug(`${graphId} No description found for character ${charName}`);
        }
      });
      enrichedCharacters = charactersObj;
    }

    // Enrich locations with descriptions from RTDB
    let enrichedLocations = sceneData.locations;
    if (sceneData.locations && Array.isArray(sceneData.locations) && sceneData.locations.length > 0) {
      const locationsObj = {};
      sceneData.locations.forEach((locName) => {
        // Normalize the location name to match RTDB key format
        const normalizedName = normalizeEntityName({name: locName});

        // Look up using normalized name (handles space/underscore/special char variations)
        const description = chapterDescriptions.locationsNormalized[normalizedName.toLowerCase()] || "";

        locationsObj[locName] = description;

        if (description) {
          logger.debug(`${graphId} Found description for location ${locName}: ${description.substring(0, 50)}...`);
        } else {
          logger.debug(`${graphId} No description found for location ${locName}`);
        }
      });
      enrichedLocations = locationsObj;
    }

    // Check if sceneData has a prompt field, otherwise build promptJson
    let prompt;
    if (sceneData.prompt) {
      // Use the existing prompt from sceneData
      prompt = sceneData.prompt;
      logger.debug(`${graphId} Using existing prompt from sceneData for chapter ${chapter}, scene ${sceneNumber}`);
    } else {
      // Build promptJson as before (fallback behavior)
      const promptJson = {
        description: sceneData.description,
        characters: enrichedCharacters,
        locations: enrichedLocations,
        viewpoint: sceneData.viewpoint,
      };
      // Convert the cleaned scene to JSON as the prompt
      prompt = `${JSON.stringify(promptJson)}`;
      logger.debug(`${graphId} Built promptJson for chapter ${chapter}, scene ${sceneNumber}`);
    }

    // Create timestamp for unique filename
    const timestamp = Date.now();

    // Create output path matching the expected format
    const outputPath = `Scenes/${defaultSceneId}/${chapter}_scene${sceneNumber}_${timestamp}.jpeg`;
    // Log the scene prompt for debugging
    logger.debug(`${graphId} Scene prompt: ${JSON.stringify(prompt, null, 2)}`);
    // Prepare queue entry
    types.push("wavespeed");
    entryTypes.push("generate");
    entryParams.push({
      prompt: prompt,
      negativePrompt: "animated, cartoon, low quality",
      model: "google/imagen4-fast",
      outputPath: outputPath,
      outputFormat: "jpeg",
      modelParams: {
        aspect_ratio: "9:16",
        seed: seed,
        enable_base64_output: true,
        enable_safety_checker: false,
        enable_sync_mode: true,
      },
      // Metadata for updating RTDB after generation
      graphId,
      defaultSceneId,
      styleId: defaultSceneId, // When composing images, we use the default scene id as the style id.
      styleTitle: "Origin", // When composing images, we use the default scene id as the style title.
      chapter,
      sceneNumber,
      type: "sceneImage",
      sku: sku,
      uid: uid,
    });

    // Generate unique key for deduplication
    const uniqueKey = wavespeedQueueToUnique({
      type: "wavespeed",
      entryType: "generate",
      graphId,
      identifier: `${defaultSceneId}_${chapter}_${sceneNumber}`,
      chapter,
    });
    uniques.push(uniqueKey);
    processedCount++;
  }

  // Queue all entries if any
  if (types.length > 0) {
    const queueResult = await queueAddEntries({
      types,
      entryTypes,
      entryParams,
      uniques,
    });

    if (queueResult.success) {
      logger.info(`${graphId} Queued ${processedCount} scene images for generation (skipped ${skippedCount})`);

      // Dispatch the wavespeed queue to start processing
      await dispatchTask({
        functionName: "launchWavespeedQueue",
        data: {},
      });

      return {
        success: true,
        queued: processedCount,
        skipped: skippedCount,
        message: `Successfully queued ${processedCount} scene images for generation`,
      };
    } else {
      // Check if it's a duplicate error
      if (queueResult.error && queueResult.error.includes("ALREADY_EXISTS")) {
        logger.warn(`${graphId} Some scene images already exist in queue, continuing...`);
        return {
          success: true,
          queued: 0,
          skipped: processedCount,
          message: `Scene images already in queue, skipped ${processedCount} duplicates`,
        };
      }
      logger.error(`${graphId} Failed to queue scene images. Result: ${JSON.stringify(queueResult)}`);
      throw new Error(`Failed to queue scene images: ${queueResult.error || queueResult.message || "Unknown error"}`);
    }
  } else {
    return {
      success: false,
      queued: 0,
      skipped: skippedCount,
      message: "No valid scenes found to process",
    };
  }
}

export {composeSceneImages};
