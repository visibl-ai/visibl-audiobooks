/**
 * Graph Pipeline Configuration
 * Contains pipeline step weights and user-friendly descriptions for progress tracking
 */

// Transcription step weights and descriptions
export const transcriptionSteps = {
  preparing: {weight: 15, description: {"en": "Summoning audio streams ✨"}},
  metadata: {weight: 15, description: {"en": "Peeking at the track's secrets 🔮"}},
  transcribing: {weight: 30, description: {"en": "Turning sound into words ✍️"}},
  validating: {weight: 10, description: {"en": "Checking the words are true ✅"}},
  saving: {weight: 5, description: {"en": "Stashing transcripts safely 💾"}},
  cleanup: {weight: 5, description: {"en": "Tidying up the workshop 🧹"}},
};

// Pipeline step weights and descriptions for v0.1
export const pipelineStepsV01 = {
  correctTranscriptions: {
    weight: 5,
    description: {
      "en": "Polishing transcripts with a dash of AI ✨",
    },
  },
  entitiesByChapter: {
    weight: 5,
    description: {
      "en": "Mapping who's where 🗺️",
    },
  },
  entityProperties: {
    weight: 5,
    description: {
      "en": "Noting traits and details ✍️",
    },
  },
  entityContinuity: {
    weight: 10,
    description: {
      "en": "Keeping names and facts consistent 🔗",
    },
  },
  consolidateEntityProperties: {
    weight: 10,
    description: {
      "en": "Merging clues into one dossier 📚",
    },
  },
  generateEntityImagePrompts: {
    weight: 10,
    description: {
      "en": "Conjuring image prompts for cast and places ✨",
    },
  },
  summarizeEntityImagePrompts: {
    weight: 10,
    description: {
      "en": "Tidying and summarizing ✂️",
    },
  },
  generateScenes: {
    weight: 10,
    description: {
      "en": "Carving the story into scenes 🎬",
    },
  },
  augmentScenePrompts: {
    weight: 10,
    description: {
      "en": "Enhancing scene descriptions 🎨",
    },
  },
  updateSceneCache: {
    weight: 10,
    description: {
      "en": "Making the scenes amazing 🌟",
    },
  },
  generateCharacterImages: {
    weight: 15,
    description: {
      "en": "Painting character portraits 🖼️",
    },
  },
  generateCharacterProfileImages: {
    weight: 15,
    description: {
      "en": "Crafting profile portraits 🎭",
    },
  },
  generateLocationImages: {
    weight: 15,
    description: {
      "en": "Painting worlds and places 🏞️",
    },
  },
};

// Special status messages for transcription
export const transcriptionStatusMessages = {
  starting: {
    "en": "Starting transcription",
  },
};

// Special status messages for graph generation
export const graphStatusMessages = {
  initializing: {
    "en": "Initializing graph generation",
  },
  complete: {
    "en": "Graph generation complete",
  },
  finalizing: {
    "en": "Finalizing graph generation",
  },
};

/**
 * Retry Configuration for Graph Pipeline Steps
 */

/**
 * Maximum number of retry attempts for failed graph pipeline steps
 * This controls how many times a failed step will be retried before being marked as terminal error
 */
export const GRAPH_PIPELINE_RETRY_LIMIT = parseInt(process.env.GRAPH_PIPELINE_RETRY_LIMIT || "3", 10);

/**
 * Initial delay in milliseconds for exponential backoff on graph pipeline step retries
 * Default: 5000ms (5 seconds)
 */
export const GRAPH_PIPELINE_RETRY_INITIAL_DELAY = parseInt(process.env.GRAPH_PIPELINE_RETRY_INITIAL_DELAY || "5000", 10);

/**
 * Maximum delay in milliseconds for exponential backoff
 * Default: 30000ms (30 seconds) to prevent excessively long waits
 */
export const GRAPH_PIPELINE_RETRY_MAX_DELAY = parseInt(process.env.GRAPH_PIPELINE_RETRY_MAX_DELAY || "30000", 10);

/**
 * Exponential backoff multiplier (e.g., 2 = double the delay each retry)
 * Default: 2 for standard exponential backoff
 */
export const GRAPH_PIPELINE_RETRY_BACKOFF_MULTIPLIER = parseFloat(process.env.GRAPH_PIPELINE_RETRY_BACKOFF_MULTIPLIER || "2");
