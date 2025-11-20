import logger from "../../util/logger.js";
import {TRANSCRIPTION_CHUNK_MULTIPLIER} from "../../config/config.js";
import {getMetaData} from "../../audio/audioMetadata.js";
import {prepareAudioStreams, cleanupAudioFiles} from "./audioProcessor.js";
import {bookImportQueue} from "../queue/bookImportQueue.js";
import {transcribeChaptersWithQueue, validateTranscriptions} from "./transcriptionProcessorWithQueue.js";
import {
  transcriptionQueue,
  validateAndSetupTranscriptionParams,
} from "./transcriptionCorrector.js";
import {
  getTranscriptionsPath,
  saveUncorrectedTranscriptions,
  loadTranscriptions,
} from "./transcriptionStorage.js";
import {checkAndInitiateGraphGeneration} from "../../util/graphGenerationHelper.js";
import {libraryUpdateTranscriptionStatusRtdb} from "../../storage/realtimeDb/library.js";
import {catalogueGetRtdb} from "../../storage/realtimeDb/catalogue.js";
import CatalogueProgressTracker from "../../storage/realtimeDb/CatalogueProgressTracker.js";
import {stichTranscriptionChapters} from "../../util/transcribe.js";
import {getInstance as getAnalytics} from "../../analytics/bookPipelineAnalytics.js";

const NUM_THREADS = 4; // 32 GB instances have 8 cores. Let each ffmpeg process run 2 threads.

/**
 * Process private M4B files by dispatching to a separate task
 * @param {Object} params - The parameters
 * @param {string} params.uid - User ID
 * @param {Object} params.item - Item containing SKU
 * @param {number} params.numThreads - Number of threads to use
 * @return {Object} Success response
 */
async function processPrivateM4B({uid, item, numThreads = NUM_THREADS}) {
  logger.debug(JSON.stringify(item));
  const sku = item.sku;
  logger.debug(`processPrivateM4B: Processing FileName: ${sku} for ${uid} with ${numThreads} threads`);

  // Check if graph is already in progress or completed
  const catalogueItem = await catalogueGetRtdb({sku});

  if (catalogueItem?.graphProgress?.inProgress) {
    logger.warn(`Aborting processPrivateM4B for ${sku}: Graph generation already in progress`);
    return {success: false, message: "Graph generation already in progress for this item"};
  }

  if (catalogueItem?.graphAvailable || catalogueItem?.defaultGraphId) {
    logger.warn(`Aborting processPrivateM4B for ${sku}: Graph already completed`);
    return {success: false, message: "Graph already completed for this item"};
  }

  // Add the transcription task to the BookImportQueue
  await bookImportQueue.addToQueue({
    model: "default",
    params: {
      uid,
      sku,
      entryType: "bookImport",
    },
    estimatedTokens: 0,
  });

  return {success: true, message: "Book process dispatched"};
}

/**
 * Generate transcriptions for an audiobook
 * @param {Object} params - The parameters
 * @param {string} params.uid - User ID
 * @param {Object} params.item - Item containing SKU
 * @param {number} params.numThreads - Number of threads to use
 * @param {string} params.entryType - Type of entry (must be "m4b")
 * @return {Object} Transcription path and metadata
 */
