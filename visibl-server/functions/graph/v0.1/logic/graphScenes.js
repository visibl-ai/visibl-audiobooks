import logger from "../../../util/logger.js";
import {getTranscriptions, getGraph, storeGraph} from "../../../storage/storage.js";
import {catalogueGetRtdb} from "../../../storage/realtimeDb/catalogue.js";
import {getChapterDuration} from "../../../util/graphHelper.js";
import {transcriptionsToText} from "../graphV0_1logic.js";
import {
  sanitizeFirebaseKey,
} from "../../../storage/utils.js";
import {OpenRouterClient, OpenRouterMockResponse} from "../../../ai/openrouter/base.js";
import csv from "../../../ai/csv.js";
import graphPrompts from "../graphV0_1Prompts.js";


const MIN_CHAPTER_DURATION = 30;
const MIN_SLICE_DURATION = 180; // Process a bit less thank 180 seconds of content per chunk
const TARGET_SCENE_DURATION = 15; // Target duration per scene in seconds
const MAX_CHARACTERS_PER_SCENE = 3;

/**
 * Generate scenes for a chapter using characters and locations from previous steps
 * @param {Object} params - Parameters for scene generation
 * @param {string} params.uid - User ID
 * @param {string} params.sku - Book SKU
 * @param {string} params.visibility - Visibility setting
 * @param {string} params.graphId - Graph ID
 * @param {number} params.chapter - Chapter number to process
 * @return {Promise<Object>} Generated scenes for the chapter
 */
