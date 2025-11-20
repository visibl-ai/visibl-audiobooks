/* eslint-disable camelcase */

import {
  getChapterDuration,
  getChapterLengths,
  getAuthorAndTitleFromSku,
  scenesCreateDefaultCatalogue,
} from "../../util/graphHelper.js";

import {
  composeSceneImages,
} from "./logic/composeSceneImages.js";

import {
  getTranscriptions,
  storeGraph,
  getGraph,
  getPublicLink,
} from "../../storage/storage.js";

import {
  storeGraphCharactersRtdb,
  storeGraphLocationsRtdb,
} from "../../storage/realtimeDb/graph.js";

import {
  sanitizeFirebaseKey,
} from "../../storage/utils.js";

import {
  // storeSceneInCacheFromMemory,
  storeChapterSceneInCache,
} from "../../storage/realtimeDb/scenesCache.js";

import {
  createSceneTimeIndex,
} from "../../storage/realtimeDb/scenesTimeline.js";

import {
  queueAddEntries,
} from "../../storage/firestore/queue.js";

import {
  wavespeedQueueToUnique,
} from "../../ai/queue/wavespeedQueue.js";

import {
  correctTranscriptions,
} from "../../ai/transcribe/transcriber.js";

import {
  dispatchTask,
} from "../../util/dispatch.js";

import logger from "../../util/logger.js";
import {createAnalyticsOptions} from "../../analytics/index.js";

import graphPrompts from "./graphV0_1Prompts.js";
import {OpenRouterClient, OpenRouterMockResponse} from "../../ai/openrouter/base.js";

const CHUNK_SIZE = 25; // Number of transcription segments per chunk
const MIN_CHAPTER_DURATION = 30; // Minimum chapter duration in seconds

/**
 * Chunks transcriptions into smaller segments for processing
 * @param {Array} transcriptions - Array of transcription objects with text and startTime
 * @param {number} chunkSize - Number of segments per chunk
 * @return {Array<Array>} Array of transcription chunks
 */
function chunkTranscriptions({transcriptions, chunkSize = CHUNK_SIZE}) {
  const chunks = [];
  for (let i = 0; i < transcriptions.length; i += chunkSize) {
    chunks.push(transcriptions.slice(i, i + chunkSize));
  }
  return chunks;
}

/**
 * Converts transcription array to text string
 * @param {Array} transcriptions - Array of transcription objects
 * @return {string} Combined text from all transcriptions
 */
function transcriptionsToText(transcriptions) {
  return transcriptions.map((t) => t.text).join(" ");
}

/**
 * Consolidates a list of character names by grouping aliases
 * @param {Array<string>} characterNames - Raw list of character names
 * @param {string} chapterText - Full text of the chapter
 * @param {Object} metadata - Book metadata (title, author)
 * @param {string} uid - User ID for analytics
 * @param {string} graphId - Graph ID for analytics
 * @param {string} sku - Book SKU for analytics
 * @return {Promise<Array<Object>>} Array of consolidated characters with name and aliases
 */
async function consolidateCharacters({characterNames, chapterText, replacements, uid, graphId, sku}) {
  const openRouterClient = new OpenRouterClient();
  // TODO: reduce thinking if we fail (from medium to low)
  const result = await openRouterClient.sendRequest({
    promptOverride: graphPrompts["v0_1_consolidate_characters"],
    modelOverride: graphPrompts["v0_1_consolidate_characters"].openRouterModel,
    message: chapterText,
    replacements: [
      {
        key: "NOVEL_TITLE",
        value: replacements.title || "Unknown",
      },
      {
        key: "AUTHOR",
        value: replacements.author || "Unknown",
      },
      {
        key: "CHARACTER_LIST",
        value: JSON.stringify(characterNames, null, 2),
      },
    ],
    mockResponse: new OpenRouterMockResponse({
      content: {
        characters: characterNames.slice(0, 5).map((name, index) => ({
          name: name,
          aliases: index === 0 ? [`mockalias${Math.floor(Math.random() * 90) + 10}`, `mockalias${Math.floor(Math.random() * 90) + 10}`] : [],
        })),
      },
    }),
    analyticsOptions: createAnalyticsOptions({uid, graphId, sku, promptId: "v0_1_consolidate_characters"}),
  });
  if (result.error) {
    throw new Error(`Error consolidating characters: ${result.error}`);
  }

  if (result.result && result.result.characters) {
    return result.result.characters;
  } else {
    throw new Error(`No characters found in result`);
  }
}

/**
 * Consolidates a list of location names by grouping aliases
 * @param {Array<string>} locationNames - Raw list of location names
 * @param {string} chapterText - Full text of the chapter
 * @param {Object} replacements - Book metadata (title, author)
 * @return {Promise<Array<Object>>} Array of consolidated locations with name and aliases
 */
async function consolidateLocations({locationNames, chapterText, replacements, uid, sku, graphId}) {
  const openRouterClient = new OpenRouterClient();


  const result = await openRouterClient.sendRequest({
    promptOverride: graphPrompts["v0_1_consolidate_locations"],
    modelOverride: graphPrompts["v0_1_consolidate_locations"].openRouterModel,
    message: chapterText,
    replacements: [
      {
        key: "NOVEL_TITLE",
        value: replacements.title || "Unknown",
      },
      {
        key: "AUTHOR",
        value: replacements.author || "Unknown",
      },
      {
        key: "LOCATION_LIST",
        value: JSON.stringify(locationNames, null, 2),
      },
    ],
    analyticsOptions: createAnalyticsOptions({uid, graphId, sku, promptId: "v0_1_consolidate_locations"}),
    mockResponse: new OpenRouterMockResponse({
      content: {
        locations: locationNames.slice(0, 5).map((name, index) => ({
          name: name,
          aliases: index === 0 ? [`mocklocalias${Math.floor(Math.random() * 90) + 10}`, `mocklocalias${Math.floor(Math.random() * 90) + 10}`] : [],
        })),
      },
    }),
  });

  if (result.error) {
    throw new Error(`Error consolidating locations: ${result.error}`);
  }

  if (result.result && result.result.locations) {
    return result.result.locations;
  } else {
    throw new Error(`No locations found in result`);
  }
}

/**
 * Correct transcriptions for a given chapter
 * @param {string} uid - User ID
 * @param {string} graphId - Graph ID
 * @param {string} sku - Book SKU
 * @param {number} chapter - Chapter number
 * @return {Promise<void>}
 */
async function correctTranscriptionsByChapter({uid, graphId, sku, chapter}) {
  await correctTranscriptions({uid, graphId, sku, chapter});
}

/**
 * Processes transcriptions in chunks to extract and update entity information
 * @param {Object} params - The parameters object
 * @param {string} params.uid - User ID
 * @param {string} params.sku - Book SKU
 * @param {string} params.visibility - Visibility setting
 * @param {string} params.graphId - Graph ID
 * @param {number} params.chapter - Chapter number
 * @return {Object} Updated entities object with new/modified character information
 */
