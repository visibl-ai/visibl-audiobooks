/* eslint-disable camelcase */

import logger from "../../../util/logger.js";
import {createAnalyticsOptions} from "../../../analytics/index.js";
import graphPrompts from "../graphV0_1Prompts.js";
import {OpenRouterClient, OpenRouterMockResponse} from "../../../ai/openrouter/base.js";
import {storeGraph} from "../../../storage/storage.js";
import {getAuthorAndTitleFromSku, fetchGraphEntityArray} from "../../../util/graphHelper.js";

/**
 * Generate mock continuity matches response for testing
 * @param {string} entityType - Type of entity ("character" or "location")
 * @param {string} currentEntityList - Current chapter entity list
 * @param {string} previousEntityList - Previous chapter entity list
 * @return {OpenRouterMockResponse} Mock response for testing
 */
function getMockContinuityMatchesResponse(entityType, currentEntityList, previousEntityList) {
  return new OpenRouterMockResponse({
    content: {
      matches: (() => {
        // Create mock matches between chapters
        const mockMatches = [];
        const entityTypePrefix = entityType === "character" ? "mockcharacter" : "mocklocation";

        // For testing, create some matches between chapters
        // Only match entities 01, 02, and 03 with high confidence
        // Match entity 04 with medium confidence
        // Don't match entity 05 (to simulate new entities)

        // Check if both chapters have the mock entities
        const currentHasMock01 = currentEntityList.includes(`${entityTypePrefix}01`);
        const previousHasMock01 = previousEntityList.includes(`${entityTypePrefix}01`);

        if (currentHasMock01 && previousHasMock01) {
          mockMatches.push({
            currentEntity: `${entityTypePrefix}01`,
            previousEntity: `${entityTypePrefix}01`,
            confidence: "high",
            reason: `Mock: Same ${entityType} name across chapters`,
          });
        }

        const currentHasMock02 = currentEntityList.includes(`${entityTypePrefix}02`);
        const previousHasMock02 = previousEntityList.includes(`${entityTypePrefix}02`);

        if (currentHasMock02 && previousHasMock02) {
          mockMatches.push({
            currentEntity: `${entityTypePrefix}02`,
            previousEntity: `${entityTypePrefix}02`,
            confidence: "high",
            reason: `Mock: Same ${entityType} name across chapters`,
          });
        }

        const currentHasMock03 = currentEntityList.includes(`${entityTypePrefix}03`);
        const previousHasMock03 = previousEntityList.includes(`${entityTypePrefix}03`);

        if (currentHasMock03 && previousHasMock03) {
          mockMatches.push({
            currentEntity: `${entityTypePrefix}03`,
            previousEntity: `${entityTypePrefix}03`,
            confidence: "high",
            reason: `Mock: Direct name match`,
          });
        }

        const currentHasMock04 = currentEntityList.includes(`${entityTypePrefix}04`);
        const previousHasMock04 = previousEntityList.includes(`${entityTypePrefix}04`);

        if (currentHasMock04 && previousHasMock04) {
          mockMatches.push({
            currentEntity: `${entityTypePrefix}04`,
            previousEntity: `${entityTypePrefix}04`,
            confidence: "medium",
            reason: `Mock: Likely the same ${entityType} based on context`,
          });
        }

        // Entity 05 is intentionally not matched to simulate new entities

        return mockMatches;
      })(),
    },
  });
}

/**
 * Main function to process entity continuity for a chapter
 * Compares current chapter entities with all previous chapters
 * and creates a comprehensive continuity mapping
 * @param {Object} params - Parameters for entity continuity
 * @param {string} params.uid - User ID
 * @param {string} params.sku - Book SKU
 * @param {string} params.visibility - Visibility setting
 * @param {string} params.graphId - Graph ID
 * @param {number} params.chapter - Current chapter number
 * @return {Promise<Object>} Continuity mapping for the chapter
 */