async function graphScenes(params) {
  const {uid, sku, visibility, chapter, graphId} = params;
  logger.debug(`${graphId} Generating scenes for chapter ${chapter} of graphId ${graphId}`);

  // 1. Get all necessary data
  const transcriptions = await getTranscriptions({uid, sku, visibility});
  const chapterTranscriptions = transcriptions[chapter];

  // Get chapter metadata from catalogue
  const catalogueItem = await catalogueGetRtdb({sku});
  logger.debug(`${graphId} catalogueItem: ${JSON.stringify(catalogueItem).substring(0, 150)}`);

  // Validate catalogue item structure
  if (!catalogueItem) {
    throw new Error(`${graphId} No catalogue item found for SKU: ${sku}`);
  }
  if (!catalogueItem.metadata || !catalogueItem.metadata.chapters) {
    throw new Error(`${graphId} Catalogue item for SKU ${sku} is missing metadata.chapters`);
  }
  if (!catalogueItem.metadata.chapters[chapter]) {
    throw new Error(`${graphId} Chapter ${chapter} not found in catalogue metadata for SKU ${sku}. Available chapters: 0-${catalogueItem.metadata.chapters.length - 1}`);
  }

  const chapterMetadata = catalogueItem.metadata.chapters[chapter];
  const startTime = chapterMetadata.startTime;
  const endTime = chapterMetadata.endTime;

  // Load existing global scenes or initialize
  let globalScenes;
  try {
    globalScenes = await getGraph({
      uid,
      sku,
      visibility,
      type: "scenes",
      graphId,
      // No chapter parameter - load global file
    });
  } catch (error) {
    // First chapter or file doesn't exist yet
    globalScenes = {};
  }

  // Check chapter duration
  const duration = getChapterDuration(chapterTranscriptions);
  if (duration < MIN_CHAPTER_DURATION) {
    logger.info(`${graphId} Chapter ${chapter} duration ${duration}s is less than ${MIN_CHAPTER_DURATION}s - creating default scene`);

    // Use the existing helper function to get chapter text
    const chapterText = transcriptionsToText(chapterTranscriptions);

    // Create a single default scene
    const defaultScene = {
      scene_number: 0,
      description: chapterText || `Chapter ${chapter}`,
      startTime: Number(startTime.toFixed(2)),
      endTime: Number(endTime.toFixed(2)),
      characters: {}, // Empty object as specified
      locations: {}, // Empty object as specified
      viewpoint: {
        setting: "default lighting",
        placement: "standard view",
        shot_type: "wide shot",
        mood: "neutral",
        technical: "35mm f/2.8",
      },
    };

    // Store in global format
    globalScenes[chapter] = [defaultScene];

    await storeGraph({
      uid,
      sku,
      visibility,
      data: globalScenes,
      type: "scenes",
      graphId,
      // No chapter parameter - store as global file
    });

    // Return the chapter's scenes for consistency
    return {scenes: [defaultScene]};
  }
  logger.debug(`${graphId} ${chapter} Chapter duration ${duration}s is greater than ${MIN_CHAPTER_DURATION}s - creating scenes`);

  // 2. Get characters and locations for this chapter from the earlier pipeline steps
  let charactersData;
  let locationsData;

  try {
    charactersData = await getGraph({
      uid,
      sku,
      visibility,
      type: "characters",
      chapter,
      graphId,
    });
  } catch (error) {
    logger.error(`${graphId} ${chapter} Failed to load characters for chapter ${chapter}: ${error.message}`);
    throw new Error(`${graphId} Failed to load characters for chapter ${chapter}: ${error.message}`);
  }

  try {
    locationsData = await getGraph({
      uid,
      sku,
      visibility,
      type: "locations",
      chapter,
      graphId,
    });
  } catch (error) {
    logger.error(`${graphId} ${chapter} Failed to load locations for chapter ${chapter}: ${error.message}`);
    throw new Error(`${graphId} Failed to load locations for chapter ${chapter}: ${error.message}`);
  }

  // 3. Get character and location descriptions from the summarized image prompts
  let characterDescriptions = {};
  let locationDescriptions = {};

  try {
    const charSummaryData = await getGraph({
      uid,
      sku,
      visibility,
      type: "characterImagePrompts-summarized",
      chapter,
      graphId,
    });
    if (charSummaryData && charSummaryData.characterPromptSummaries) {
      characterDescriptions = charSummaryData.characterPromptSummaries;
    }
  } catch (error) {
    logger.debug(`${graphId} ${chapter} No character summaries found for chapter ${chapter}: ${error.message}`);
  }

  try {
    const locSummaryData = await getGraph({
      uid,
      sku,
      visibility,
      type: "locationImagePrompts-summarized",
      chapter,
      graphId,
    });
    if (locSummaryData && locSummaryData.locationPromptSummaries) {
      locationDescriptions = locSummaryData.locationPromptSummaries;
    }
  } catch (error) {
    logger.debug(`${graphId} ${chapter} No location summaries found for chapter ${chapter}: ${error.message}`);
  }

  if (typeof characterDescriptions === "undefined") {
    logger.warn(`${graphId} ${chapter} getScenes: characterDescriptions is undefined, setting to empty object; probably shouldn't be here`);
    characterDescriptions = {};
  }
  if (typeof locationDescriptions === "undefined") {
    logger.warn(`${graphId} ${chapter} getScenes: locationDescriptions is undefined, setting to empty object; probably shouldn't be here`);
    locationDescriptions = {};
  }

  // Create case-insensitive lookup maps
  const characterDescriptionsLower = {};
  Object.entries(characterDescriptions).forEach(([name, desc]) => {
    characterDescriptionsLower[name.toLowerCase()] = desc;
  });

  const locationDescriptionsLower = {};
  Object.entries(locationDescriptions).forEach(([name, desc]) => {
    locationDescriptionsLower[name.toLowerCase()] = desc;
  });

  // 4. Prepare CSV data for characters and locations
  const charactersCsv = csv(charactersData.characters || []);
  const locationsCsv = csv(locationsData.locations || []);

  // 5. Format transcriptions with proper timestamps
  chapterTranscriptions.forEach((item) => {
    if (typeof item.startTime === "number") {
      item.startTime = item.startTime.toFixed(1);
    }
  });
  logger.debug(`${graphId} ${chapter} Loaded entities: ${charactersData.characters.length} characters and ${locationsData.locations.length} locations - proceeding with scene generation`);
  // 6. Process scenes in chunks - create all promises
  const openRouterClient = new OpenRouterClient();
  const chunkPromises = [];
  const retryAttempts = {}; // Track retry attempts per chunk

  let chunkStart = 0;
  let chunkIndex = 0;

  while (chunkStart < chapterTranscriptions.length) {
    // Find the end of this chunk based on duration
    let chunkEnd = chunkStart + 1; // At least one item per chunk
    const baseTime = parseFloat(chapterTranscriptions[chunkStart].startTime);

    // Keep adding items until we reach MIN_SLICE_DURATION or run out of transcriptions
    while (chunkEnd < chapterTranscriptions.length) {
      const currentDuration = parseFloat(chapterTranscriptions[chunkEnd].startTime) - baseTime;
      if (currentDuration >= MIN_SLICE_DURATION) {
        break;
      }
      chunkEnd++;
    }

    const chapterChunkCSV = csv(chapterTranscriptions, chunkStart, chunkEnd);
    const currentChunkIndex = chunkIndex; // Capture for closure

    // Get the time range for this chunk for validation
    const chunkStartTime = chapterTranscriptions[chunkStart] ?
      parseFloat(chapterTranscriptions[chunkStart].startTime) : 0;
    const chunkEndTime = chapterTranscriptions[Math.min(chunkEnd - 1, chapterTranscriptions.length - 1)] ?
      parseFloat(chapterTranscriptions[Math.min(chunkEnd - 1, chapterTranscriptions.length - 1)].startTime) :
      chunkStartTime + 30;

    const chunkDuration = chunkEndTime - chunkStartTime;
    logger.debug(`${graphId} ${chapter} Processing chunk ${currentChunkIndex}: items ${chunkStart}-${chunkEnd} (${chunkDuration.toFixed(1)}s from ${chunkStartTime.toFixed(1)}s to ${chunkEndTime.toFixed(1)}s)`);

    // Calculate minimum scenes based on chunk duration
    const minScenes = Math.floor(chunkDuration / TARGET_SCENE_DURATION);

    // Retry logic wrapper
    const executeWithRetry = async (attemptNumber = 1) => {
      if (!retryAttempts[currentChunkIndex]) {
        retryAttempts[currentChunkIndex] = 0;
      }
      retryAttempts[currentChunkIndex] = attemptNumber;

      // Sometimes the model struggles to generate enough scenes for a chunk; to avoid ending up with 0
      // we just stop enforcing the minimum on the final attempt.
      const isLastAttempt = attemptNumber === 2;
      return openRouterClient.sendRequest({
        promptOverride: graphPrompts["v0_1_generate_scenes"]({minScenes, isLastAttempt}),
        modelOverride: "deepseek/deepseek-chat-v3-0324",
        message: chapterChunkCSV,
        replacements: [
          {
            key: "CHARACTER_LIST",
            value: charactersCsv,
          },
          {
            key: "LOCATION_LIST",
            value: locationsCsv,
          },
        ],
        mockResponse: mockSceneResponse({currentChunkIndex, attemptNumber, chunkStartTime, chunkEndTime, chunkDuration}),
      }).then((result) => {
        logger.debug(`${graphId} ${chapter} Processed scene chunk ${currentChunkIndex + 1} for chapter ${chapter} (attempt ${attemptNumber})`);

        if (!result.result) {
          logger.error(`${graphId} ${chapter} No result object returned for chunk ${currentChunkIndex} - AI response may be malformed`);
          throw new Error("Missing result object in AI response");
        }

        if (!result.result.scenes) {
          logger.error(`${graphId} ${chapter} No scenes array in result for chunk ${currentChunkIndex} - AI response structure: ${JSON.stringify(result.result)}`);
          throw new Error("Missing scenes array in AI response");
        }

        if (!Array.isArray(result.result.scenes)) {
          logger.error(`${graphId} ${chapter} Scenes is not an array for chunk ${currentChunkIndex} - type: ${typeof result.result.scenes}`);
          throw new Error("Scenes is not an array");
        }

        // Validate timestamps are within reasonable range
        const tolerance = 60; // Allow 60 seconds tolerance outside chunk range
        const minValidTime = Math.max(0, chunkStartTime - tolerance);
        const maxValidTime = chunkEndTime + tolerance;

        const validatedScenes = [];
        for (const scene of result.result.scenes) {
        // Check if startTime is valid
          if (typeof scene.startTime !== "number") {
            logger.error(`${graphId} ${chapter} Scene ${scene.scene_number} in chunk ${currentChunkIndex} has invalid startTime type: ${typeof scene.startTime}, value: ${scene.startTime}`);
            throw new Error(`Invalid startTime type for scene ${scene.scene_number}`);
          }

          if (scene.startTime < minValidTime || scene.startTime > maxValidTime) {
            logger.error(`${graphId} ${chapter} Scene ${scene.scene_number} in chunk ${currentChunkIndex} has startTime ${scene.startTime} outside valid range [${minValidTime}, ${maxValidTime}]`);
            throw new Error(`Scene startTime ${scene.startTime} outside valid range`);
          }

          // Validate locations - should have exactly 1
          if (!scene.locations || scene.locations.length === 0) {
            logger.warn(`${graphId} ${chapter} Scene ${scene.scene_number} in chunk ${currentChunkIndex} has no locations`);
            scene.locations = [];
          } else if (scene.locations.length > 1) {
            logger.warn(`${graphId} ${chapter} Scene ${scene.scene_number} in chunk ${currentChunkIndex} has ${scene.locations.length} locations, keeping only the first one: ${scene.locations.join(", ")}`);
            scene.locations = [scene.locations[0]];
          }

          // Validate characters - should have at most MAX_CHARACTERS_PER_SCENE
          if (!scene.characters || scene.characters.length === 0) {
          // This is fine - scene might have no characters
            scene.characters = [];
          } else if (scene.characters.length > MAX_CHARACTERS_PER_SCENE) {
            logger.warn(`${graphId} ${chapter} Scene ${scene.scene_number} in chunk ${currentChunkIndex} has ${scene.characters.length} characters (${scene.characters.join(", ")}), keeping only the first ${MAX_CHARACTERS_PER_SCENE}`);
            scene.characters = scene.characters.slice(0, MAX_CHARACTERS_PER_SCENE);
          }

          validatedScenes.push(scene);
        }

        return {
          chunkIndex: currentChunkIndex,
          scenes: validatedScenes,
        };
      }).catch(async (error) => {
        logger.error(`${graphId} ${chapter} Error generating scenes for chunk ${currentChunkIndex} on attempt ${attemptNumber}: ${error.message}`);

        // Retry if this was the first attempt
        if (attemptNumber === 1) {
          logger.info(`${graphId} ${chapter} Retrying chunk ${currentChunkIndex} (attempt 2)...`);
          return executeWithRetry(2);
        }

        // Failed after retry
        logger.error(`${graphId} ${chapter} Failed to generate scenes for chunk ${currentChunkIndex} after 2 attempts`);
        return {chunkIndex: currentChunkIndex, scenes: []};
      });
    };

    // Start the execution with retry
    const chunkPromise = executeWithRetry(1);
    chunkPromises.push(chunkPromise);

    // Move to next chunk
    chunkStart = chunkEnd;
    chunkIndex++;
  }

  // Wait for all chunks to complete
  const chunkResults = await Promise.all(chunkPromises);

  // Sort chunks by index and combine scenes
  chunkResults.sort((a, b) => a.chunkIndex - b.chunkIndex);

  // Log chunk statistics
  logger.info(`${graphId} ${chapter} Scene generation statistics:`);
  let totalScenes = 0;
  let totalDuration = 0;
  chunkResults.forEach((chunk, index) => {
    const chunkSceneCount = chunk.scenes.length;
    totalScenes += chunkSceneCount;

    // Calculate chunk duration from scene timestamps
    if (chunk.scenes.length > 0) {
      const firstSceneTime = chunk.scenes[0].startTime;
      const lastSceneTime = chunk.scenes[chunk.scenes.length - 1].startTime;
      const chunkDur = lastSceneTime - firstSceneTime;
      totalDuration += chunkDur;
      const avgSceneDuration = chunkSceneCount > 1 ? chunkDur / (chunkSceneCount - 1) : 0;
      logger.info(`  Chunk ${index}: ${chunkDur.toFixed(1)}s duration, ${chunkSceneCount} scenes, ${avgSceneDuration.toFixed(1)}s avg scene duration`);
    } else {
      logger.info(`  Chunk ${index}: No scenes generated`);
    }
  });
  const overallAvgSceneDuration = totalScenes > 1 ? totalDuration / (totalScenes - 1) : 0;
  logger.info(`${graphId} ${chapter} Total: ${totalScenes} scenes across ${chunkResults.length} chunks, ${overallAvgSceneDuration.toFixed(1)}s overall avg scene duration`);

  const allScenes = [];

  // First, flatten all scenes with their chunk info for look-ahead
  const flatScenes = [];
  for (const chunk of chunkResults) {
    for (const scene of chunk.scenes) {
      flatScenes.push(scene);
    }
  }

  // Sort scenes by startTime to handle out-of-order scenes from AI
  flatScenes.sort((a, b) => a.startTime - b.startTime);

  // Remove duplicate scenes with identical startTime values
  const dedupedScenes = [];
  for (let i = 0; i < flatScenes.length; i++) {
    if (i === 0 || flatScenes[i].startTime !== flatScenes[i - 1].startTime) {
      dedupedScenes.push(flatScenes[i]);
    } else {
      logger.warn(`${graphId} ${chapter} Dropping duplicate scene at ${flatScenes[i].startTime}s (scene_number ${flatScenes[i].scene_number} from AI)`);
    }
  }

  logger.debug(`${graphId} ${chapter} Deduplication: ${flatScenes.length} scenes before, ${dedupedScenes.length} scenes after (dropped ${flatScenes.length - dedupedScenes.length} duplicates)`);

  // add sequential scene numbers
  for (let i = 0; i < dedupedScenes.length; i++) {
    const scene = dedupedScenes[i];

    // Add scene with adjusted scene number and start time
    const adjustedScene = {
      ...scene,
      scene_number: allScenes.length, // Start at 0.
    };
    if (scene.viewpoint?.technical) {
      adjustedScene.viewpoint.technical = `${adjustedScene.viewpoint.technical}, 9:16 aspect ratio`;
    }
    allScenes.push(adjustedScene);
  }

  // Lowercase all characters and locations in scenes
  allScenes.forEach((scene) => {
    if (scene.characters && Array.isArray(scene.characters)) {
      scene.characters = scene.characters.map((char) => char.toLowerCase());
    }
    if (scene.locations && Array.isArray(scene.locations)) {
      scene.locations = scene.locations.map((loc) => loc.toLowerCase());
    }
  });

  // 7. Add endTime to each scene and ensure proper time alignment
  // First scene starts at chapter start, last scene ends at chapter end
  // Each scene's endTime equals the next scene's startTime
  const scenesWithEndTime = allScenes.map((scene, index) => {
    // Correct the first scene's startTime to match chapter start
    if (index === 0) {
      if (scene.startTime !== startTime) {
        logger.info(`${graphId} ${chapter} Correcting first scene startTime from ${scene.startTime} to ${startTime}`);
        scene.startTime = Number(startTime.toFixed(2));
      }
    }

    // Set endTime based on position
    if (index < allScenes.length - 1) {
      // Not the last scene - endTime is the next scene's startTime
      scene.endTime = Number(parseFloat(allScenes[index + 1].startTime).toFixed(2));
    } else {
      // Last scene - use chapter end time from metadata
      scene.endTime = Number(endTime.toFixed(2));
      logger.info(`${graphId} ${chapter} Setting last scene endTime to chapter end: ${scene.endTime}`);
    }

    // Ensure continuity: current scene's startTime should equal previous scene's endTime
    if (index > 0) {
      const previousScene = allScenes[index - 1];
      if (previousScene.endTime && scene.startTime !== previousScene.endTime) {
        logger.info(`${graphId} ${chapter} Correcting scene ${index} startTime from ${scene.startTime} to ${previousScene.endTime} for continuity`);
        scene.startTime = previousScene.endTime;
      }
    }

    return scene;
  });

  // 8. Enrich scenes with character and location descriptions from the summarized prompts
  const enrichedScenes = scenesWithEndTime.map((scene) => {
    // Convert characters array to object with name: description format
    if (scene.characters && scene.characters.length > 0) {
      const charactersObj = {};
      scene.characters.forEach((charName) => {
        // Try exact match first, then case-insensitive match
        const description = characterDescriptions[charName] ||
                          characterDescriptionsLower[charName.toLowerCase()] || "";
        // Only include characters that have descriptions (exclude empty descriptions)
        if (description) {
          charactersObj[charName] = description;
        } else {
          logger.info(`v0.1 graphScenes: ${graphId} ${chapter} scene ${scene.scene_number} Character ${charName} has no description, skipping content enrichment`);
        }
      });
      scene.characters = charactersObj;
    } else {
      scene.characters = {};
    }

    // Convert locations array to object with name: description format
    if (scene.locations && scene.locations.length > 0) {
      const locationsObj = {};
      scene.locations.forEach((locName) => {
        // Try exact match first, then case-insensitive match
        const description = locationDescriptions[locName] ||
                          locationDescriptionsLower[locName.toLowerCase()] || "";
        // Only include locations that have descriptions (exclude empty descriptions)
        if (description) {
          locationsObj[locName] = description;
        } else {
          logger.info(`v0.1 graphScenes: ${graphId} ${chapter} scene ${scene.scene_number} Location ${locName} has no description, skipping content enrichment`);
        }
      });
      scene.locations = locationsObj;
    } else {
      scene.locations = {};
    }

    return scene;
  });

  logger.info(`Generated ${enrichedScenes.length} scenes for chapter ${graphId} ${chapter}`);

  // 9. Validate scene durations
  if (enrichedScenes.length > 0) {
    const longScenes = [];

    // Check each scene's duration
    for (let i = 0; i < enrichedScenes.length; i++) {
      const scene = enrichedScenes[i];
      const sceneDuration = scene.endTime - scene.startTime;

      if (sceneDuration > 30) {
        longScenes.push({
          sceneNumber: scene.scene_number,
          duration: sceneDuration,
          startTime: scene.startTime,
          endTime: scene.endTime,
        });
      }
    }

    if (longScenes.length > 0) {
      logger.warn(`Found ${longScenes.length} scenes longer than 30s in chapter ${graphId} ${chapter}:`);
      longScenes.forEach((scene) => {
        logger.warn(`  - Scene ${scene.sceneNumber}: ${scene.duration.toFixed(1)}s (${scene.startTime.toFixed(1)}s to ${scene.endTime.toFixed(1)}s)`);
      });
    }
  }

  // 10. Store the scenes in global format
  // Add this chapter's scenes to the global object
  globalScenes[chapter] = enrichedScenes;

  // Store the complete global scenes object
  await storeGraph({
    uid,
    sku,
    visibility,
    data: globalScenes,
    type: "scenes",
    graphId,
    // No chapter parameter - store as global file
  });

  // Create scenesResult for return value consistency
  const scenesResult = {
    chapter: chapter,
    scenes: enrichedScenes,
  };

  // Extract and store referenced entities for this chapter
  const referencedCharacters = new Set();
  const referencedLocations = new Set();

  enrichedScenes.forEach((scene) => {
    // Extract characters (they are stored as objects with name: description)
    if (scene.characters && typeof scene.characters === "object") {
      Object.keys(scene.characters).forEach((charName) => {
        // Use the same sanitization as used for storage to ensure consistency
        const sanitizedName = sanitizeFirebaseKey({key: charName});
        referencedCharacters.add(sanitizedName.toLowerCase());
      });
    }

    // Extract locations (they are stored as objects with name: description)
    if (scene.locations && typeof scene.locations === "object") {
      Object.keys(scene.locations).forEach((locName) => {
        // Use the same sanitization as used for storage to ensure consistency
        const sanitizedName = sanitizeFirebaseKey({key: locName});
        referencedLocations.add(sanitizedName.toLowerCase());
      });
    }
  });

  // Save the referenced entities for this chapter
  const referencedEntities = {
    referencedCharacters: Array.from(referencedCharacters).sort(),
    referencedLocations: Array.from(referencedLocations).sort(),
  };

  logger.info(`${graphId} ${chapter}: Found ${referencedEntities.referencedCharacters.length} referenced characters and ${referencedEntities.referencedLocations.length} referenced locations`);

  await storeGraph({
    uid,
    sku,
    visibility,
    data: referencedEntities,
    type: "referenced-entities",
    chapter,
    graphId,
  });

  return scenesResult;
}