async function graphCharactersByChapter(params) {
  let {uid, sku, visibility, graphId, chapter} = params;
  if (!chapter) {
    // first chapter.
    chapter = 0;
  }
  // Get author and title from SKU
  const {author, title} = await getAuthorAndTitleFromSku(sku);

  // 1. load transcriptions.
  const transcriptions = await getTranscriptions({uid, sku, visibility});

  // Process each chapter
  const numChapters = Object.keys(transcriptions).length; // TODO: Should we use the value in the catalogue?

  logger.debug(`${graphId} Processing characters for chapter ${chapter} of ${numChapters}`);

  // Get transcriptions for this chapter
  const chapterTranscriptions = transcriptions[chapter];

  const openRouterClient = new OpenRouterClient();
  const duration = getChapterDuration(chapterTranscriptions);

  if (duration < MIN_CHAPTER_DURATION) {
    logger.info(`${graphId} Chapter ${chapter} duration ${duration}s is less than ${MIN_CHAPTER_DURATION}s - returning empty character list`);
    const emptyResult = {characters: []};
    await storeGraph({
      uid,
      sku,
      visibility,
      data: emptyResult,
      type: "characters",
      chapter,
      graphId,
    });
    return;
  }

  // Chunk the transcriptions
  const chunks = chunkTranscriptions({
    transcriptions: chapterTranscriptions,
    chunkSize: 35,
  });
  logger.debug(`${graphId} Chapter ${chapter} split into ${chunks.length} chunks`);

  // Create promises for all chunks to process in parallel
  const chunkPromises = chunks.map(async (chunk, i) => {
    const chunkText = transcriptionsToText(chunk);
    logger.debug(`${graphId} Processing chunk ${i + 1} of ${chunks.length} for chapter ${chapter}`);


    const result = await openRouterClient.sendRequest({
      promptOverride: graphPrompts["v0_1_get_characters_chunk"],
      // modelOverride: "deepseek/deepseek-chat-v3-0324",
      message: chunkText,
      replacements: [{
        key: "NOVEL_TITLE",
        value: title,
      }, {
        key: "AUTHOR",
        value: author,
      }],
      mockResponse: new OpenRouterMockResponse({
        content: {
          characters: [
            `mockcharacter (01)`, // Test for parentheses and spaces
            `mockcharacter02`,
            `mockcharacter03`,
            `mockcharacter04`,
            `mockcharacter05`,
            `mockcharacter05`,
          ],
        },
      }),
      analyticsOptions: createAnalyticsOptions({uid, graphId, sku, promptId: "v0_1_get_characters_chunk"}),
    });

    // We don't throw here because we are chunking, and can hopefully still have a
    // reasonably constructed graph if we miss a chunk here and there.
    // if (result.error) {
    //   throw new Error(`OpenRouter API error: ${result.error} - ${result.details || "Unknown error"}`);
    // }

    if (result.result && result.result.characters) {
      // Return the character names for this chunk, sanitized for Firebase
      return result.result.characters
          .filter((name) => name && name.trim())
          .map((name) => sanitizeFirebaseKey({key: name}));
    }
    logger.warn(`${graphId} ${chapter} No characters found for chunk ${i + 1} of ${chunks.length}`);
    return []; // do we need this for empty chapters?
  });

  // Wait for all chunks to be processed
  const chunkResults = await Promise.all(chunkPromises);

  // Flatten all results into a single array
  const allCharacterNames = chunkResults.flat();

  // Basic deduplication - remove exact string matches
  const seen = new Set();
  const dedupedCharacterNames = [];

  for (const name of allCharacterNames) {
    if (!seen.has(name)) {
      seen.add(name);
      dedupedCharacterNames.push(name);
    }
  }

  // Filter out common pronouns
  const pronouns = new Set(["he", "her", "him", "she", "they", "i"]);
  const filteredCharacterNames = dedupedCharacterNames.filter((name) => !pronouns.has(name));

  logger.debug(`${graphId} Found ${filteredCharacterNames.length} unique character names in chapter ${chapter} after filtering pronouns (${dedupedCharacterNames.length} before filtering, ${allCharacterNames.length} total before dedup)`);

  // Save the deduplicated list for comparison
  await storeGraph({
    uid,
    sku,
    visibility,
    data: {characters: filteredCharacterNames},
    type: "characters-dedup",
    chapter,
    graphId,
  });

  // Get full chapter text for consolidation
  const chapterText = transcriptionsToText(chapterTranscriptions);

  // Consolidate characters using reasoning model
  const consolidatedCharacters = await consolidateCharacters({
    characterNames: filteredCharacterNames,
    chapterText: chapterText,
    replacements: {
      title: title,
      author: author,
    },
    uid,
    graphId,
    sku,
  });

  // Post-process to merge duplicates and validate all characters are present
  const mergedCharacters = [];
  const nameToIndex = new Map();

  // First pass: merge duplicates
  for (const char of consolidatedCharacters) {
    const lowerName = char.name.toLowerCase();

    if (nameToIndex.has(lowerName)) {
      // Merge aliases into existing entry
      const existingIndex = nameToIndex.get(lowerName);
      const existingAliases = new Set(mergedCharacters[existingIndex].aliases.map((a) => a.toLowerCase()));

      // Add new aliases that don't already exist
      for (const alias of char.aliases) {
        if (!existingAliases.has(alias.toLowerCase())) {
          mergedCharacters[existingIndex].aliases.push(alias);
        }
      }
    } else {
      // New character entry
      nameToIndex.set(lowerName, mergedCharacters.length);
      mergedCharacters.push({
        name: char.name,
        aliases: [...char.aliases],
      });
    }
  }

  // Second pass: ensure all input characters are present
  const consolidatedNames = new Set();
  mergedCharacters.forEach((char) => {
    consolidatedNames.add(char.name.toLowerCase());
    char.aliases.forEach((alias) => consolidatedNames.add(alias.toLowerCase()));
  });

  // Add any missing characters
  for (const name of filteredCharacterNames) {
    if (!consolidatedNames.has(name.toLowerCase())) {
      logger.warn(`${graphId} Character "${name}" was missing from consolidation, adding as standalone`);
      mergedCharacters.push({
        name: name,
        aliases: [name],
      });
    }
  }

  // Create character list with consolidated names and aliases, all lowercase
  const charactersList = {
    characters: mergedCharacters.map((char) => ({
      name: char.name.toLowerCase(),
      aliases: char.aliases.map((alias) => alias.toLowerCase()),
    })),
  };

  logger.debug(`${graphId} Consolidated to ${mergedCharacters.length} unique characters with aliases`);

  // Store consolidated results
  await storeGraph({
    uid,
    sku,
    visibility,
    data: charactersList,
    type: "characters",
    chapter,
    graphId,
  });
}

/**
 * Processes transcriptions in chunks to extract location information
 * @param {Object} params - The parameters object
 * @param {string} params.uid - User ID
 * @param {string} params.sku - Book SKU
 * @param {string} params.visibility - Visibility setting
 * @param {string} params.graphId - Graph ID
 * @param {number} params.chapter - Chapter number
 * @return {Object} Location information for the chapter
 */
async function graphLocationsByChapter(params) {
  let {uid, sku, visibility, graphId, chapter} = params;
  if (!chapter) {
    // first chapter.
    chapter = 0;
  }
  // Get author and title from SKU
  const {author, title} = await getAuthorAndTitleFromSku(sku);

  // 1. load transcriptions.
  const transcriptions = await getTranscriptions({uid, sku, visibility});

  // Process each chapter
  const numChapters = Object.keys(transcriptions).length;

  logger.debug(`${graphId} Processing locations for chapter ${chapter} of ${numChapters}`);

  // Get transcriptions for this chapter
  const chapterTranscriptions = transcriptions[chapter];

  const openRouterClient = new OpenRouterClient();
  const duration = getChapterDuration(chapterTranscriptions);

  if (duration < MIN_CHAPTER_DURATION) {
    logger.info(`${graphId} Chapter ${chapter} duration ${duration}s is less than ${MIN_CHAPTER_DURATION}s - returning empty location list`);
    const emptyResult = {locations: []};
    await storeGraph({
      uid,
      sku,
      visibility,
      data: emptyResult,
      type: "locations",
      chapter,
      graphId,
    });
    return;
  }

  // Chunk the transcriptions
  const chunks = chunkTranscriptions({transcriptions: chapterTranscriptions});
  logger.debug(`${graphId} Chapter ${chapter} split into ${chunks.length} chunks`);

  // Create promises for all chunks to process in parallel
  const chunkPromises = chunks.map(async (chunk, i) => {
    const chunkText = transcriptionsToText(chunk);
    logger.debug(`${graphId} Processing chunk ${i + 1} of ${chunks.length} for chapter ${chapter}`);


    const result = await openRouterClient.sendRequest({
      promptOverride: graphPrompts["v0_1_get_locations_chunk"],
      modelOverride: "deepseek/deepseek-chat-v3-0324",
      message: chunkText,
      replacements: [{
        key: "NOVEL_TITLE",
        value: title,
      }, {
        key: "AUTHOR",
        value: author,
      }],
      mockResponse: new OpenRouterMockResponse({
        content: {
          locations: [
            `mocklocation01`,
            `mocklocation02`,
            `mocklocation03`,
            `mocklocation04`,
            `mocklocation05`,
            `mocklocation05`,
          ],
        },
      }),
      analyticsOptions: createAnalyticsOptions({uid, graphId, sku, promptId: "v0_1_get_locations_chunk"}),
    });

    // Check for API errors and throw if present
    // We don't throw here because we are chunking, and can hopefully still have a
    // reasonably constructed graph if we miss a chunk here and there.
    // if (result.error) {
    //   throw new Error(`OpenRouter API error: ${result.error} - ${result.details || "Unknown error"}`);
    // }

    if (result.result && result.result.locations) {
      // Return the location names for this chunk, sanitized for Firebase
      return result.result.locations
          .filter((name) => name && name.trim())
          .map((name) => sanitizeFirebaseKey({key: name}));
    }
    logger.warn(`${graphId} ${chapter} No characters found for chunk ${i + 1} of ${chunks.length}`);
    return []; // do we need this for empty chapters?
  });

  // Wait for all chunks to be processed
  const chunkResults = await Promise.all(chunkPromises);

  // Flatten all results into a single array
  const allLocationNames = chunkResults.flat();

  // Basic deduplication - remove exact string matches
  const seen = new Set();
  const dedupedLocationNames = [];

  for (const name of allLocationNames) {
    if (!seen.has(name)) {
      seen.add(name);
      dedupedLocationNames.push(name);
    }
  }

  // Filter out common generic terms
  const genericTerms = new Set(["there", "here", "place", "area", "somewhere"]);
  const filteredLocationNames = dedupedLocationNames.filter((name) => !genericTerms.has(name));

  logger.debug(`${graphId} Found ${filteredLocationNames.length} unique location names in chapter ${chapter} after filtering generic terms (${dedupedLocationNames.length} before filtering, ${allLocationNames.length} total before dedup)`);

  // Save the deduplicated list for comparison
  await storeGraph({
    uid,
    sku,
    visibility,
    data: {locations: filteredLocationNames},
    type: "locations-dedup",
    chapter,
    graphId,
  });

  // Get full chapter text for consolidation
  const chapterText = transcriptionsToText(chapterTranscriptions);

  // Consolidate locations using reasoning model
  const consolidatedLocations = await consolidateLocations({
    locationNames: filteredLocationNames,
    chapterText: chapterText,
    replacements: {
      title: title,
      author: author,
    },
    uid: uid,
    sku: sku,
    graphId: graphId,
  });
  // Create location list with consolidated names and aliases, all lowercase
  const locationsList = {
    locations: consolidatedLocations.map((loc) => ({
      name: loc.name.toLowerCase(),
      aliases: loc.aliases.map((alias) => alias.toLowerCase()),
    })),
  };

  logger.debug(`Consolidated to ${consolidatedLocations.length} unique locations with aliases`);

  // Store consolidated results
  await storeGraph({
    uid,
    sku,
    visibility,
    data: locationsList,
    type: "locations",
    chapter,
    graphId,
  });
}

