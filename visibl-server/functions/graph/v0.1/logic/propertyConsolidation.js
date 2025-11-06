/* eslint-disable camelcase */

import logger from "../../../util/logger.js";
import graphPrompts from "../graphV0_1Prompts.js";
import {OpenRouterClient, OpenRouterMockResponse} from "../../../ai/openrouter/base.js";
import {getGraph, storeGraph} from "../../../storage/storage.js";
import {getAuthorAndTitleFromSku, fetchGraphEntityArray} from "../../../util/graphHelper.js";

/**
 * Generate mock response for character property filtering
 * @param {string} characterName - Name of the character
 * @param {Array} previousPropsFormatted - Previous chapter properties
 * @param {Array} currentPropsFormatted - Current chapter properties
 * @return {OpenRouterMockResponse} Mock response for testing
 */
function getMockCharacterPropertyFilterResponse(characterName, previousPropsFormatted, currentPropsFormatted) {
  return new OpenRouterMockResponse({
    content: {
      filteredProperties: (() => {
        // For mock entities, simulate filtering logic
        if (characterName.toLowerCase().startsWith("mockcharacter")) {
          const filtered = [];

          // Keep permanent properties (physical features)
          for (const prop of previousPropsFormatted) {
            // Keep permanent features
            if (prop.relationship === "hair_color" ||
                prop.relationship === "eye_color" ||
                prop.relationship === "skin_tone" ||
                prop.relationship === "height" ||
                prop.relationship === "build" ||
                prop.relationship === "facial_features" ||
                prop.relationship === "distinguishing_marks") {
              // Check if there's a conflicting current property
              const hasConflict = currentPropsFormatted.some(
                  (cp) => cp.relationship === prop.relationship,
              );
              if (!hasConflict) {
                filtered.push(prop);
              }
            }
            // Skip temporary properties like clothing
          }
          return filtered;
        }
        // For non-mock entities, return a subset of previous properties
        return previousPropsFormatted.slice(0, Math.floor(previousPropsFormatted.length / 2));
      })(),
      reasoning: "Mock: Filtered properties based on permanence and conflicts with current chapter",
    },
  });
}

/**
 * Generate mock response for location property filtering
 * @param {Array} previousProperties - Previous chapter properties
 * @return {OpenRouterMockResponse} Mock response for testing
 */
function getMockLocationPropertyFilterResponse(previousProperties) {
  return new OpenRouterMockResponse({
    content: {
      filteredProperties: previousProperties.map((p) => ({
        relationship: p.relationship,
        property: p.property,
      })),
      reasoning: "Mock: Keeping all previous location properties as they don't conflict with current ones",
    },
  });
}

/**
 * Main function to consolidate entity properties based on continuity
 * Takes properties from current chapter and filters previous chapter properties
 * based on what still applies
 * @param {Object} params - Parameters for property consolidation
 * @param {string} params.uid - User ID
 * @param {string} params.sku - Book SKU
 * @param {string} params.visibility - Visibility setting
 * @param {string} params.graphId - Graph ID
 * @param {number} params.chapter - Current chapter number
 * @return {Promise<Object>} Consolidated properties for the chapter
 */