/**
 * Mock scene response for testing
 * @return {OpenRouterMockResponse} - Mock response
 */
function mockSceneResponse({currentChunkIndex, attemptNumber, chunkStartTime, chunkEndTime, chunkDuration}) {
  return new OpenRouterMockResponse({
    content: {
      scenes: (() => {
      // Test retry mechanism: Return invalid timestamp for chunk 2 on first attempt
        if (currentChunkIndex === 2 && attemptNumber === 1) {
          return [{
            scene_number: 1,
            description: "Mock scene with invalid Unix timestamp",
            startTime: 1678348980, // Unix timestamp instead of audio time
            characters: ["mockcharacter"],
            locations: ["mocklocation"],
            viewpoint: {
              setting: "test",
              placement: "test",
              shot_type: "test",
              mood: "test",
              technical: "test",
            },
          }];
        }

        // Mock scene generation logic:
        // For each chunk of transcriptions being processed, this mock creates scenes
        // at regular intervals throughout the chunk's time range to meet the minimum requirement.
        // This simulates how the AI would identify scene changes based on the
        // transcription timing, creating a realistic distribution of scenes
        // that follows the actual flow of the audio/narrative.
        const scenes = [];

        // Use the time range for this chunk that was already calculated above
        const mockChunkStartTime = chunkStartTime;
        const mockChunkEndTime = chunkEndTime;

        // Calculate minimum scenes and interval to ensure we meet the requirement
        const mockMinScenes = Math.floor(chunkDuration / TARGET_SCENE_DURATION);
        const sceneInterval = chunkDuration / Math.max(mockMinScenes, 1);
        let currentTime = mockChunkStartTime;
        let sceneCount = 0;

        while (currentTime < mockChunkEndTime) { // Generate scenes throughout the chunk
          scenes.push({
            scene_number: currentChunkIndex * 10 + sceneCount + 1, // Allow up to 10 scenes per chunk in numbering
            description: `Mock scene at ${currentTime.toFixed(1)}s: ${sceneCount % 2 === 0 ? "Characters interact" : "Scene transition"} in location.`,
            startTime: Number(currentTime.toFixed(2)),
            characters: sceneCount % 3 === 0 ? ["mockcharacter (01)", "mockcharacter02"] : sceneCount % 3 === 1 ? ["mockcharacter (01)"] : ["mockcharacter03"],
            locations: [sceneCount % 2 === 0 ? "mocklocation01" : "mocklocation02"],
            viewpoint: {
              setting: sceneCount % 2 === 0 ? "evening light" : "dim interior",
              placement: sceneCount % 2 === 0 ? "characters centered" : "character in doorway",
              shot_type: sceneCount % 2 === 0 ? "medium shot" : "wide angle",
              mood: sceneCount % 2 === 0 ? "tense" : "mysterious",
              technical: sceneCount % 2 === 0 ? "35mm f/2.8" : "24mm f/4",
            },
          });

          currentTime += sceneInterval;
          sceneCount++;
        }

        return scenes;
      })(),
    },
  });
}

export {
  graphScenes,
};