/**
 * Extracts character properties from a chapter's transcriptions
 * @param {Object} params - The parameters object
 * @param {string} params.uid - User ID
 * @param {string} params.sku - Book SKU
 * @param {string} params.visibility - Visibility setting
 * @param {string} params.graphId - Graph ID
 * @param {number} params.chapter - Chapter number
 * @return {Object} Character properties for the chapter
 */
async function graphCharacterPropertiesByChapter(params) {
  const {uid, sku, visibility, graphId, chapter} = params;

  logger.debug(`${graphId} Processing character properties for chapter ${chapter}`);

  // Get author and title from SKU
  const {author, title} = await getAuthorAndTitleFromSku(sku);
  // 1. Load the consolidated characters for this chapter
  let consolidatedCharacters;
  try {
    consolidatedCharacters = await getGraph({
      uid,
      sku,
      visibility,
      type: "characters",
      chapter,
      graphId,
    });
  } catch (error) {
    logger.error(`${graphId} Error loading characters for chapter ${chapter}: ${error.message}`);
    // If no characters file, return empty properties
    await storeGraph({
      uid,
      sku,
      visibility,
      data: {properties: []},
      type: "characterProperties",
      chapter,
      graphId,
    });
    return;
  }

  // 2. Load transcriptions for this chapter
  const transcriptions = await getTranscriptions({uid, sku, visibility});
  const chapterTranscriptions = transcriptions[chapter];

  const duration = getChapterDuration(chapterTranscriptions);
  if (duration < MIN_CHAPTER_DURATION) {
    logger.info(`${graphId} Chapter ${chapter} duration ${duration}s is less than ${MIN_CHAPTER_DURATION}s - returning empty properties list`);
    await storeGraph({
      uid,
      sku,
      visibility,
      data: {properties: []},
      type: "characterProperties",
      chapter,
      graphId,
    });
    return;
  }

  // 3. Convert all transcriptions to text once (no chunking)
  const fullChapterText = transcriptionsToText(chapterTranscriptions);
  logger.debug(`${graphId} Processing full chapter ${chapter} text for character properties (${chapterTranscriptions.length} segments)`);

  const openRouterClient = new OpenRouterClient();

  // 4. Process each character individually with the full chapter text
  const characterPromises = consolidatedCharacters.characters.map(async (character, i) => {
    const characterName = character.name;
    const characterAliases = character.aliases.length > 0 ? character.aliases.join(", ") : "None";

    logger.debug(`${graphId} Processing properties for character ${i + 1}/${consolidatedCharacters.characters.length}: ${characterName} in chapter ${chapter}`);

    const result = await openRouterClient.sendRequest({
      promptOverride: graphPrompts["v0_1_character_properties_single"],
      modelOverride: graphPrompts["v0_1_character_properties_single"].openRouterModel,
      message: fullChapterText,
      replacements: [
        {
          key: "NOVEL_TITLE",
          value: title,
        },
        {
          key: "AUTHOR",
          value: author,
        },
        {
          key: "CHARACTER_NAME",
          value: characterName,
        },
        {
          key: "CHARACTER_ALIASES",
          value: characterAliases,
        },
      ],
      analyticsOptions: createAnalyticsOptions({uid, graphId, sku, promptId: "v0_1_character_properties_single"}),
      mockResponse: new OpenRouterMockResponse({
        content: {
          properties: [
            {
              character: characterName.toLowerCase(),
              relationship: "has",
              property: "blue eyes",
            },
            {
              character: characterName.toLowerCase(),
              relationship: "wears",
              property: "red jacket",
            },
          ],
        },
      }),
    });

    // We throw as this is pretty critical to the graph.
    if (result.error) {
      logger.warn(`${graphId} ${chapter} LLM Error processing properties for character; returning empty list for ${characterName}: ${result.error}`);
      return [];
    }

    if (result.result && result.result.properties) {
      // Ensure all properties use the correct character name (lowercase)
      return result.result.properties.map((prop) => ({
        ...prop,
        character: characterName.toLowerCase(),
      }));
    } else {
      logger.warn(`${graphId} ${chapter} No properties found for character, returning empty list for ${characterName}`);
      return [];
    }
  });

  // 5. Wait for all characters to be processed
  const characterResults = await Promise.all(characterPromises);

  // 6. Flatten and deduplicate properties
  const allProperties = characterResults.flat();

  // Simple deduplication based on exact matches
  const uniqueProperties = [];
  const seen = new Set();

  for (const prop of allProperties) {
    const key = `${prop.character}-${prop.relationship}-${prop.property}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniqueProperties.push(prop);
    }
  }

  logger.debug(`${graphId} Found ${uniqueProperties.length} unique character properties in chapter ${chapter} (${allProperties.length} total before dedup) from ${consolidatedCharacters.characters.length} characters`);

  // Check for properties referencing characters not in the main list
  logger.debug(`${graphId} Checking character property references for chapter ${chapter}`);

  // Only use main character names, not aliases
  const validMainCharacterNames = new Set();
  consolidatedCharacters.characters.forEach((char) => {
    validMainCharacterNames.add(char.name.toLowerCase());
  });

  logger.debug(`${graphId} Valid main character names (${validMainCharacterNames.size} total): ${Array.from(validMainCharacterNames).join(", ")}`);

  // Filter out properties for characters not in the main list
  const validProperties = [];
  const invalidCharacterReferences = new Map();

  uniqueProperties.forEach((prop) => {
    const charName = prop.character.toLowerCase();
    if (validMainCharacterNames.has(charName)) {
      validProperties.push(prop);
    } else {
      if (!invalidCharacterReferences.has(charName)) {
        invalidCharacterReferences.set(charName, 0);
      }
      invalidCharacterReferences.set(charName, invalidCharacterReferences.get(charName) + 1);
    }
  });

  if (invalidCharacterReferences.size > 0) {
    const invalidChars = Array.from(invalidCharacterReferences.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([char, count]) => `${char} (${count} properties)`)
        .join(", ");
    logger.warn(`${graphId} Chapter ${chapter}: Filtered out ${invalidCharacterReferences.size} characters not in main list with properties: ${invalidChars}`);
  }

  logger.info(`${graphId} Chapter ${chapter}: Storing ${validProperties.length} valid character properties (filtered from ${uniqueProperties.length} total)`);

  // 8. Store the properties
  const propertiesData = {
    properties: validProperties,
  };

  await storeGraph({
    uid,
    sku,
    visibility,
    data: propertiesData,
    type: "characterProperties",
    chapter,
    graphId,
  });
}

/**
 * Extracts location properties from a chapter's transcriptions
 * @param {Object} params - The parameters object
 * @param {string} params.uid - User ID
 * @param {string} params.sku - Book SKU
 * @param {string} params.visibility - Visibility setting
 * @param {string} params.graphId - Graph ID
 * @param {number} params.chapter - Chapter number
 * @return {Object} Location properties for the chapter
 */
async function graphLocationPropertiesByChapter(params) {
  const {uid, sku, visibility, graphId, chapter} = params;

  logger.debug(`Processing location properties for chapter ${chapter}`);

  // Get author and title from SKU
  const {author, title} = await getAuthorAndTitleFromSku(sku);
  // 1. Load the consolidated locations for this chapter
  let consolidatedLocations;
  try {
    consolidatedLocations = await getGraph({
      uid,
      sku,
      visibility,
      type: "locations",
      chapter,
      graphId,
    });
  } catch (error) {
    logger.error(`${graphId} Error loading locations for chapter ${chapter}: ${error.message}`);
    // If no locations file, return empty properties
    await storeGraph({
      uid,
      sku,
      visibility,
      data: {properties: []},
      type: "locationProperties",
      chapter,
      graphId,
    });
    return;
  }

  // 2. Load transcriptions for this chapter
  const transcriptions = await getTranscriptions({uid, sku, visibility});
  const chapterTranscriptions = transcriptions[chapter];

  const duration = getChapterDuration(chapterTranscriptions);
  if (duration < MIN_CHAPTER_DURATION) {
    logger.info(`Chapter ${chapter} duration ${duration}s is less than ${MIN_CHAPTER_DURATION}s - returning empty properties list`);
    await storeGraph({
      uid,
      sku,
      visibility,
      data: {properties: []},
      type: "locationProperties",
      chapter,
      graphId,
    });
    return;
  }

  // 3. Convert all transcriptions to text once (no chunking)
  const fullChapterText = transcriptionsToText(chapterTranscriptions);
  logger.debug(`${graphId} Processing full chapter ${chapter} text for location properties (${chapterTranscriptions.length} segments)`);

  const openRouterClient = new OpenRouterClient();

  // 4. Process each location individually with the full chapter text
  const locationPromises = consolidatedLocations.locations.map(async (location, i) => {
    const locationName = location.name;
    const locationAliases = location.aliases.length > 0 ? location.aliases.join(", ") : "None";

    logger.debug(`${graphId} Processing properties for location ${i + 1}/${consolidatedLocations.locations.length}: ${locationName} in chapter ${chapter}`);

    const result = await openRouterClient.sendRequest({
      promptOverride: graphPrompts["v0_1_location_properties_single"],
      modelOverride: graphPrompts["v0_1_location_properties_single"].openRouterModel,
      message: fullChapterText,
      replacements: [
        {
          key: "NOVEL_TITLE",
          value: title,
        },
        {
          key: "AUTHOR",
          value: author,
        },
        {
          key: "LOCATION_NAME",
          value: locationName,
        },
        {
          key: "LOCATION_ALIASES",
          value: locationAliases,
        },
      ],
      mockResponse: new OpenRouterMockResponse({
        content: {
          properties: [
            {
              location: locationName.toLowerCase(),
              relationship: "atmosphere",
              property: "dim lighting",
            },
            {
              location: locationName.toLowerCase(),
              relationship: "interior",
              property: "polished counter",
            },
          ],
        },
      }),
      analyticsOptions: createAnalyticsOptions({uid, graphId, sku, promptId: "v0_1_location_properties_single"}),
    });

    // Moe to fix - don't throw, log a big warning but we need to move on.
    if (result.error) {
      logger.warn(`${graphId} ${chapter} LLM Error processing properties for location; returning empty list for ${locationName}: ${result.error}`);
      return [];
    }

    if (result.result && result.result.properties) {
      // Ensure all properties use the correct location name (lowercase)
      return result.result.properties.map((prop) => ({
        ...prop,
        location: locationName.toLowerCase(),
      }));
    } else {
      logger.warn(`${graphId} ${chapter} No properties found for location, returning empty list for ${locationName}`);
      return [];
    }
  });

  // 5. Wait for all locations to be processed
  const locationResults = await Promise.all(locationPromises);

  // 6. Flatten and deduplicate properties
  const allProperties = locationResults.flat();

  // Simple deduplication based on exact matches
  const uniqueProperties = [];
  const seen = new Set();

  for (const prop of allProperties) {
    const key = `${prop.location}-${prop.relationship}-${prop.property}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniqueProperties.push(prop);
    }
  }

  logger.debug(`${graphId} Found ${uniqueProperties.length} unique location properties in chapter ${chapter} (${allProperties.length} total before dedup) from ${consolidatedLocations.locations.length} locations`);

  // Check for properties referencing locations not in the main list
  logger.debug(`${graphId} Checking location property references for chapter ${chapter}`);

  // Only use main location names, not aliases
  const validMainLocationNames = new Set();
  consolidatedLocations.locations.forEach((loc) => {
    validMainLocationNames.add(loc.name.toLowerCase());
  });

  logger.debug(`${graphId} Valid main location names (${validMainLocationNames.size} total): ${Array.from(validMainLocationNames).join(", ")}`);

  // Filter out properties for locations not in the main list
  const validProperties = [];
  const invalidLocationReferences = new Map();

  uniqueProperties.forEach((prop) => {
    const locName = prop.location.toLowerCase();
    if (validMainLocationNames.has(locName)) {
      validProperties.push(prop);
    } else {
      if (!invalidLocationReferences.has(locName)) {
        invalidLocationReferences.set(locName, 0);
      }
      invalidLocationReferences.set(locName, invalidLocationReferences.get(locName) + 1);
    }
  });

  if (invalidLocationReferences.size > 0) {
    const invalidLocs = Array.from(invalidLocationReferences.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([loc, count]) => `${loc} (${count} properties)`)
        .join(", ");
    logger.warn(`${graphId} Chapter ${chapter}: Filtered out ${invalidLocationReferences.size} locations not in main list with properties: ${invalidLocs}`);
  }

  logger.info(`${graphId} Chapter ${chapter}: Storing ${validProperties.length} valid location properties (filtered from ${uniqueProperties.length} total)`);

  // 8. Store the properties
  const propertiesData = {
    properties: validProperties,
  };

  await storeGraph({
    uid,
    sku,
    visibility,
    data: propertiesData,
    type: "locationProperties",
    chapter,
    graphId,
  });
}