async function graphConsolidatePropertiesByChapter(params) {
  const {uid, sku, visibility, graphId, chapter} = params;

  logger.debug(`${graphId} Consolidating entity properties for chapter ${chapter}`);

  // Skip chapter 0 as it has no previous chapters
  if (chapter === 0) {
    logger.debug(`${graphId} Chapter 0 has no previous chapters, skipping property consolidation`);

    // For chapter 0, just copy the current properties as continuity properties
    const characterProperties = await fetchGraphEntityArray({
      uid, sku, visibility,
      type: "characterProperties",
      chapter, graphId,
      responseKey: "properties",
    });
    await storeGraph({
      sku,
      data: characterProperties,
      type: "characterProperties-continuity",
      graphId, chapter,
    });

    const locationProperties = await fetchGraphEntityArray({
      uid, sku, visibility,
      type: "locationProperties",
      chapter, graphId,
      responseKey: "properties",
    });
    await storeGraph({
      sku,
      data: locationProperties,
      type: "locationProperties-continuity",
      graphId, chapter,
    });

    return {
      characters: {properties: []},
      locations: {properties: []},
    };
  }

  // Load continuity mapping from previous step
  const continuityMapping = await getGraph({
    uid, sku, visibility,
    type: "continuity",
    chapter, graphId,
  });

  // Create a single OpenRouter client for all requests
  const openRouterClient = new OpenRouterClient();

  // Get author and title from SKU for LLM prompts
  const {author, title} = await getAuthorAndTitleFromSku(sku);

  // Fetch properties from previous chapters based on continuity
  const propertiesFromContinuity = await fetchPropertiesFromContinuity({
    uid, sku, visibility,
    graphId, chapter,
    continuityMapping,
  });

  // Filter and consolidate properties
  const consolidatedProperties = await consolidatePropertiesByContinuity({
    uid, sku, visibility,
    graphId, chapter,
    continuityMapping,
    propertiesFromContinuity,
    openRouterClient,
    author, title,
  });

  // Store the consolidated character properties (all properties flattened)
  await storeGraph({
    sku,
    data: {
      properties: consolidatedProperties.characters.properties,
    },
    type: "characterProperties-continuity",
    graphId, chapter,
  });

  // Store the consolidated location properties (all properties flattened)
  await storeGraph({
    sku,
    data: {
      properties: consolidatedProperties.locations.properties,
    },
    type: "locationProperties-continuity",
    graphId, chapter,
  });

  // Store the raw propertiesFromContinuity for debugging purposes
  await storeGraph({
    sku,
    data: {
      characters: propertiesFromContinuity.characters || {},
      locations: propertiesFromContinuity.locations || {},
    },
    type: "propertiesFromContinuity",
    graphId, chapter,
  });

  logger.debug(`${graphId} Property consolidation completed for chapter ${chapter}`);
  return consolidatedProperties;
}

/**
 * Fetch properties from the most recent chapter containing matching entities with high/medium confidence
 * @param {Object} params - Parameters for fetching properties
 * @param {string} params.uid - User ID
 * @param {string} params.sku - Book SKU
 * @param {string} params.visibility - Visibility setting
 * @param {string} params.graphId - Graph ID
 * @param {number} params.chapter - Current chapter number
 * @param {Object} params.continuityMapping - Continuity mapping for the chapter
 * @return {Promise<Object>} Properties grouped by current chapter entity names
 */
