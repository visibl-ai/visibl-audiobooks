/* eslint-disable require-jsdoc */
import {
  storeData,
  getData,
} from "./database.js";
import {
  sanitizeFirebaseKey,
  sanitizeObjectKeys,
} from "../utils.js";
import logger from "../../util/logger.js";

/**
 * Generate database reference path for graph data
 * @param {string} graphId - The graph ID
 * @param {string} type - The type of graph data (characters, locations, etc.)
 * @param {number} chapter - The chapter index
 * @return {string} Database reference path
 */
function graphDataToDbRef({graphId, type, chapter}) {
  return `graphs/${graphId}/chapters/${chapter}/${type}`;
}

/**
 * Get graph data from RTDB
 * @param {string} graphId - The graph ID
 * @return {Promise<Object>} The graph data
 */
function getGraphDataRtdb({graphId}) {
  return getData({ref: `graphs/${graphId}`});
}

/**
 * Store graph characters in RTDB (supports both summarized and unsummarized)
 * @param {Object} params - Parameters object
 * @param {string} params.graphId - The graph ID
 * @param {number} params.chapter - The chapter index
 * @param {Object} params.characterSummaries - Character summaries to store
 * @param {Object} params.characterUnsummarized - Unsummarized character descriptions (optional)
 * @return {Promise<void>}
 */
async function storeGraphCharactersRtdb({graphId, chapter, characterSummaries, characterUnsummarized}) {
  if (!graphId || chapter === undefined || chapter === null || !characterSummaries) {
    throw new Error("graphId, chapter, and characterSummaries are required");
  }

  logger.debug(`Storing characters for graph ${graphId} chapter ${chapter} in RTDB`);

  // Get existing characters to merge with new data
  const existingCharacters = await getGraphCharactersRtdb({graphId, chapter}) || {};

  // Convert flat descriptions to structured format
  const structuredCharacters = {};
  for (const [characterName, description] of Object.entries(characterSummaries)) {
    const sanitizedName = sanitizeFirebaseKey({key: characterName});
    structuredCharacters[sanitizedName] = {
      ...existingCharacters[sanitizedName], // Preserve existing data (like images)
      description: description, // Summarized description
      unsummarizedDescription: characterUnsummarized?.[characterName] || null, // Raw description if provided
      image: existingCharacters[sanitizedName]?.image || null, // Preserve existing image
    };
  }

  const sanitizedData = sanitizeObjectKeys(structuredCharacters);
  await storeData({
    ref: graphDataToDbRef({graphId, type: "characters", chapter}),
    data: sanitizedData,
  });
}

/**
 * Store graph locations in RTDB with merged structure (supports both summarized and unsummarized)
 * @param {Object} params - Parameters object
 * @param {string} params.graphId - The graph ID
 * @param {number} params.chapter - The chapter index
 * @param {Object} params.locationSummaries - Location summaries to store
 * @param {Object} params.locationUnsummarized - Unsummarized location descriptions (optional)
 * @return {Promise<void>}
 */
async function storeGraphLocationsRtdb({graphId, chapter, locationSummaries, locationUnsummarized}) {
  if (!graphId || chapter === undefined || chapter === null || !locationSummaries) {
    throw new Error("graphId, chapter, and locationSummaries are required");
  }

  logger.debug(`Storing locations for graph ${graphId} chapter ${chapter} in RTDB`);

  // Get existing locations to merge with new data
  const existingLocations = await getGraphLocationsRtdb({graphId, chapter}) || {};

  // Convert flat descriptions to structured format
  const structuredLocations = {};
  for (const [locationName, description] of Object.entries(locationSummaries)) {
    const sanitizedName = sanitizeFirebaseKey({key: locationName});
    structuredLocations[sanitizedName] = {
      ...existingLocations[sanitizedName], // Preserve existing data (like images)
      description: description, // Summarized description
      unsummarizedDescription: locationUnsummarized?.[locationName] || null, // Raw description if provided
      image: existingLocations[sanitizedName]?.image || null, // Preserve existing image
    };
  }

  const sanitizedData = sanitizeObjectKeys(structuredLocations);
  await storeData({
    ref: graphDataToDbRef({graphId, type: "locations", chapter}),
    data: sanitizedData,
  });
}