/**
 * Generates image prompts for characters in a specific chapter
 * @param {Object} params - The parameters object
 * @param {string} params.uid - User ID
 * @param {string} params.sku - Book SKU
 * @param {string} params.visibility - Visibility setting
 * @param {string} params.graphId - Graph ID
 * @param {number} params.chapter - Chapter number
 * @return {Object} Character image prompts for the chapter
 */
async function generateCharacterImagePrompts(params) {
  const {uid, sku, visibility, graphId, chapter} = params;

  logger.debug(`${graphId} Generating character image prompts for chapter ${chapter}`);

  // Get author and title from SKU
  const {author, title} = await getAuthorAndTitleFromSku(sku);

  // 1. Load character properties for this chapter
  let chapterProperties;
  try {
    chapterProperties = await getGraph({
      uid,
      sku,
      visibility,
      type: "characterProperties-continuity",
      chapter,
      graphId,
    });
  } catch (error) {
    logger.debug(`${graphId} No properties file for chapter ${chapter}: ${error.message}`);
    // If no properties file, store empty result
    await storeGraph({
      uid,
      sku,
      visibility,
      data: {characterPrompts: []},
      type: "characterImagePrompts",
      chapter,
      graphId,
    });
    return;
  }

  // 2. Check if there are any properties
  if (!chapterProperties.properties || chapterProperties.properties.length === 0) {
    logger.debug(`${graphId} No character properties found for chapter ${chapter}`);
    await storeGraph({
      uid,
      sku,
      visibility,
      data: {characterPrompts: []},
      type: "characterImagePrompts",
      chapter,
      graphId,
    });
    return;
  }

  // 3. Group properties by character
  const characterProperties = new Map();
  for (const prop of chapterProperties.properties) {
    const charName = prop.character.toLowerCase();
    if (!characterProperties.has(charName)) {
      characterProperties.set(charName, []);
    }
    characterProperties.get(charName).push({
      relationship: prop.relationship,
      property: prop.property,
    });
  }

  logger.debug(`${graphId} Processing image prompts for ${characterProperties.size} characters in chapter ${chapter}`);

  const openRouterClient = new OpenRouterClient();

  // 4. Generate image prompts for all characters in parallel
  const promptPromises = Array.from(characterProperties.entries()).map(async ([charName, properties]) => {
    // Format properties as simple text list
    const propertiesText = properties
        .map((prop) => `- ${prop.relationship}: ${prop.property}`)
        .join("\n");

    const message = `Character: ${charName}\n\nPhysical properties:\n${propertiesText}\n\nPlease create a vivid, detailed description of this character's appearance.`;

    logger.debug(`${graphId} Generating image prompt for ${charName} with ${properties.length} properties`);

    const result = await openRouterClient.sendRequest({
      promptOverride: graphPrompts["v0_1_character_image_prompt"],
      modelOverride: graphPrompts["v0_1_character_image_prompt"].openRouterModel,
      message: message,
      replacements: [
        {
          key: "NOVEL_TITLE",
          value: title,
        },
        {
          key: "AUTHOR",
          value: author,
        },
      ],
      mockResponse: new OpenRouterMockResponse({
        content: {
          character: charName,
          description: `Mock image description for ${charName}: A detailed portrait showing distinctive features including ${properties.length > 0 ? properties[0].property : "unique characteristics"}.`,
        },
      }),
      analyticsOptions: createAnalyticsOptions({uid, graphId, sku, promptId: "v0_1_character_image_prompt"}),
    });

    // We throw as this is pretty critical to the graph.
    if (result.error) {
      throw new Error(`${graphId} ${chapter} Error generating image prompt for ${charName}: ${result.error}`);
    }

    if (result.result && result.result.description) {
      logger.debug(`${graphId} Generated prompt for ${charName}: ${result.result.description.substring(0, 100)}...`);
      return {
        character: charName,
        description: result.result.description,
      };
    } else {
      throw new Error(`${graphId} ${chapter} No description found for character ${charName}`);
    }
  });

  // Wait for all prompts to be generated
  const results = await Promise.all(promptPromises);

  // Filter out null results (failed generations)
  const characterPrompts = results.filter((prompt) => prompt !== null);

  logger.info(`${graphId} Generated ${characterPrompts.length} character image prompts for chapter ${chapter}`);

  // 5. Store the generated prompts for this chapter
  const promptsData = {
    characterPrompts: characterPrompts,
  };

  await storeGraph({
    uid,
    sku,
    visibility,
    data: promptsData,
    type: "characterImagePrompts",
    chapter,
    graphId,
  });
}