async function graphEntityContinuityByChapter(params) {
  const {uid, sku, visibility, graphId, chapter} = params;

  logger.debug(`${graphId} Processing entity continuity for chapter ${chapter}`);

  // Skip chapter 0 as it has no previous chapters
  if (chapter === 0) {
    logger.debug(`${graphId} Chapter 0 has no previous chapters, skipping continuity check`);
    const emptyContinuity = {
      characters: {},
      locations: {},
    };
    await storeGraph({
      sku,
      data: emptyContinuity,
      type: "continuity",
      graphId,
      chapter,
    });
    return emptyContinuity;
  }

  // Create a single OpenRouter client for all requests
  const openRouterClient = new OpenRouterClient();

  // Get author and title from SKU for LLM prompts
  const {author, title} = await getAuthorAndTitleFromSku(sku);

  // Load current chapter entities
  const currentCharacters = await fetchGraphEntityArray({
    uid,
    sku,
    visibility,
    type: "characters", // should this be referenced entities?
    chapter,
    graphId,
  });

  const currentLocations = await fetchGraphEntityArray({
    uid,
    sku,
    visibility,
    type: "locations", // should this be referenced entities?
    chapter,
    graphId,
  });

  // Load all previous chapter entities
  const previousChapterEntities = [];
  for (let prevChapter = 0; prevChapter < chapter; prevChapter++) {
    const chapterData = {chapter: prevChapter};

    chapterData.characters = await fetchGraphEntityArray({
      uid,
      sku,
      visibility,
      type: "characters", // should this be referenced entities?
      chapter: prevChapter,
      graphId,
    });

    chapterData.locations = await fetchGraphEntityArray({
      uid,
      sku,
      visibility,
      type: "locations",
      chapter: prevChapter,
      graphId,
    });

    previousChapterEntities.push(chapterData);
  }

  // Run parallel pairwise comparisons for all previous chapters
  const characterComparisons = [];
  const locationComparisons = [];

  for (const prevChapterData of previousChapterEntities) {
    // Compare characters
    if (currentCharacters.characters?.length > 0 && prevChapterData.characters.characters?.length > 0) {
      characterComparisons.push(
          crossReferenceEntitiesPairwise(
              currentCharacters.characters,
              prevChapterData.characters.characters,
              chapter,
              prevChapterData.chapter,
              "character",
              openRouterClient,
              {author, title},
              uid,
              graphId,
              sku,
          ),
      );
    }

    // Compare locations
    if (currentLocations.locations?.length > 0 && prevChapterData.locations.locations?.length > 0) {
      locationComparisons.push(
          crossReferenceEntitiesPairwise(
              currentLocations.locations,
              prevChapterData.locations.locations,
              chapter,
              prevChapterData.chapter,
              "location",
              openRouterClient,
              {author, title},
              uid,
              graphId,
              sku,
          ),
      );
    }
  }

  // Wait for all comparisons to complete
  const [characterResults, locationResults] = await Promise.all([
    Promise.all(characterComparisons),
    Promise.all(locationComparisons),
  ]);

  // Combine pairwise results into comprehensive mapping
  const continuityMapping = combinePairwiseMappings(
      characterResults,
      locationResults,
      currentCharacters.characters || [],
      currentLocations.locations || [],
      previousChapterEntities,
      chapter,
  );

  // Store the continuity mapping
  await storeGraph({
    sku,
    data: continuityMapping,
    type: "continuity",
    graphId,
    chapter,
  });

  // Property consolidation is now handled in a separate pipeline step

  logger.debug(`${graphId} Entity continuity completed for chapter ${chapter}`);
  return continuityMapping;
}

/**
 * Cross-reference entities between two chapters using LLM
 * @param {Array} currentChapterEntities - Entities from current chapter
 * @param {Array} previousChapterEntities - Entities from previous chapter
 * @param {number} currentChapter - Current chapter number
 * @param {number} previousChapter - Previous chapter number
 * @param {string} entityType - Type of entity ("character" or "location")
 * @param {OpenRouterClient} openRouterClient - OpenRouter client instance
 * @param {Object} metadata - Book metadata (author, title)
 * @param {string} uid - User ID for analytics
 * @param {string} graphId - Graph ID for analytics
 * @param {string} sku - Book SKU for analytics
 * @return {Promise<Object>} Pairwise entity matches
 */
async function crossReferenceEntitiesPairwise(
    currentChapterEntities,
    previousChapterEntities,
    currentChapter,
    previousChapter,
    entityType,
    openRouterClient,
    metadata,
    uid,
    graphId,
    sku,
) {
  try {
    const currentEntityList = formatEntityList(currentChapterEntities);
    const previousEntityList = formatEntityList(previousChapterEntities);

    // Determine which prompt to use based on entity type
    const promptKey = entityType === "character" ? "v0_1_character_continuity" : "v0_1_location_continuity";
    const entityLabel = entityType === "character" ? "characters" : "locations";

    const message = `Chapter ${currentChapter} ${entityLabel}:\n${currentEntityList}\n\nChapter ${previousChapter} ${entityLabel}:\n${previousEntityList}`;

    const result = await openRouterClient.sendRequest({
      promptOverride: graphPrompts[promptKey],
      modelOverride: graphPrompts[promptKey].openRouterModel,
      message: message,
      replacements: [
        {
          key: "NOVEL_TITLE",
          value: metadata.title || "Unknown",
        },
        {
          key: "AUTHOR",
          value: metadata.author || "Unknown",
        },
      ],
      mockResponse: getMockContinuityMatchesResponse(entityType, currentEntityList, previousEntityList),
      analyticsOptions: createAnalyticsOptions({uid, graphId, sku, promptId: promptKey}),
    });

    // Lowercase entity names in results for consistency
    const lowercasedMatches = (result.result?.matches || result.matches || []).map((match) => ({
      ...match,
      currentEntity: match.currentEntity?.toLowerCase(),
      previousEntity: match.previousEntity?.toLowerCase(),
    }));

    return {
      currentChapter,
      previousChapter,
      matches: lowercasedMatches,
    };
  } catch (error) {
    logger.error(`Error cross-referencing ${entityType}s between chapters ${currentChapter} and ${previousChapter}: ${error.message}`);
    return {
      currentChapter,
      previousChapter,
      matches: [],
    };
  }
}