async function fetchPropertiesFromContinuity(params) {
  const {uid, sku, visibility, graphId, chapter, continuityMapping} = params;

  logger.debug(`${graphId} Fetching properties from continuity for chapter ${chapter}`);

  // Track which chapters we need to fetch properties from
  const charactersToFetch = new Set();
  const locationsToFetch = new Set();
  const characterToChapterMap = new Map(); // Maps entity name to most recent chapter with high/medium confidence
  const locationToChapterMap = new Map();

  // Process character continuity to find chapters with high/medium confidence matches
  for (const [entityName, continuityData] of Object.entries(continuityMapping.characters || {})) {
    let mostRecentChapter = null;
    let mostRecentChapterNum = -1;

    // Find the most recent chapter with high or medium confidence
    for (const appearanceObj of continuityData.appearsIn || []) {
      const chapterNum = parseInt(Object.keys(appearanceObj)[0]);
      const appearance = Object.values(appearanceObj)[0];

      if ((appearance.confidence === "high" || appearance.confidence === "medium") &&
          chapterNum > mostRecentChapterNum) {
        mostRecentChapter = chapterNum;
        mostRecentChapterNum = chapterNum;
      }
    }

    if (mostRecentChapter !== null) {
      charactersToFetch.add(mostRecentChapter);
      characterToChapterMap.set(entityName.toLowerCase(), mostRecentChapter);
    }
  }

  // Process location continuity similarly
  for (const [entityName, continuityData] of Object.entries(continuityMapping.locations || {})) {
    let mostRecentChapter = null;
    let mostRecentChapterNum = -1;

    // Find the most recent chapter with high or medium confidence
    for (const appearanceObj of continuityData.appearsIn || []) {
      const chapterNum = parseInt(Object.keys(appearanceObj)[0]);
      const appearance = Object.values(appearanceObj)[0];

      if ((appearance.confidence === "high" || appearance.confidence === "medium") &&
          chapterNum > mostRecentChapterNum) {
        mostRecentChapter = chapterNum;
        mostRecentChapterNum = chapterNum;
      }
    }

    if (mostRecentChapter !== null) {
      locationsToFetch.add(mostRecentChapter);
      locationToChapterMap.set(entityName.toLowerCase(), mostRecentChapter);
    }
  }

  // If no chapters to fetch, return empty object
  if (charactersToFetch.size === 0 && locationsToFetch.size === 0) {
    logger.debug(`${graphId} No chapters with high/medium confidence matches found`);
    return {characters: {}, locations: {}};
  }

  logger.debug(`${graphId} Fetching character properties from chapters: ${Array.from(charactersToFetch).join(", ")}`);
  logger.debug(`${graphId} Fetching location properties from chapters: ${Array.from(locationsToFetch).join(", ")}`);

  // Fetch character properties from all relevant chapters in parallel
  // Try to fetch from characterProperties-continuity first, fall back to characterProperties
  const characterPropertyPromises = Array.from(charactersToFetch).map(async (chapterNum) => {
    try {
      const properties = await fetchGraphEntityArray({
        uid, sku, visibility,
        type: "characterProperties-continuity",
        chapter: chapterNum,
        graphId,
        responseKey: "properties",
      });
      return {chapter: chapterNum, properties: properties.properties || []};
    } catch (error) {
      // Fall back to characterProperties if continuity file doesn't exist
      logger.debug(`${graphId} characterProperties-continuity not found for chapter ${chapterNum}, falling back to characterProperties`);
      const properties = await fetchGraphEntityArray({
        uid, sku, visibility,
        type: "characterProperties",
        chapter: chapterNum,
        graphId,
        responseKey: "properties",
      });
      return {chapter: chapterNum, properties: properties.properties || []};
    }
  });

  // Fetch location properties from all relevant chapters in parallel
  // Try to fetch from locationProperties-continuity first, fall back to locationProperties
  const locationPropertyPromises = Array.from(locationsToFetch).map(async (chapterNum) => {
    try {
      const properties = await fetchGraphEntityArray({
        uid, sku, visibility,
        type: "locationProperties-continuity",
        chapter: chapterNum,
        graphId,
        responseKey: "properties",
      });
      return {chapter: chapterNum, properties: properties.properties || []};
    } catch (error) {
      // Fall back to locationProperties if continuity file doesn't exist
      logger.debug(`${graphId} locationProperties-continuity not found for chapter ${chapterNum}, falling back to locationProperties`);
      const properties = await fetchGraphEntityArray({
        uid, sku, visibility,
        type: "locationProperties",
        chapter: chapterNum,
        graphId,
        responseKey: "properties",
      });
      return {chapter: chapterNum, properties: properties.properties || []};
    }
  });

  const [characterChapterProperties, locationChapterProperties] = await Promise.all([
    Promise.all(characterPropertyPromises),
    Promise.all(locationPropertyPromises),
  ]);

  // Create maps for quick lookup
  const characterPropertiesMap = new Map();
  for (const chapterData of characterChapterProperties) {
    characterPropertiesMap.set(chapterData.chapter, chapterData.properties);
  }

  const locationPropertiesMap = new Map();
  for (const chapterData of locationChapterProperties) {
    locationPropertiesMap.set(chapterData.chapter, chapterData.properties);
  }

  // Group character properties by current chapter entity names
  const groupedCharacterProperties = {};
  for (const [entityName, continuityData] of Object.entries(continuityMapping.characters || {})) {
    const entityNameLower = entityName.toLowerCase();
    const sourceChapter = characterToChapterMap.get(entityNameLower);

    if (sourceChapter === undefined) {
      continue; // No high/medium confidence match for this entity
    }

    const properties = characterPropertiesMap.get(sourceChapter) || [];
    const entityProperties = [];

    // Find the entity name used in the source chapter
    const appearanceObj = continuityData.appearsIn.find((obj) => Object.keys(obj)[0] === String(sourceChapter));
    const sourceEntityName = appearanceObj ? Object.values(appearanceObj)[0].name : entityName;

    // Collect properties for this entity (check both current name and source chapter name)
    for (const property of properties) {
      const propertyCharacterLower = property.character?.toLowerCase();
      if (propertyCharacterLower === entityNameLower ||
          propertyCharacterLower === sourceEntityName.toLowerCase()) {
        // Add property with current chapter entity name
        entityProperties.push({
          ...property,
          character: entityName, // Use current chapter entity name
          sourceChapter: sourceChapter,
        });
      }
    }

    if (entityProperties.length > 0) {
      groupedCharacterProperties[entityName] = {
        properties: entityProperties,
        sourceChapter: sourceChapter,
      };
    }
  }

  // Group location properties by current chapter entity names
  const groupedLocationProperties = {};
  for (const [entityName, continuityData] of Object.entries(continuityMapping.locations || {})) {
    const entityNameLower = entityName.toLowerCase();
    const sourceChapter = locationToChapterMap.get(entityNameLower);

    if (sourceChapter === undefined) {
      continue; // No high/medium confidence match for this entity
    }

    const properties = locationPropertiesMap.get(sourceChapter) || [];
    const entityProperties = [];

    // Find the entity name used in the source chapter
    const appearanceObj = continuityData.appearsIn.find((obj) => Object.keys(obj)[0] === String(sourceChapter));
    const sourceEntityName = appearanceObj ? Object.values(appearanceObj)[0].name : entityName;

    // Collect properties for this entity (check both current name and source chapter name)
    for (const property of properties) {
      const propertyLocationLower = property.location?.toLowerCase();
      if (propertyLocationLower === entityNameLower ||
          propertyLocationLower === sourceEntityName.toLowerCase()) {
        // Add property with current chapter entity name
        entityProperties.push({
          ...property,
          location: entityName, // Use current chapter entity name
          sourceChapter: sourceChapter,
        });
      }
    }

    if (entityProperties.length > 0) {
      groupedLocationProperties[entityName] = {
        properties: entityProperties,
        sourceChapter: sourceChapter,
      };
    }
  }

  logger.debug(`${graphId} Fetched properties for ${Object.keys(groupedCharacterProperties).length} characters and ${Object.keys(groupedLocationProperties).length} locations`);
  return {
    characters: groupedCharacterProperties,
    locations: groupedLocationProperties,
  };
}