/**
 * Generates image prompts for locations in a specific chapter
 * @param {Object} params - The parameters object
 * @param {string} params.uid - User ID
 * @param {string} params.sku - Book SKU
 * @param {string} params.visibility - Visibility setting
 * @param {string} params.graphId - Graph ID
 * @param {number} params.chapter - Chapter number
 * @return {Object} Location image prompts for the chapter
 */
async function generateLocationImagePrompts(params) {
  const {uid, sku, visibility, graphId, chapter} = params;

  logger.debug(`${graphId} Generating location image prompts for chapter ${chapter}`);

  // Get author and title from SKU
  const {author, title} = await getAuthorAndTitleFromSku(sku);

  // 1. Load location properties for this chapter
  let chapterProperties;
  try {
    chapterProperties = await getGraph({
      uid,
      sku,
      visibility,
      type: "locationProperties-continuity",
      chapter,
      graphId,
    });
  } catch (error) {
    logger.debug(`${graphId} No properties file for chapter ${chapter}: ${error.message}`);
    // If no properties file, store empty result
    await storeGraph({
      uid,
      sku,
      visibility,
      data: {locationPrompts: []},
      type: "locationImagePrompts",
      chapter,
      graphId,
    });
    return;
  }

  // 2. Check if there are any properties
  if (!chapterProperties.properties || chapterProperties.properties.length === 0) {
    logger.debug(`${graphId} No location properties found for chapter ${chapter}`);
    await storeGraph({
      uid,
      sku,
      visibility,
      data: {locationPrompts: []},
      type: "locationImagePrompts",
      chapter,
      graphId,
    });
    return;
  }

  // 3. Group properties by location
  const locationProperties = new Map();
  for (const prop of chapterProperties.properties) {
    const locName = prop.location.toLowerCase();
    if (!locationProperties.has(locName)) {
      locationProperties.set(locName, []);
    }
    locationProperties.get(locName).push({
      relationship: prop.relationship,
      property: prop.property,
    });
  }

  logger.debug(`${graphId} Processing image prompts for ${locationProperties.size} locations in chapter ${chapter}`);

  const openRouterClient = new OpenRouterClient();

  // 4. Generate image prompts for all locations in parallel
  const promptPromises = Array.from(locationProperties.entries()).map(async ([locName, properties]) => {
    // Format properties as simple text list
    const propertiesText = properties
        .map((prop) => `- ${prop.relationship}: ${prop.property}`)
        .join("\n");

    const message = `Location: ${locName}\n\nDescriptive properties:\n${propertiesText}\n\nPlease create a vivid, detailed description of this location's appearance.`;

    logger.debug(`${graphId} Generating image prompt for ${locName} with ${properties.length} properties`);


    const result = await openRouterClient.sendRequest({
      promptOverride: graphPrompts["v0_1_location_image_prompt"],
      modelOverride: graphPrompts["v0_1_location_image_prompt"].openRouterModel,
      message: message,
      replacements: [
        {
          key: "NOVEL_TITLE",
          value: title,
        },
        {
          key: "AUTHOR",
          value: author,
        },
      ],
      mockResponse: new OpenRouterMockResponse({
        content: {
          location: locName,
          description: `Mock image description for ${locName}: A sweeping vista featuring ${properties.length > 0 ? properties[0].property : "distinctive landmarks"}.`,
        },
      }),
      analyticsOptions: createAnalyticsOptions({uid, graphId, sku, promptId: "v0_1_location_image_prompt"}),
    });

    // We throw as this is pretty critical to the graph.
    if (result.error) {
      throw new Error(`${graphId} ${chapter} Error generating image prompt for ${locName}: ${result.error}`);
    }

    if (result.result && result.result.description) {
      logger.debug(`${graphId} Generated prompt for ${locName}: ${result.result.description.substring(0, 100)}...`);
      return {
        location: locName,
        description: result.result.description,
      };
    } else {
      throw new Error(`${graphId} ${chapter} No description found for location ${locName}`);
    }
  });

  // Wait for all prompts to be generated
  const results = await Promise.all(promptPromises);

  // Filter out null results (failed generations)
  const locationPrompts = results.filter((prompt) => prompt !== null);

  logger.info(`${graphId} Generated ${locationPrompts.length} location image prompts for chapter ${chapter}`);

  // 5. Store the generated prompts for this chapter
  const promptsData = {
    locationPrompts: locationPrompts,
  };

  await storeGraph({
    uid,
    sku,
    visibility,
    data: promptsData,
    type: "locationImagePrompts",
    chapter,
    graphId,
  });
}

/**
 * Generates images for characters in a specific chapter using wavespeed
 * @param {Object} params - The parameters object
 * @param {string} params.uid - User ID
 * @param {string} params.sku - Book SKU
 * @param {string} params.visibility - Visibility setting
 * @param {string} params.graphId - Graph ID
 * @param {number} params.chapter - Chapter number
 * @return {Promise<void>}
 */