async function generateTranscriptions({uid, item, numThreads = NUM_THREADS, entryType}) {
  logger.debug(JSON.stringify(item));
  const sku = item.sku;
  logger.debug(`generateTranscriptions: Processing FileName: ${sku} for ${uid} with ${numThreads} threads`);

  if (entryType !== "m4b") {
    throw new Error("Only m4b is supported");
  }

  const analytics = getAnalytics();

  // 1. Prepare audio streams
  await CatalogueProgressTracker.updateProgress(sku, {transcriptionStep: "preparing"});

  await analytics.trackTranscriptionStage({
    uid,
    sku,
    stage: "preparing",
    status: "started",
  });

  const {chunkPlan, chapters, chapterToChunksMap} = await prepareAudioStreams({uid, sku});

  await analytics.trackTranscriptionStage({
    uid,
    sku,
    stage: "preparing",
    status: "completed",
    metadata: {
      numChunks: chunkPlan?.length,
      numChapters: chapters?.length,
    },
  });

  // 2. Get metadata
  await CatalogueProgressTracker.updateProgress(sku, {transcriptionStep: "metadata"});

  await analytics.trackTranscriptionStage({
    uid,
    sku,
    stage: "metadata",
    status: "started",
  });

  const metadata = await getMetaData(uid, sku);

  await analytics.trackTranscriptionStage({
    uid,
    sku,
    stage: "metadata",
    status: "completed",
    metadata: {
      bookTitle: metadata?.bookData?.title,
      bookAuthor: metadata?.bookData?.author,
    },
  });

  // 3. Transcribe all chapter chunks and merge them
  await CatalogueProgressTracker.updateProgress(sku, {transcriptionStep: "transcribing"});

  await analytics.trackTranscriptionStage({
    uid,
    sku,
    stage: "transcribing",
    status: "started",
  });

  const transcriptions = await transcribeChaptersWithQueue({
    bookData: metadata.bookData,
    chunkFiles: chapters,
    chapterToChunksMap,
    chunkPlan,
    sku,
    uid,
  });

  await analytics.trackTranscriptionStage({
    uid,
    sku,
    stage: "transcribing",
    status: "completed",
    metadata: {
      numChaptersTranscribed: Object.keys(transcriptions).filter((key) => key !== "error").length,
    },
  });

  // 4. Validate transcriptions
  await CatalogueProgressTracker.updateProgress(sku, {transcriptionStep: "validating"});

  await analytics.trackTranscriptionStage({
    uid,
    sku,
    stage: "validating",
    status: "started",
  });

  validateTranscriptions(transcriptions, sku);
  logger.debug(`generateTranscriptions: STEP 5: Transcriptions Complete for ${sku}`);

  await analytics.trackTranscriptionStage({
    uid,
    sku,
    stage: "validating",
    status: "completed",
  });

  // 5. Save uncorrected transcriptions (raw and main)
  await CatalogueProgressTracker.updateProgress(sku, {transcriptionStep: "saving"});

  await analytics.trackTranscriptionStage({
    uid,
    sku,
    stage: "saving",
    status: "started",
  });

  await saveUncorrectedTranscriptions({uid, sku, transcriptions, identifier: "raw"});
  await saveUncorrectedTranscriptions({uid, sku, transcriptions});

  // Mark all chapters as ready since raw transcriptions are now available
  logger.debug(`generateTranscriptions: Marking all chapters as ready for ${sku}`);
  const chapterIndices = Object.keys(transcriptions).filter((key) => key !== "error");
  await Promise.all(
      chapterIndices.map((chapter) =>
        libraryUpdateTranscriptionStatusRtdb({uid, sku, chapter, status: "ready"}),
      ),
  );
  logger.debug(`generateTranscriptions: Marked ${chapterIndices.length} chapters as ready for ${sku}`);

  await analytics.trackTranscriptionStage({
    uid,
    sku,
    stage: "saving",
    status: "completed",
    metadata: {
      numChaptersSaved: chapterIndices.length,
    },
  });

  // 6. Clean up local audio files
  await CatalogueProgressTracker.updateProgress(sku, {transcriptionStep: "cleanup"});

  await analytics.trackTranscriptionStage({
    uid,
    sku,
    stage: "cleanup",
    status: "started",
  });

  await cleanupAudioFiles({uid, sku, chapters});

  // Mark transcription as complete
  await CatalogueProgressTracker.updateProgress(sku, {transcriptionStep: "cleanup", stepProgress: 100});

  await analytics.trackTranscriptionStage({
    uid,
    sku,
    stage: "cleanup",
    status: "completed",
  });

  // Track complete transcription completion
  await analytics.trackTranscriptionCompleted({
    uid,
    sku,
    numChapters: chapterIndices.length,
    metadata: {
      bookTitle: metadata?.bookData?.title,
      bookAuthor: metadata?.bookData?.author,
    },
  });

  // 7. Initiate graph generation for this specific book
  await checkAndInitiateGraphGeneration({uid, sku});

  // Return the transcription path
  const transcriptionPath = getTranscriptionsPath({uid, sku});
  return {transcriptions: transcriptionPath, metadata: metadata.bookData};
}

/**
 * Correct transcriptions for a given chapter
 * @param {string} uid - User ID
 * @param {string} sku - Book SKU
 * @param {number} chapter - Chapter number
 * @return {Promise<Object>} The corrected transcriptions
 */
async function correctTranscriptions({uid, graphId, sku, chapter}) {
  const metadata = await getMetaData(uid, sku);
  const transcription = await loadTranscriptions({uid, sku});
  const chapterTranscription = transcription[chapter];
  await correctTranscriptionsBatch({uid, graphId, sku, sortedChapters: [[chapter, chapterTranscription]], metadata});
}