/**
 * Filter properties from previous chapters based on their continued relevance
 * and merge with current chapter properties
 * @param {Object} params - Parameters for filtering properties
 * @param {string} params.uid - User ID
 * @param {string} params.sku - Book SKU
 * @param {string} params.visibility - Visibility setting
 * @param {string} params.graphId - Graph ID
 * @param {number} params.chapter - Current chapter number
 * @param {Object} params.continuityMapping - Continuity mapping for the chapter
 * @param {Object} params.propertiesFromContinuity - Properties fetched from previous chapters
 * @param {OpenRouterClient} params.openRouterClient - OpenRouter client instance
 * @param {string} params.author - Book author
 * @param {string} params.title - Book title
 * @return {Promise<Object>} Complete filtered properties including current and relevant past properties
 */
async function consolidatePropertiesByContinuity(params) {
  const {
    uid, sku, visibility,
    graphId, chapter,
    continuityMapping,
    propertiesFromContinuity,
    openRouterClient,
    author, title,
  } = params;

  logger.debug(`${graphId} Filtering continuity properties for chapter ${chapter}`);

  // Track property inclusion/exclusion decisions
  const characterPropertyDecisions = {};
  const locationPropertyDecisions = {};

  // Load current chapter's character and location properties in parallel
  const [currentChapterProperties, currentChapterLocationProperties] = await Promise.all([
    fetchGraphEntityArray({
      uid, sku, visibility,
      type: "characterProperties",
      chapter, graphId,
      responseKey: "properties",
    }),
    fetchGraphEntityArray({
      uid, sku, visibility,
      type: "locationProperties",
      chapter, graphId,
      responseKey: "properties",
    }),
  ]);

  /**
   * Helper function to process entities (characters or locations)
   * @param {string} entityType - Type of entity ('character' or 'location')
   * @param {Object} currentProperties - Current chapter properties
   * @param {Object} continuityMapping - Continuity mapping for entities
   * @param {Object} propertiesFromContinuity - Properties from previous chapters
   * @param {Object} propertyDecisions - Object to track property decisions
   * @return {Promise<Array>} Array of processed entity results
   */
  async function processEntityProperties(entityType, currentProperties, continuityMapping, propertiesFromContinuity, propertyDecisions) {
    const isCharacter = entityType === "character";
    const entityKey = isCharacter ? "character" : "location";
    const entitiesMap = isCharacter ? continuityMapping.characters : continuityMapping.locations;
    const previousEntities = isCharacter ? propertiesFromContinuity.characters : propertiesFromContinuity.locations;
    const promptKey = isCharacter ? "v0_1_filter_character_continuity_properties" : "v0_1_filter_location_continuity_properties";

    // Get all unique entity names from both current properties and continuity mapping
    const allEntityNames = new Set();

    // Add entities from current chapter properties
    for (const property of currentProperties.properties || []) {
      if (property[entityKey]) {
        allEntityNames.add(property[entityKey].toLowerCase());
      }
    }

    // Add entities from continuity mapping
    for (const entityName of Object.keys(entitiesMap || {})) {
      allEntityNames.add(entityName.toLowerCase());
    }

    // Process each entity in parallel
    const entityPromises = Array.from(allEntityNames).map(async (entityNameLower) => {
      // Find the proper case version of the entity name
      const entityName = Object.keys(entitiesMap || {})
          .find((name) => name.toLowerCase() === entityNameLower) || entityNameLower;

      // Get current chapter properties for this entity
      const currentEntityProperties = (currentProperties.properties || [])
          .filter((p) => p[entityKey]?.toLowerCase() === entityNameLower);

      // Check if this entity has properties from previous chapters
      const previousPropertiesData = previousEntities?.[entityName];

      if (!previousPropertiesData || !previousPropertiesData.properties || previousPropertiesData.properties.length === 0) {
        // No previous properties, just return current properties
        return {
          [entityKey]: entityName,
          properties: currentEntityProperties,
        };
      }

      // Entity has both current and previous properties - need to filter
      const previousProperties = previousPropertiesData.properties;

      // If no current properties, just use all previous properties
      if (currentEntityProperties.length === 0) {
        logger.debug(`${graphId} ${entityType} ${entityName} has no current properties, using all ${previousProperties.length} previous properties`);
        return {
          [entityKey]: entityName,
          properties: previousProperties,
        };
      }

      // Format properties for LLM
      const currentPropsFormatted = currentEntityProperties.map((p) => ({
        relationship: p.relationship,
        property: p.property,
      }));

      const previousPropsFormatted = previousProperties.map((p) => ({
        relationship: p.relationship,
        property: p.property,
      }));

      // Create the message for the LLM
      const messageLines = isCharacter ?
        [`Character: ${entityName}`, "", `Current Chapter ${chapter} Properties:`, JSON.stringify(currentPropsFormatted, null, 2), "", `Previous Chapter ${previousPropertiesData.sourceChapter} Properties:`, JSON.stringify(previousPropsFormatted, null, 2), "", "Analyze which properties from the previous chapter should be carried forward."] :
        [`Current chapter properties for location "${entityName}":`, JSON.stringify(currentPropsFormatted), "", `Previous chapter properties for location "${entityName}":`, JSON.stringify(previousPropsFormatted)];

      const message = messageLines.join("\n");

      try {
        // Call LLM to filter properties
        const result = await openRouterClient.sendRequest({
          promptOverride: graphPrompts[promptKey],
          modelOverride: graphPrompts[promptKey].openRouterModel,
          message: message,
          replacements: [
            {key: "NOVEL_TITLE", value: title || "Unknown"},
            {key: "AUTHOR", value: author || "Unknown"},
          ],
          mockResponse: isCharacter ?
            getMockCharacterPropertyFilterResponse(entityName, previousPropsFormatted, currentPropsFormatted) :
            getMockLocationPropertyFilterResponse(previousProperties),
        });

        if (result.error) {
          throw new Error(`${graphId} ${chapter} Error filtering ${entityType} properties for ${entityName}: ${result.error}`);
        }

        const filteredResult = result.result || result;
        const filteredProps = filteredResult.filteredProperties || [];
        const reasoning = filteredResult.reasoning || "No reasoning provided";

        // Track what was included and dropped
        const droppedProps = previousPropsFormatted.filter((prevProp) =>
          !filteredProps.some((fp) =>
            fp.relationship === prevProp.relationship &&
            fp.property === prevProp.property,
          ),
        );

        propertyDecisions[entityName] = {
          sourceChapter: previousPropertiesData.sourceChapter,
          included: filteredProps,
          dropped: droppedProps,
          reasoning: reasoning,
        };

        // Map filtered properties back to full property objects with source info
        const filteredWithSource = isCharacter ?
          filteredProps.map((p) => ({
            ...p,
            character: entityName,
            sourceChapter: previousPropertiesData.sourceChapter,
          })) :
          filteredProps.map((filtered) => {
            const original = previousProperties.find((p) =>
              p.relationship === filtered.relationship &&
              p.property === filtered.property,
            );
            return original || {...filtered, location: entityName, sourceChapter: previousPropertiesData.sourceChapter};
          });

        // Combine current properties with filtered previous properties
        // Deduplicate: remove properties from filteredWithSource that have exact matches in currentEntityProperties
        const dedupedFilteredProperties = filteredWithSource.filter((filtered) =>
          !currentEntityProperties.some((current) =>
            current.relationship === filtered.relationship &&
            current.property === filtered.property,
          ),
        );

        const combinedProperties = [
          ...currentEntityProperties,
          ...dedupedFilteredProperties,
        ];

        logger.debug(`${graphId} ${entityType} ${entityName}: ${currentEntityProperties.length} current + ${filteredWithSource.length} filtered previous properties`);

        return {
          [entityKey]: entityName,
          properties: combinedProperties,
        };
      } catch (error) {
        logger.error(`${graphId} Error filtering ${entityType} properties for ${entityName}: ${error.message}`);
        // On error, just use current properties to avoid blocking
        return {
          [entityKey]: entityName,
          properties: currentEntityProperties,
        };
      }
    });

    return Promise.all(entityPromises);
  }

  // Process characters
  const characterResults = await processEntityProperties(
      "character",
      currentChapterProperties,
      continuityMapping,
      propertiesFromContinuity,
      characterPropertyDecisions,
  );

  // Process locations
  const locationResults = await processEntityProperties(
      "location",
      currentChapterLocationProperties,
      continuityMapping,
      propertiesFromContinuity,
      locationPropertyDecisions,
  );

  // Flatten character properties into a single array
  const allCharacterProperties = [];
  for (const result of characterResults) {
    allCharacterProperties.push(...result.properties);
  }

  // Flatten location properties into a single array
  const allLocationProperties = [];
  for (const result of locationResults) {
    allLocationProperties.push(...result.properties);
  }

  logger.debug(`${graphId} Filtered character continuity properties: ${allCharacterProperties.length} total properties for ${characterResults.length} characters`);
  logger.debug(`${graphId} Filtered location continuity properties: ${allLocationProperties.length} total properties for ${locationResults.length} locations`);

  // Store the property inclusion/exclusion analysis
  await storeGraph({
    sku,
    data: characterPropertyDecisions,
    type: "characterProperties-analysis",
    graphId,
    chapter,
  });

  await storeGraph({
    sku,
    data: locationPropertyDecisions,
    type: "locationProperties-analysis",
    graphId,
    chapter,
  });

  return {
    characters: {
      properties: allCharacterProperties,
    },
    locations: {
      properties: allLocationProperties,
    },
  };
}

export {
  graphConsolidatePropertiesByChapter,
};