async function generateCharacterImages(params) {
  const {sku, graphId, chapter} = params;

  logger.debug(`${graphId} Generating character images for chapter ${chapter}`);

  // 1. Load referenced entities for this chapter
  let referencedEntities;
  try {
    referencedEntities = await getGraph({
      uid: params.uid,
      sku,
      visibility: params.visibility,
      type: "referenced-entities",
      chapter,
      graphId,
    });
  } catch (error) {
    logger.debug(`${graphId} No referenced entities file for chapter ${chapter}: ${error.message}`);
    return;
  }

  if (!referencedEntities || !referencedEntities.referencedCharacters || referencedEntities.referencedCharacters.length === 0) {
    logger.debug(`${graphId} No referenced characters for chapter ${chapter}, skipping image generation`);
    return;
  }

  // 2. Load character image prompts for this chapter
  let chapterPrompts;
  try {
    chapterPrompts = await getGraph({
      uid: params.uid,
      sku,
      visibility: params.visibility,
      type: "characterImagePrompts",
      chapter,
      graphId,
    });
  } catch (error) {
    logger.debug(`${graphId} No prompts file for chapter ${chapter}: ${error.message}`);
    return;
  }

  // 3. Check if there are any prompts
  if (!chapterPrompts.characterPrompts || chapterPrompts.characterPrompts.length === 0) {
    logger.debug(`${graphId} No character prompts found for chapter ${chapter}`);
    return;
  }

  // 4. Filter prompts to only include referenced characters
  const normalizeCharacterName = (name) => sanitizeFirebaseKey({key: name}).toLowerCase().replace(/\s+/g, "_");
  const referencedCharsSet = new Set(referencedEntities.referencedCharacters.map(normalizeCharacterName));
  const filteredPrompts = chapterPrompts.characterPrompts.filter((prompt) => {
    // Use the same sanitization as used when collecting referenced characters
    const normalizedName = normalizeCharacterName(prompt.character);
    return referencedCharsSet.has(normalizedName);
  });

  if (filteredPrompts.length === 0) {
    logger.debug(`${graphId} No matching character prompts after filtering for chapter ${chapter}`);
    return;
  }

  logger.info(`${graphId} Processing ${filteredPrompts.length} referenced character images for chapter ${chapter} (filtered from ${chapterPrompts.characterPrompts.length})`);

  // 5. Prepare queue entries for wavespeed
  const types = [];
  const entryTypes = [];
  const entryParams = [];
  const uniques = [];

  for (const characterPrompt of filteredPrompts) {
    const {character, description} = characterPrompt;

    // Skip if no description
    if (!description) {
      logger.warn(`${graphId} Character ${character} has no description, skipping image generation`);
      continue;
    }

    // Normalize character name for use as identifier - use same sanitization as RTDB storage
    // This ensures the key matches what's used when storing descriptions
    const normalizedIdentifier = normalizeCharacterName(character);

    // Prepare queue entry
    types.push("wavespeed");
    entryTypes.push("generate");

    // Create output path
    const outputPath = `Graphs/${graphId}/images/characters/${normalizedIdentifier}-ch${chapter}.jpeg`;

    const prompt = `Create a detailed photo style full-body character shot of: ${description}. Character only, no text or words visible in the image, high quality, professional with white background.`;

    entryParams.push({
      prompt: prompt,
      negativePrompt: "animated, incomplete, cartoon, illustration, anime, low quality, blurry, distorted",
      model: "google/imagen4-fast",
      outputPath: outputPath,
      outputFormat: "jpeg",
      modelParams: {
        aspect_ratio: "9:16",
        seed: Math.floor(Math.random() * 2 ** 32),
        enable_base64_output: true,
        enable_safety_checker: false,
        enable_sync_mode: true,
      },
      graphId,
      chapter,
      identifier: normalizedIdentifier,
      type: "character",
      sku: sku,
      uid: params.uid,
    });

    // Generate unique key for deduplication
    const uniqueKey = wavespeedQueueToUnique({
      type: "wavespeed",
      entryType: "generate",
      graphId,
      identifier: normalizedIdentifier,
      chapter,
    });
    uniques.push(uniqueKey);
  }

  // 4. Add entries to queue if any
  if (types.length > 0) {
    const queueResult = await queueAddEntries({
      types,
      entryTypes,
      entryParams,
      uniques,
    });

    if (queueResult.success) {
      logger.info(`${graphId} Queued ${types.length} character images for chapter ${chapter}`);

      // Dispatch the wavespeed queue to process the entries
      await dispatchTask({
        functionName: "launchWavespeedQueue",
        data: {},
      });
    } else {
      logger.error(`${graphId} Failed to queue character images for chapter ${chapter}`);
    }
  }
}

/**
 * Generates profile images for characters in a specific chapter using wavespeed
 * @param {Object} params - The parameters object
 * @param {string} params.uid - User ID
 * @param {string} params.sku - Book SKU
 * @param {string} params.visibility - Visibility setting
 * @param {string} params.graphId - Graph ID
 * @param {number} params.chapter - Chapter number
 * @return {Promise<void>}
 */
async function generateCharacterProfileImages(params) {
  const {uid, sku, visibility, graphId, chapter} = params;

  logger.debug(`${graphId} Generating character profile images for chapter ${chapter}`);

  // 1. Load referenced entities for this chapter
  let referencedEntities;
  try {
    referencedEntities = await getGraph({
      uid,
      sku,
      visibility,
      type: "referenced-entities",
      chapter,
      graphId,
    });
  } catch (error) {
    logger.debug(`${graphId} No referenced entities file for chapter ${chapter}: ${error.message}`);
    return;
  }

  if (!referencedEntities || !referencedEntities.referencedCharacters || referencedEntities.referencedCharacters.length === 0) {
    logger.debug(`${graphId} No referenced characters for chapter ${chapter}, skipping profile image generation`);
    return;
  }

  logger.info(`${graphId} Processing profile images for ${referencedEntities.referencedCharacters.length} referenced characters in chapter ${chapter}`);

  // 2. Prepare queue entries for wavespeed
  const types = [];
  const entryTypes = [];
  const entryParams = [];
  const uniques = [];

  for (const character of referencedEntities.referencedCharacters) {
    // Normalize character name for use as identifier - use same sanitization as RTDB storage
    // This ensures the key matches what's used when storing descriptions
    const sanitizedKey = sanitizeFirebaseKey({key: character});
    const normalizedIdentifier = sanitizedKey.toLowerCase().replace(/\s+/g, "_");

    // Check if full-body image exists and get its public URL
    const fullBodyImagePath = `Graphs/${graphId}/images/characters/${normalizedIdentifier}-ch${chapter}.jpeg`;

    // Retry logic for waiting for full-body image to be generated
    let fullBodyImageUrl = null;
    const maxRetries = 12; // 12 retries = 1 minute
    const retryDelay = 5000; // 5 seconds

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        fullBodyImageUrl = await getPublicLink({path: fullBodyImagePath});
        logger.debug(`${graphId} Full-body image URL for ${character}: ${fullBodyImageUrl}`);
        break; // Successfully got the image, exit retry loop
      } catch (error) {
        if (attempt < maxRetries) {
          logger.debug(`${graphId} Full-body image not found for ${character} (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${retryDelay}ms...`);
          await new Promise((resolve) => setTimeout(resolve, retryDelay));
        } else {
          logger.debug(`${graphId} Full-body image not found for ${character} after ${maxRetries + 1} attempts, skipping profile generation`);
        }
      }
    }

    if (fullBodyImageUrl) {
      // Prepare queue entry
      types.push("wavespeed");
      entryTypes.push("generate");

      // Create output path for profile image
      const outputPath = `Graphs/${graphId}/images/characters/${normalizedIdentifier}-ch${chapter}-profile.jpeg`;

      const prompt = "portrait image of this character's face, white background.";

      entryParams.push({
        prompt: prompt,
        model: "wavespeed-ai/flux-kontext-dev-ultra-fast",
        outputPath: outputPath,
        outputFormat: "jpeg",
        modelParams: {
          image: fullBodyImageUrl,
          aspect_ratio: "1:1",
          size: "1024*1024",
        },
        graphId,
        chapter,
        identifier: `${normalizedIdentifier}`,
        type: "character-profile",
        sku: sku,
        uid: uid,
      });

      // Generate unique key for deduplication
      const uniqueKey = wavespeedQueueToUnique({
        type: "wavespeed",
        entryType: "generate",
        graphId,
        identifier: `${normalizedIdentifier}-profile`,
        chapter,
      });
      uniques.push(uniqueKey);
    }
  }

  // 4. Add entries to queue if any
  if (types.length > 0) {
    const queueResult = await queueAddEntries({
      types,
      entryTypes,
      entryParams,
      uniques,
    });

    if (queueResult.success) {
      logger.info(`${graphId} Queued ${types.length} character profile images for chapter ${chapter}`);

      // Dispatch the wavespeed queue to process the entries
      await dispatchTask({
        functionName: "launchWavespeedQueue",
        data: {},
      });
    } else {
      logger.error(`${graphId} Failed to queue character profile images for chapter ${chapter}`);
    }
  } else {
    logger.info(`${graphId} No full-body images found for chapter ${chapter}, no profile images to generate`);
  }
}

/**
 * Generates images for locations in a specific chapter using wavespeed
 * @param {Object} params - The parameters object
 * @param {string} params.uid - User ID
 * @param {string} params.sku - Book SKU
 * @param {string} params.visibility - Visibility setting
 * @param {string} params.graphId - Graph ID
 * @param {number} params.chapter - Chapter number
 * @return {Promise<void>}
 */
