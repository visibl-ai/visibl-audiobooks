import analyticsManager from "./manager.js";
import {getValidStages} from "../graph/v0.1/pipelineSteps.js";

/**
 * Book Pipeline Analytics Class
 * @class
 * @description Tracks the complete book processing pipeline from import to graph completion.
 * This is separate from LLM analytics and focuses on pipeline performance metrics.
 */
class BookPipelineAnalytics {
  /**
   * Constructor for BookPipelineAnalytics
   * @constructor
   */
  constructor() {
    this.analyticsManager = analyticsManager;
    this.initPromise = null;
  }

  /**
   * Ensure analytics manager is initialized
   * @return {Promise<boolean>} Whether initialization was successful
   */
  async ensureInitialized() {
    try {
      // If already initialized, return immediately
      if (this.analyticsManager.isConfigured()) {
        return true;
      }

      // If initialization is in progress, wait for it
      if (this.initPromise) {
        return await this.initPromise;
      }

      // Start initialization
      this.initPromise = this.analyticsManager.initialize();
      const result = await this.initPromise;
      this.initPromise = null;
      return result;
    } catch (error) {
      console.warn("[BookPipelineAnalytics] Error initializing analytics:", error.message);
      return false;
    }
  }

  /**
   * Get the raw PostHog client instance
   * @return {Object|null} The PostHog client or null
   */
  getPostHogClient() {
    try {
      const provider = this.analyticsManager.getProvider();
      if (!provider || !provider.client) {
        return null;
      }
      return provider.client;
    } catch (error) {
      console.warn("[BookPipelineAnalytics] Error getting PostHog client:", error.message);
      return null;
    }
  }

  /**
   * Capture an event directly using PostHog client
   * @param {Object} event - The event object with distinctId, event, properties, groups
   */
  async capture(event) {
    try {
      // Ensure analytics is initialized
      await this.ensureInitialized();

      const client = this.getPostHogClient();
      if (!client) {
        console.warn("[BookPipelineAnalytics] PostHog client not initialized");
        return;
      }

      // Use PostHog's capture method directly
      client.capture(event);
    } catch (error) {
      console.warn("[BookPipelineAnalytics] Error capturing event:", error.message);
    }
  }

  /**
   * Track the start of a book import process
   * @param {string} uid - The user ID
   * @param {string} sku - The SKU of the book
   * @param {string} bookTitle - The title of the book
   * @param {string} bookAuthor - The author of the book
   * @param {string} source - The source of the book
   * @param {string} entryType - The type of entry
   */
  async trackBookImportStarted({uid, sku, bookTitle, bookAuthor, source, entryType}) {
    try {
      const event = {
        event: "book_pipeline_started",
        distinctId: uid,
        properties: {
          pipeline_stage: "import_initiated",
          sku,
          book_title: bookTitle,
          book_author: bookAuthor,
          source, // 'admin', 'user', 'api'
          entry_type: entryType, // 'generateTranscriptions', 'processPrivateM4B', etc.
          timestamp: Date.now(),
        },
        groups: {
          sku,
        },
      };

      await this.capture(event);
    } catch (error) {
      console.warn("[BookPipelineAnalytics] Error tracking book import started:", error.message);
    }
  }

  /**
   * Track when a book is added to a user's library
   * @param {string} uid - The user ID
   * @param {string} sku - The SKU of the book
   * @param {string} source - The source of the addition ('import', 'purchase', 'admin', 'share', etc.)
   * @param {boolean} graphAvailable - Whether a graph is already available for this book
   * @param {object} metadata - Additional metadata about the book addition
   */
  async trackBookAddedToLibrary({uid, sku, source, graphAvailable = false, metadata = {}}) {
    try {
      const event = {
        event: "book_added_to_library",
        distinctId: uid,
        properties: {
          sku,
          source, // 'import', 'purchase', 'admin', 'share', etc.
          graph_available: graphAvailable, // Whether a graph exists for this book
          ...metadata,
          timestamp: Date.now(),
        },
        groups: {
          sku,
        },
      };

      await this.capture(event);
    } catch (error) {
      console.warn("[BookPipelineAnalytics] Error tracking book added to library:", error.message);
    }
  }

  /**
   * Track transcription stage events
   * @param {string} uid - The user ID
   * @param {string} sku - The SKU of the book
   * @param {string} stage - The stage of the transcription
   * @param {string} status - The status of the transcription
   * @param {object} metadata - The metadata of the transcription
   */
  async trackTranscriptionStage({uid, sku, stage, status, metadata = {}}) {
    try {
      const validStages = ["preparing", "metadata", "transcribing", "validating", "saving", "cleanup"];

      if (!validStages.includes(stage)) {
        console.warn(`[BookPipelineAnalytics] Invalid transcription stage: ${stage}`);
        return;
      }

      const event = {
        event: "book_transcription_stage",
        distinctId: uid,
        properties: {
          pipeline_stage: "transcription",
          transcription_stage: stage,
          sku,
          status, // 'started', 'completed', 'failed'
          ...metadata,
          timestamp: Date.now(),
        },
        groups: {
          sku,
        },
      };

      await this.capture(event);
    } catch (error) {
      console.warn("[BookPipelineAnalytics] Error tracking transcription stage:", error.message);
    }
  }