/**
 * Format entity list for LLM prompt
 * @param {Array} entities - Array of entity objects with name and aliases
 * @return {string} Formatted entity list
 */
function formatEntityList(entities) {
  return entities.map((entity) => {
    const aliases = entity.aliases?.length > 0 ? ` (aliases: ${entity.aliases.join(", ")})` : "";
    return `- Name: ${entity.name}${aliases}`;
  }).join("\n");
}

/**
 * Combine pairwise comparison results into comprehensive continuity mapping
 * @param {Array} characterResults - Array of pairwise character comparisons
 * @param {Array} locationResults - Array of pairwise location comparisons
 * @param {Array} currentCharacters - Current chapter characters
 * @param {Array} currentLocations - Current chapter locations
 * @param {Array} previousChapterEntities - All previous chapter entities
 * @param {number} currentChapter - Current chapter number
 * @return {Object} Combined continuity mapping with alias aggregation
 */
function combinePairwiseMappings(
    characterResults,
    locationResults,
    currentCharacters,
    currentLocations,
    previousChapterEntities,
    currentChapter,
) {
  /**
   * Process entity matches for both characters and locations
   * @param {Array} currentEntities - Current chapter entities
   * @param {Array} pairwiseResults - Pairwise comparison results
   * @param {string} entityType - 'characters' or 'locations'
   * @return {Object} Continuity mapping for the entity type
   */
  function processEntityMatches(currentEntities, pairwiseResults, entityType) {
    const continuityMapping = {};

    for (const entity of currentEntities) {
      const entityName = entity.name;
      const continuityData = {
        appearsIn: [], // Don't include current chapter - it's implied
        firstAppearance: currentChapter,
        allAliases: [...new Set([...(entity.aliases || [])])],
      };

      // Check all pairwise results for matches
      for (const result of pairwiseResults) {
        const match = result.matches.find((m) =>
          m.currentEntity === entityName.toLowerCase() ||
          entity.aliases?.some((alias) => alias.toLowerCase() === m.currentEntity),
        );

        if (match && match.confidence !== "none") {
          // Found a match in a previous chapter
          const prevChapter = result.previousChapter;

          // Get the matched entity name from the previous chapter
          const prevChapterData = previousChapterEntities.find((p) => p.chapter === prevChapter);
          let matchedEntityName = match.previousEntity;

          if (prevChapterData) {
            const prevEntities = prevChapterData[entityType][entityType];
            const matchedEntity = prevEntities?.find((e) =>
              e.name.toLowerCase() === match.previousEntity ||
              e.aliases?.some((alias) => alias.toLowerCase() === match.previousEntity),
            );
            if (matchedEntity) {
              matchedEntityName = matchedEntity.name;
              // Aggregate aliases from the matched entity
              if (matchedEntity.aliases) {
                continuityData.allAliases.push(...matchedEntity.aliases);
              }
            }
          }

          // Add appearance as object with chapter key
          const appearanceObj = {};
          appearanceObj[prevChapter] = {
            name: matchedEntityName,
            confidence: match.confidence,
            reason: match.reason,
          };

          // Check if this chapter is already in appearsIn (avoid duplicates)
          const existingIndex = continuityData.appearsIn.findIndex((obj) => Object.prototype.hasOwnProperty.call(obj, prevChapter));
          if (existingIndex === -1) {
            continuityData.appearsIn.push(appearanceObj);
          }

          // Update first appearance
          if (prevChapter < continuityData.firstAppearance) {
            continuityData.firstAppearance = prevChapter;
          }
        }
      }

      // Sort appearances by chapter number
      continuityData.appearsIn.sort((a, b) => {
        const aChapter = parseInt(Object.keys(a)[0]);
        const bChapter = parseInt(Object.keys(b)[0]);
        return aChapter - bChapter;
      });

      // Deduplicate aliases
      continuityData.allAliases = [...new Set(continuityData.allAliases)];

      continuityMapping[entityName] = continuityData;
    }

    return continuityMapping;
  }

  // Process both entity types using the shared function
  const characterContinuity = processEntityMatches(currentCharacters, characterResults, "characters");
  const locationContinuity = processEntityMatches(currentLocations, locationResults, "locations");

  return {
    characters: characterContinuity,
    locations: locationContinuity,
  };
}

export {
  graphEntityContinuityByChapter,
};