async function generateLocationImages(params) {
  const {uid, sku, graphId, chapter} = params;

  logger.debug(`${graphId} Generating location images for chapter ${chapter}`);

  // 1. Load referenced entities for this chapter
  let referencedEntities;
  try {
    referencedEntities = await getGraph({
      uid: params.uid,
      sku,
      visibility: params.visibility,
      type: "referenced-entities",
      chapter,
      graphId,
    });
  } catch (error) {
    logger.debug(`${graphId} No referenced entities file for chapter ${chapter}: ${error.message}`);
    return;
  }

  if (!referencedEntities || !referencedEntities.referencedLocations || referencedEntities.referencedLocations.length === 0) {
    logger.debug(`${graphId} No referenced locations for chapter ${chapter}, skipping location image generation`);
    return;
  }

  // 2. Load location image prompts for this chapter
  let chapterPrompts;
  try {
    chapterPrompts = await getGraph({
      uid: params.uid,
      sku,
      visibility: params.visibility,
      type: "locationImagePrompts",
      chapter,
      graphId,
    });
  } catch (error) {
    logger.debug(`${graphId} No prompts file for chapter ${chapter}: ${error.message}`);
    return;
  }

  // 3. Check if there are any prompts
  if (!chapterPrompts.locationPrompts || chapterPrompts.locationPrompts.length === 0) {
    logger.debug(`${graphId} No location prompts found for chapter ${chapter}`);
    return;
  }

  // 4. Filter prompts to only include referenced locations
  const referencedLocsSet = new Set(referencedEntities.referencedLocations);
  const filteredPrompts = chapterPrompts.locationPrompts.filter((prompt) => {
    // Use the same sanitization as used when collecting referenced locations
    const sanitizedName = sanitizeFirebaseKey({key: prompt.location});
    return referencedLocsSet.has(sanitizedName.toLowerCase());
  });

  if (filteredPrompts.length === 0) {
    logger.debug(`${graphId} No matching location prompts after filtering for chapter ${chapter}`);
    return;
  }

  logger.debug(`${graphId} Processing ${filteredPrompts.length} referenced location images for chapter ${chapter} (filtered from ${chapterPrompts.locationPrompts.length})`);

  // 5. Prepare queue entries for wavespeed
  const types = [];
  const entryTypes = [];
  const entryParams = [];
  const uniques = [];

  for (const locationPrompt of filteredPrompts) {
    const {location, description} = locationPrompt;

    // Skip if no description
    if (!description) {
      logger.warn(`${graphId} Location ${location} has no description, skipping image generation`);
      continue;
    }

    // Normalize location name for use as identifier - use same sanitization as RTDB storage
    // This ensures the key matches what's used when storing descriptions
    const sanitizedKey = sanitizeFirebaseKey({key: location});
    const normalizedIdentifier = sanitizedKey.toLowerCase().replace(/\s+/g, "_");

    // Prepare queue entry
    types.push("wavespeed");
    entryTypes.push("generate");

    // Create output path
    const outputPath = `Graphs/${graphId}/images/locations/${normalizedIdentifier}_ch${chapter}.jpeg`;

    const prompt = `Create a detailed photo style location shot of ${location}: ${description}. Location only, professional establishing shot style.`;

    entryParams.push({
      prompt: prompt,
      negativePrompt: "animated, incomplete, cartoon, illustration, anime, low quality, blurry, distorted",
      model: "google/imagen4-fast",
      outputPath: outputPath,
      outputFormat: "jpeg",
      modelParams: {
        aspect_ratio: "9:16", // Landscape aspect ratio for locations
        seed: Math.floor(Math.random() * 2 ** 32),
        enable_base64_output: true,
        enable_safety_checker: false,
        enable_sync_mode: true,
      },
      graphId,
      chapter,
      identifier: normalizedIdentifier,
      type: "location",
      sku: sku,
      uid: uid,
    });

    // Generate unique key for deduplication
    const uniqueKey = wavespeedQueueToUnique({
      type: "wavespeed",
      entryType: "generate",
      graphId,
      identifier: normalizedIdentifier,
      chapter,
    });
    uniques.push(uniqueKey);
  }

  // 4. Add entries to queue if any
  if (types.length > 0) {
    const queueResult = await queueAddEntries({
      types,
      entryTypes,
      entryParams,
      uniques,
    });

    if (queueResult.success) {
      logger.debug(`${graphId} Queued ${types.length} location images for chapter ${chapter}`);

      // Dispatch the wavespeed queue to process the entries
      await dispatchTask({
        functionName: "launchWavespeedQueue",
        data: {},
      });
    } else {
      logger.error(`${graphId} Failed to queue location images for chapter ${chapter}`);
    }
  }
}

/**
 * Summarizes character image prompts for a specific chapter
 * @param {Object} params - The parameters object
 * @param {string} params.uid - User ID
 * @param {string} params.sku - Book SKU
 * @param {string} params.visibility - Visibility setting
 * @param {string} params.graphId - Graph ID
 * @param {number} params.chapter - Chapter number
 * @return {Object} Summarized character image prompts for the chapter
 */
async function summarizeCharacterImagePrompts(params) {
  const {uid, sku, visibility, graphId, chapter} = params;

  logger.debug(`${graphId} Summarizing character image prompts for chapter ${chapter}`);

  // 1. Load character image prompts for this chapter
  let chapterPrompts;
  try {
    chapterPrompts = await getGraph({
      uid,
      sku,
      visibility,
      type: "characterImagePrompts",
      chapter,
      graphId,
    });
  } catch (error) {
    logger.debug(`${graphId} No prompts file for chapter ${chapter}: ${error.message}`);
    // If no prompts file, store empty result
    await storeGraph({
      uid,
      sku,
      visibility,
      data: {characterPromptSummaries: {}},
      type: "characterImagePrompts-summarized",
      chapter,
      graphId,
    });
    return;
  }

  // 2. Check if there are any prompts
  if (!chapterPrompts.characterPrompts || chapterPrompts.characterPrompts.length === 0) {
    logger.debug(`${graphId} No character prompts found for chapter ${chapter}`);
    await storeGraph({
      uid,
      sku,
      visibility,
      data: {characterPromptSummaries: {}},
      type: "characterImagePrompts-summarized",
      chapter,
      graphId,
    });
    return;
  }

  const openRouterClient = new OpenRouterClient();
  const characterPromptSummaries = {};

  // 3. Summarize each character's description
  const summaryPromises = chapterPrompts.characterPrompts.map(async ({character, description}) => {
    logger.debug(`${graphId} Summarizing description for ${character}`);

    const result = await openRouterClient.sendRequest({
      promptOverride: graphPrompts["v0_1_character_image_summarize"],
      modelOverride: graphPrompts["v0_1_character_image_summarize"].openRouterModel,
      message: description,
      replacements: [], // No replacements needed for this prompt
      mockResponse: new OpenRouterMockResponse({
        content: `Mock summary for ${character}: A concise description highlighting key visual features.`,
      }),
      analyticsOptions: createAnalyticsOptions({uid, graphId, sku, promptId: "v0_1_character_image_summarize"}),
    });

    // We throw as this is pretty critical to the graph.
    if (result.error) {
      throw new Error(`${graphId} ${chapter} Error summarizing description for ${character}: ${result.error}`);
    }

    if (result.result) {
      // Since we're getting plain text back, use it directly
      return {
        character: character,
        summary: result.result,
      };
    } else {
      throw new Error(`${graphId} ${chapter} No summary found for character ${character}`);
    }
  });

  // Wait for all summaries to be generated
  const results = await Promise.all(summaryPromises);

  // Build the summaries object
  for (const result of results) {
    if (result && result.summary) {
      characterPromptSummaries[result.character] = result.summary;
    }
  }

  logger.info(`${graphId} Summarized ${Object.keys(characterPromptSummaries).length} character descriptions for chapter ${chapter}`);

  // 4. Store the summarized prompts
  const summariesData = {
    characterPromptSummaries: characterPromptSummaries,
  };

  await storeGraph({
    uid,
    sku,
    visibility,
    data: summariesData,
    type: "characterImagePrompts-summarized",
    chapter,
    graphId,
  });

  // 5. Build unsummarized descriptions object
  const characterUnsummarized = {};
  for (const {character, description} of chapterPrompts.characterPrompts) {
    characterUnsummarized[character] = description;
  }

  // 6. Store both summarized and unsummarized descriptions in RTDB
  if (Object.keys(characterPromptSummaries).length > 0) {
    logger.info(`${graphId} Storing ${Object.keys(characterPromptSummaries).length} character summaries (and unsummarized) in RTDB for graph ${graphId}`);
    await storeGraphCharactersRtdb({
      graphId,
      chapter,
      characterSummaries: characterPromptSummaries,
      characterUnsummarized: characterUnsummarized,
    });
  }
}

/**
 * Summarizes location image prompts for a specific chapter
 * @param {Object} params - The parameters object
 * @param {string} params.uid - User ID
 * @param {string} params.sku - Book SKU
 * @param {string} params.visibility - Visibility setting
 * @param {string} params.graphId - Graph ID
 * @param {number} params.chapter - Chapter number
 * @return {Object} Summarized location image prompts for the chapter
 */