  /**
   * Track when transcription is complete
   * @param {string} uid - The user ID
   * @param {string} sku - The SKU of the book
   * @param {number} numChapters - The number of chapters in the book
   * @param {object} metadata - The metadata of the transcription
   */
  async trackTranscriptionCompleted({uid, sku, numChapters, metadata = {}}) {
    try {
      const event = {
        event: "book_transcription_completed",
        distinctId: uid,
        properties: {
          pipeline_stage: "transcription_completed",
          sku,
          num_chapters: numChapters,
          ...metadata,
          timestamp: Date.now(),
        },
        groups: {
          sku,
        },
      };

      await this.capture(event);
    } catch (error) {
      console.warn("[BookPipelineAnalytics] Error tracking transcription completed:", error.message);
    }
  }

  /**
   * Track graph generation initiation
   * @param {string} uid - The user ID
   * @param {string} sku - The SKU of the book
   * @param {string} graphId - The ID of the graph
   * @param {string} version - The version of the graph
   * @param {string} generationType - Type of generation: 'initial' (first graph) or 'incremental' (additional chapters)
   * @param {number} [startChapter] - Optional starting chapter for the graph
   * @param {number} [endChapter] - Optional ending chapter for the graph
   */
  async trackGraphGenerationStarted({uid, sku, graphId, version, generationType = "initial", startChapter, endChapter}) {
    try {
      const event = {
        event: "book_graph_generation_started",
        distinctId: uid,
        properties: {
          pipeline_stage: "graph_initiated",
          sku,
          graph_id: graphId,
          graph_version: version,
          generation_type: generationType, // 'initial' or 'incremental'
          ...(startChapter !== undefined && {start_chapter: startChapter}),
          ...(endChapter !== undefined && {end_chapter: endChapter}),
          timestamp: Date.now(),
        },
        groups: {
          sku,
          graph_id: graphId,
        },
      };

      await this.capture(event);
    } catch (error) {
      console.warn("[BookPipelineAnalytics] Error tracking graph generation started:", error.message);
    }
  }

  /**
   * Track individual graph pipeline stages
   * @param {string} uid - The user ID
   * @param {string} sku - The SKU of the book
   * @param {string} graphId - The ID of the graph
   * @param {string} stage - The stage of the graph pipeline
   * @param {string} status - The status of the graph pipeline
   * @param {number} progress - The progress of the graph pipeline
   * @param {object} metadata - The metadata of the graph pipeline
   */
  async trackGraphPipelineStage({uid, sku, graphId, stage, status, progress, metadata = {}}) {
    try {
      const validStages = getValidStages();

      if (!validStages.includes(stage)) {
        console.warn(`[BookPipelineAnalytics] Invalid graph pipeline stage: ${stage}`);
        return;
      }

      const event = {
        event: `graph_pipeline_${stage}`,
        distinctId: uid,
        properties: {
          pipeline_stage: "graph_processing",
          graph_stage: stage,
          sku,
          graph_id: graphId,
          status, // 'started', 'completed', 'failed'
          progress_percentage: progress,
          ...metadata,
          timestamp: Date.now(),
        },
        groups: {
          sku,
          graph_id: graphId,
        },
      };

      await this.capture(event);
    } catch (error) {
      console.warn("[BookPipelineAnalytics] Error tracking graph pipeline stage:", error.message);
    }
  }

  /**
   * Track graph generation completion
   * @param {string} uid - The user ID
   * @param {string} sku - The SKU of the book
   * @param {string} graphId - The ID of the graph
   * @param {string} generationType - Type of generation: 'initial' (first graph) or 'incremental' (additional chapters)
   * @param {object} metadata - The metadata of the graph generation
   */
  async trackGraphGenerationCompleted({uid, sku, graphId, generationType = "initial", metadata = {}}) {
    try {
      const event = {
        event: "book_graph_generation_completed",
        distinctId: uid,
        properties: {
          pipeline_stage: "graph_completed",
          sku,
          graph_id: graphId,
          generation_type: generationType, // 'initial' or 'incremental'
          ...metadata,
          timestamp: Date.now(),
        },
        groups: {
          sku,
          graph_id: graphId,
        },
      };

      await this.capture(event);
    } catch (error) {
      console.warn("[BookPipelineAnalytics] Error tracking graph generation completed:", error.message);
    }
  }

  /**
   * Track pipeline failures
   * @param {string} uid - The user ID
   * @param {string} sku - The SKU of the book
   * @param {string} graphId - The ID of the graph
   * @param {string} stage - The stage of the pipeline failure
   * @param {object} error - The error of the pipeline failure
   * @param {object} metadata - The metadata of the pipeline failure
   */
  async trackPipelineFailure({uid, sku, graphId, stage, error, metadata = {}}) {
    try {
      const event = {
        event: "book_pipeline_failed",
        distinctId: uid,
        properties: {
          pipeline_stage: "pipeline_failed",
          failure_stage: stage,
          sku,
          graph_id: graphId,
          error_message: error?.message || "Unknown error",
          error_code: error?.code,
          ...metadata,
          timestamp: Date.now(),
        },
        groups: {
          sku,
          ...(graphId && {graph_id: graphId}),
        },
      };

      await this.capture(event);
    } catch (captureError) {
      console.warn("[BookPipelineAnalytics] Error tracking pipeline failure:", captureError.message);
    }
  }
}

// Singleton instance
let instance;

/**
 * Get singleton instance of BookPipelineAnalytics
 * @return {BookPipelineAnalytics} The singleton instance of BookPipelineAnalytics
 */
function getInstance() {
  if (!instance) {
    instance = new BookPipelineAnalytics();
  }
  return instance;
}

export {BookPipelineAnalytics, getInstance};
