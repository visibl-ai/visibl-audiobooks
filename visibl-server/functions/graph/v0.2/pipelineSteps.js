/**
 * Pipeline steps configuration for GraphPipelineV0_2
 * This is a separate file to avoid circular dependencies
 */

export const PIPELINE_STEPS = {
  ENTITIES_BY_CHAPTER: "entitiesByChapter",
  ENTITY_PROPERTIES: "entityProperties",
  ENTITY_CONTINUITY: "entityContinuity",
  CONSOLIDATE_ENTITY_PROPERTIES: "consolidateEntityProperties",
  GENERATE_ENTITY_IMAGE_PROMPTS: "generateEntityImagePrompts",
  SUMMARIZE_ENTITY_IMAGE_PROMPTS: "summarizeEntityImagePrompts",
  GENERATE_SCENES: "generateScenes",
  AUGMENT_SCENE_PROMPTS: "augmentScenePrompts",
  UPDATE_SCENE_CACHE: "updateSceneCache",
  GENERATE_CHARACTER_IMAGES: "generateCharacterImages",
  GENERATE_CHARACTER_PROFILE_IMAGES: "generateCharacterProfileImages",
  GENERATE_LOCATION_IMAGES: "generateLocationImages",
};

/**
 * Steps that were removed from the pipeline but can still appear on existing graphs
 * (nextGraphStep) and queue entries (entryType) created before the removal.
 */
export const LEGACY_PIPELINE_STEPS = {
  CORRECT_TRANSCRIPTIONS: "correctTranscriptions",
};

/**
 * Get all valid pipeline stage values
 * @return {string[]} Array of valid stage values
 */
export function getValidStages() {
  return Object.values(PIPELINE_STEPS);
}

/**
 * Get every entry type a graph queue doc may carry, including legacy steps, for looking up
 * existing queue docs by their deterministic IDs
 * @return {string[]} Current and legacy step values
 */
export function getQueueEntryTypes() {
  return [...getValidStages(), ...Object.values(LEGACY_PIPELINE_STEPS)];
}