async function summarizeLocationImagePrompts(params) {
  const {uid, sku, visibility, graphId, chapter} = params;

  logger.debug(`${graphId} Summarizing location image prompts for chapter ${chapter}`);

  // 1. Load location image prompts for this chapter
  let chapterPrompts;
  try {
    chapterPrompts = await getGraph({
      uid,
      sku,
      visibility,
      type: "locationImagePrompts",
      chapter,
      graphId,
    });
  } catch (error) {
    logger.debug(`${graphId} No prompts file for chapter ${chapter}: ${error.message}`);
    // If no prompts file, store empty result
    await storeGraph({
      uid,
      sku,
      visibility,
      data: {locationPromptSummaries: {}},
      type: "locationImagePrompts-summarized",
      chapter,
      graphId,
    });
    return;
  }

  // 2. Check if there are any prompts
  if (!chapterPrompts.locationPrompts || chapterPrompts.locationPrompts.length === 0) {
    logger.debug(`${graphId} No location prompts found for chapter ${chapter}`);
    await storeGraph({
      uid,
      sku,
      visibility,
      data: {locationPromptSummaries: {}},
      type: "locationImagePrompts-summarized",
      chapter,
      graphId,
    });
    return;
  }

  const openRouterClient = new OpenRouterClient();
  const locationPromptSummaries = {};

  // 3. Summarize each location's description
  const summaryPromises = chapterPrompts.locationPrompts.map(async ({location, description}) => {
    logger.debug(`${graphId} Summarizing description for ${location}`);


    const result = await openRouterClient.sendRequest({
      promptOverride: graphPrompts["v0_1_location_image_summarize"],
      modelOverride: graphPrompts["v0_1_location_image_summarize"].openRouterModel,
      message: description,
      replacements: [], // No replacements needed for this prompt
      mockResponse: new OpenRouterMockResponse({
        content: `Mock summary for ${location}: A brief overview of the location's key features.`,
      }),
      analyticsOptions: createAnalyticsOptions({uid, graphId, sku, promptId: "v0_1_location_image_summarize"}),
    });

    // We throw as this is pretty critical to the graph.
    if (result.error) {
      throw new Error(`${graphId} ${chapter} Error summarizing description for ${location}: ${result.error}`);
    }

    if (result.result) {
      // Since we're getting plain text back, use it directly
      return {
        location: location,
        summary: result.result,
      };
    } else {
      throw new Error(`${graphId} ${chapter} No summary found for location ${location}`);
    }
  });

  // Wait for all summaries to be generated
  const results = await Promise.all(summaryPromises);

  // Build the summaries object
  for (const result of results) {
    if (result && result.summary) {
      locationPromptSummaries[result.location] = result.summary;
    }
  }

  logger.info(`${graphId} Summarized ${Object.keys(locationPromptSummaries).length} location descriptions for chapter ${chapter}`);

  // 4. Store the summarized prompts
  const summariesData = {
    locationPromptSummaries: locationPromptSummaries,
  };

  await storeGraph({
    uid,
    sku,
    visibility,
    data: summariesData,
    type: "locationImagePrompts-summarized",
    chapter,
    graphId,
  });

  // 5. Build unsummarized descriptions object
  const locationUnsummarized = {};
  for (const {location, description} of chapterPrompts.locationPrompts) {
    locationUnsummarized[location] = description;
  }

  // 6. Store both summarized and unsummarized descriptions in RTDB
  if (Object.keys(locationPromptSummaries).length > 0) {
    logger.info(`${graphId} Storing ${Object.keys(locationPromptSummaries).length} location summaries (and unsummarized) in RTDB for graph ${graphId}`);
    await storeGraphLocationsRtdb({
      graphId,
      chapter,
      locationSummaries: locationPromptSummaries,
      locationUnsummarized: locationUnsummarized,
    });
  }
}

/**
 * Update the scene cache with scenes from the current chapter
 * Creates default scene on first iteration
 * @param {Object} params - Parameters for updating scene cache
 * @param {string} params.uid - User ID
 * @param {string} params.sku - SKU identifier
 * @param {string} params.visibility - Visibility setting
 * @param {string} params.graphId - Graph ID
 * @param {number} params.chapter - Current chapter number
 * @param {string} params.defaultSceneId - Default scene ID (if already created)
 * @return {Promise<Object>} Object containing defaultSceneId
 */
async function updateSceneCache(params) {
  let {uid, sku, visibility, chapter, graphId, defaultSceneId} = params;
  logger.info(`${graphId} Updating scene cache for chapter ${chapter} of graphId ${graphId}`);

  // Step 1: Verify augmentedScenes exist (should have been created by AUGMENT_SCENE_PROMPTS step)
  let augmentedScenes;
  try {
    augmentedScenes = await getGraph({
      uid,
      sku,
      visibility,
      type: "augmentedScenes",
      graphId,
    });
    logger.info(`${graphId} Found augmentedScenes for graphId ${graphId}`);
  } catch (error) {
    logger.error(`${graphId} augmentedScenes not found for graphId, this should have been created by AUGMENT_SCENE_PROMPTS step`);
    throw new Error(`${graphId} augmentedScenes not found for graphId`);
  }

  // Step 2: Create default scene if it doesn't exist
  if (!defaultSceneId) {
    logger.info(`${graphId} Creating default scene for graphId ${graphId}`);

    // Create default scene which will use the augmentedScenes
    const defaultScene = await scenesCreateDefaultCatalogue({
      id: graphId,
      uid,
      sku,
      visibility,
      graphId,
    });

    defaultSceneId = defaultScene.id;
    logger.info(`${graphId} Created default scene ${defaultSceneId} for graphId ${graphId}`);
  }

  // Step 3: Update scene cache with current chapter's scenes
  if (augmentedScenes && augmentedScenes[chapter]) {
    // Use the new chapter-specific storage function to avoid concurrency issues
    await storeChapterSceneInCache({
      sceneId: defaultSceneId,
      chapter: chapter,
      chapterScenes: augmentedScenes[chapter],
    });

    logger.info(`${graphId} Updated scene cache with chapter ${chapter} scenes for defaultSceneId ${defaultSceneId}`);

    // Create scene time index for efficient lookups
    try {
      await createSceneTimeIndex({
        sceneId: defaultSceneId,
      });
      logger.info(`${graphId} Created scene time index for defaultSceneId ${defaultSceneId}`);
    } catch (error) {
      logger.error(`${graphId} Failed to create scene time index: ${error.message}`);
      // Continue with pipeline even if time index creation fails
    }

    // Step 4: Compose images for the first 5 scenes in this chapter
    try {
      const chapterScenes = augmentedScenes[chapter];
      // Get the first 5 scenes (or fewer if chapter has less than 5)
      const scenesToCompose = chapterScenes
          .slice(0, 5)
          .map((scene) => ({
            chapter: chapter,
            scene: scene.scene_number,
          }));

      if (scenesToCompose.length > 0) {
        logger.info(`${graphId} Composing images for first ${scenesToCompose.length} scenes in chapter ${chapter}`);
        await composeSceneImages({
          graphId: graphId,
          defaultSceneId,
          scenes: scenesToCompose,
          sku: sku,
          uid: uid,
        });
      }
    } catch (error) {
      logger.error(`${graphId} Failed to compose scene images for chapter ${chapter}: ${error.message}`);
      // Continue with pipeline even if image composition fails
    }
  } else {
    logger.warn(`${graphId} No scenes found for chapter ${chapter} in graphId ${graphId}`);
  }

  return {defaultSceneId};
}


/**
 * Finds the first chapter where the cumulative duration from the start exceeds 5 minutes (300 seconds)
 * @param {Object} transcriptions - Object containing transcription data organized by chapter
 * @return {number|null} The first chapter number where cumulative duration > 5 minutes, or null if none found
 */
function getFirstChapterOver5Minutes(transcriptions) {
  const chapterLengths = getChapterLengths({transcriptions});

  // Sort chapter numbers to ensure we check in order
  const sortedChapters = Object.keys(chapterLengths)
      .map((key) => parseInt(key, 10))
      .sort((a, b) => a - b);

  let cumulativeDuration = 0;
  for (const chapterNum of sortedChapters) {
    cumulativeDuration += chapterLengths[chapterNum];
    if (cumulativeDuration > 300) { // 300 seconds = 5 minutes
      return chapterNum;
    }
  }

  // If cumulative duration never exceeds 5 minutes, return the last chapter number
  // or null if no chapters exist
  return sortedChapters.length > 0 ? sortedChapters[sortedChapters.length - 1] : null;
}

export {
  correctTranscriptionsByChapter,
  graphCharactersByChapter,
  graphCharacterPropertiesByChapter,
  generateCharacterImagePrompts,
  generateCharacterImages,
  generateCharacterProfileImages,
  graphLocationsByChapter,
  graphLocationPropertiesByChapter,
  generateLocationImagePrompts,
  generateLocationImages,
  summarizeCharacterImagePrompts,
  summarizeLocationImagePrompts,
  updateSceneCache,
  getFirstChapterOver5Minutes,
  transcriptionsToText,
};