/**
 * Corrects transcriptions in batch using LLM
 * @param {Object} params - The parameters
 * @param {string} params.uid - User ID
 * @param {string} params.graphId - Graph ID
 * @param {string} params.sku - Book SKU
 * @param {Array} params.sortedChapters - Array of [chapter, transcription] pairs
 * @param {Object} params.metadata - Book metadata containing title and author
 * @return {Promise<void>}
 */
async function correctTranscriptionsBatch({uid, graphId, sku, sortedChapters, metadata}) {
  const totalChapters = sortedChapters.length;

  // Handle empty chapters
  if (totalChapters === 0) {
    logger.warn(`No chapters to correct for ${sku}, skipping correction`);
    return;
  }

  const batchId = `transcription_${uid}_${sku}_${Date.now()}`;
  logger.debug(`Starting batch transcription correction with batchId: ${batchId} for ${totalChapters} chapters`);

  // Queue all chapters for correction with the same batchId
  // Process all chapters in parallel
  const queuePromises = sortedChapters.map(async ([chapter, transcription]) => {
    await libraryUpdateTranscriptionStatusRtdb({uid, sku, chapter, status: "processing"});

    const queueResult = await sendTranscriptionToLlmWithQueue({
      uid,
      graphId,
      sku,
      chapter,
      prompt: "correctTranscription",
      replacements: [
        {key: "TITLE", value: metadata.bookData.title},
        {key: "AUTHOR", value: metadata.bookData.author},
      ],
      message: transcription,
      batchId,
      awaitCompletion: true, // We wait for the transcription to be processed
    });

    return {chapter, result: queueResult};
  });

  const queueResults = await Promise.all(queuePromises);
  const validResults = queueResults.filter((item) => item.result !== null);

  logger.debug(`Added and processed ${validResults.length} entries to queue for batch ${batchId}`);

  // After all parallel processing is complete, stitch all chapters into the main file at once
  if (validResults.length > 0) {
    await stichTranscriptionChapters({uid, sku, chapters: validResults});
  }

  // Trigger queue processing
  logger.debug(`Triggering queue processing for batch ${batchId}`);
  await transcriptionQueue.processQueue();
}

/**
 * Send the transcription to the LLM for correction with a queue
 * @param {string} uid - The UID of the user
 * @param {string} graphId - The graph ID
 * @param {string} sku - The SKU of the book
 * @param {number} chapter - The chapter number
 * @param {string} prompt - The prompt to use
 * @param {array} replacements - The replacements to use
 * @param {array} message - The array of message objects to send to the LLM
 * @param {boolean} retry - Whether to retry the transcription
 * @param {boolean} awaitCompletion - Whether to wait for the transcription to be processed
 * @param {string} batchId - Optional batch ID to group related transcription tasks
 * @param {number} chunkMultiplier - The multiplier for the number of chunks
 * @param {object} providerOverride - Override the default provider
 * @param {string} modelOverride - Override the default model
 * @param {string} unique - Optional unique identifier for the queue entry (defaults to datetime YYYYMMDDHHMM)
 * @return {Promise<array|null>} - The corrected transcription or null if not awaiting completion
 */
async function sendTranscriptionToLlmWithQueue({
  uid,
  graphId,
  sku,
  chapter,
  prompt,
  replacements = [],
  message = [],
  retry = false,
  awaitCompletion = false,
  batchId = null,
  chunkMultiplier = parseInt(TRANSCRIPTION_CHUNK_MULTIPLIER.value()),
  providerOverride = {},
  modelOverride = null,
  unique = null,
}) {
  // Use the same validation and setup as the main function
  const validatedParams = validateAndSetupTranscriptionParams({
    uid,
    graphId,
    sku,
    chapter,
    prompt,
    replacements,
    message,
    retry,
    chunkMultiplier,
    providerOverride,
    modelOverride,
    unique,
  });

  await transcriptionQueue.addToQueue({
    model: validatedParams.model,
    params: {
      entryType: "transcription",
      uid,
      graphId,
      sku,
      chapter,
      prompt,
      replacements,
      message: validatedParams.message,
      retry,
      chunkMultiplier,
      providerOverride,
      modelOverride,
      unique,
    },
    estimatedTokens: validatedParams.tokenCount,
    batchId,
  });

  if (awaitCompletion) {
    await transcriptionQueue.processQueueAndWait({batchId});
    // Get the results from the bucket
    const transcription = await loadTranscriptions({uid, sku, chapter});
    return transcription;
  }

  await transcriptionQueue.processQueue();
  return null;
}

export {
  generateTranscriptions,
  processPrivateM4B,
  sendTranscriptionToLlmWithQueue,
  correctTranscriptions,
};