/**
 * Store character images by updating existing character entries
 * @param {Object} params - Parameters object
 * @param {string} params.graphId - The graph ID
 * @param {number} params.chapter - The chapter index
 * @param {Object} params.characterImages - Character images to store {characterName: imageUrl}
 * @return {Promise<void>}
 */
async function storeGraphCharacterImagesRtdb({graphId, chapter, characterImages}) {
  if (!graphId || chapter === undefined || chapter === null || !characterImages) {
    throw new Error("graphId, chapter, and characterImages are required");
  }

  logger.debug(`Storing character images for graph ${graphId} chapter ${chapter} in RTDB`);

  // Get existing characters
  const existingCharacters = await getGraphCharactersRtdb({graphId, chapter}) || {};

  // Update each character with their image
  for (const [characterName, imageUrl] of Object.entries(characterImages)) {
    const sanitizedName = sanitizeFirebaseKey({key: characterName});

    if (existingCharacters[sanitizedName]) {
      // Update existing character
      existingCharacters[sanitizedName].image = imageUrl;
    } else {
      // Create new character entry with just image
      existingCharacters[sanitizedName] = {
        description: null,
        image: imageUrl,
      };
    }
  }

  await storeData({
    ref: graphDataToDbRef({graphId, type: "characters", chapter}),
    data: existingCharacters,
  });
}

/**
 * Store location images by updating existing location entries
 * @param {Object} params - Parameters object
 * @param {string} params.graphId - The graph ID
 * @param {number} params.chapter - The chapter index
 * @param {Object} params.locationImages - Location images to store {locationName: imageUrl}
 * @return {Promise<void>}
 */
async function storeGraphLocationImagesRtdb({graphId, chapter, locationImages}) {
  if (!graphId || chapter === undefined || chapter === null || !locationImages) {
    throw new Error("graphId, chapter, and locationImages are required");
  }

  logger.debug(`Storing location images for graph ${graphId} chapter ${chapter} in RTDB`);

  // Get existing locations
  const existingLocations = await getGraphLocationsRtdb({graphId, chapter}) || {};

  // Update each location with their image
  for (const [locationName, imageUrl] of Object.entries(locationImages)) {
    const sanitizedName = sanitizeFirebaseKey({key: locationName});

    if (existingLocations[sanitizedName]) {
      // Update existing location
      existingLocations[sanitizedName].image = imageUrl;
    } else {
      // Create new location entry with just image
      existingLocations[sanitizedName] = {
        description: null,
        image: imageUrl,
      };
    }
  }

  await storeData({
    ref: graphDataToDbRef({graphId, type: "locations", chapter}),
    data: existingLocations,
  });
}

/**
 * Get graph characters from RTDB (returns full structure with description and image)
 * @param {Object} params - Parameters object
 * @param {string} params.graphId - The graph ID
 * @param {number} params.chapter - The chapter index
 * @return {Promise<Object|null>} Characters with structure {characterName: {description, image}} or null if not found
 */
async function getGraphCharactersRtdb({graphId, chapter}) {
  if (!graphId || chapter === undefined || chapter === null) {
    throw new Error("graphId and chapter are required");
  }

  return await getData({
    ref: graphDataToDbRef({graphId, type: "characters", chapter}),
  });
}

/**
 * Get graph locations from RTDB (returns full structure with description and image)
 * @param {Object} params - Parameters object
 * @param {string} params.graphId - The graph ID
 * @param {number} params.chapter - The chapter index
 * @return {Promise<Object|null>} Locations with structure {locationName: {description, image}} or null if not found
 */
async function getGraphLocationsRtdb({graphId, chapter}) {
  if (!graphId || chapter === undefined || chapter === null) {
    throw new Error("graphId and chapter are required");
  }

  return await getData({
    ref: graphDataToDbRef({graphId, type: "locations", chapter}),
  });
}

export {
  storeGraphCharactersRtdb,
  storeGraphLocationsRtdb,
  storeGraphCharacterImagesRtdb,
  storeGraphLocationImagesRtdb,
  getGraphCharactersRtdb,
  getGraphLocationsRtdb,
  getGraphDataRtdb,
};
