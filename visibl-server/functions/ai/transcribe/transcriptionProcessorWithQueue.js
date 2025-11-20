import logger from "../../util/logger.js";
import CatalogueProgressTracker from "../../storage/realtimeDb/CatalogueProgressTracker.js";
import {mergeChunkTranscriptions, validateTimingContinuity} from "../../audio/audioChunker.js";
import {groqQueue} from "../queue/groqQueue.js";
import {queueGetEntries} from "../../storage/firestore/queue.js";
import {getSplitAudioPath} from "../../audio/audioMetadata.js";
import path from "path";
import {shutdownAnalytics} from "../../analytics/index.js";

/**
 * Transcribe audio files using GroqQueue for all chapter chunks
 * @param {Object} bookData - Book metadata including title, author, and chapters
 * @param {Array} chunkFiles - Array of chunk file paths
 * @param {Object} chapterToChunksMap - Mapping of chapters to their chunks
 * @param {Object} chunkPlan - Chunk plan with metadata
 * @param {string} sku - Book SKU for progress tracking
 * @param {string} uid - User ID for determining bucket path
 * @return {Object} Transcriptions object with chapter indices as keys
 */
async function transcribeChaptersWithQueue({bookData, chunkFiles, chapterToChunksMap, chunkPlan, sku, uid}) {
  const transcriptions = {};
  const totalChunks = chunkFiles.length;

  const prompt = `The transcript is an audiobook version of ${bookData.title} by ${bookData.author}.`;

  // Get the bucket path for split audio files
  const bucketBasePath = getSplitAudioPath(uid, sku);

  // Generate batch ID for tracking all chunks
  const batchId = groqQueue.generateBatchId();
  logger.info(`transcribeChaptersWithQueue: Starting batch ${batchId} with ${totalChunks} chunks`);

  // Prepare all queue entries
  const queueEntries = [];
  const chunkToChapterMap = {};

  // Build queue entries for all chunks
  for (const [chapterIndex, chapterData] of Object.entries(chapterToChunksMap)) {
    const {chunkIndices, chunkFiles: chapterChunkFiles, chunkMetadata} = chapterData;

    logger.debug(
        `transcribeChaptersWithQueue: Preparing chapter ${chapterIndex} with ${chapterChunkFiles.length} chunks`,
    );

    for (let i = chunkIndices.start; i < chunkIndices.end; i++) {
      const chunkIndex = i - chunkIndices.start;
      const chunk = chunkMetadata[chunkIndex];
      const chunkFile = chunkFiles[i];

      // Convert local file path to bucket path
      const fileName = path.basename(chunkFile);
      const bucketPath = `${bucketBasePath}${fileName}`;

      // Map global chunk index to chapter and local chunk index
      chunkToChapterMap[i] = {
        chapterIndex,
        localChunkIndex: chunkIndex,
        chunkMetadata: chunk,
      };

      logger.debug(
          `transcribeChaptersWithQueue: Preparing chunk ${i + 1}/${totalChunks} - Chapter ${chapterIndex}, ` +
          `chunk ${chunkIndex} (${chunk.duration.toFixed(1)}s) from bucket: ${bucketPath}`,
      );

      // Create queue entry for this chunk
      queueEntries.push({
        model: "whisper-large-v3-turbo",
        params: {
          entryType: "whisperTranscribe",
          audioPath: bucketPath, // Use bucket path instead of local path
          offset: chunk.absoluteStartTime,
          prompt,
          chapter: chapterIndex,
          chunkIndex,
          chapterIndex,
          globalChunkIndex: i,
          uid,
          sku,
        },
        estimatedTokens: Math.ceil(chunk.duration * 10), // Rough estimate
        referenceKey: `${sku}_${Date.now()}_ch${chapterIndex}_chunk${chunkIndex}`,
      });
    }
  }

  logger.debug(`transcribeChaptersWithQueue: Adding ${queueEntries.length} chunks to GroqQueue`);

  // Add all entries to the queue as a batch, process, and wait for completion
  await groqQueue.addToQueueBatchAndWait({
    entries: queueEntries,
    batchId,
    metadata: {
      sku,
      totalChunks,
      bookTitle: bookData.title,
    },
    maxWaitTime: 300000, // 5 minutes
    pollInterval: 1000, // 1 second
    onProgress: async (status) => {
      const completedCount = status.completedItems + status.failedItems;
      const progress = Math.round((completedCount / totalChunks) * 100);
      logger.debug(`transcribeChaptersWithQueue: Batch ${batchId} progress: ${completedCount}/${totalChunks} (${progress}%)`);
      await CatalogueProgressTracker.updateProgress(sku, {
        transcriptionStep: "transcribing",
        stepProgress: progress,
      });
    },
  });

  logger.info(`transcribeChaptersWithQueue: Batch ${batchId} completed`);

  // Retrieve completed queue entries for this batch
  const batchEntries = await queueGetEntries({
    batchId,
    status: "complete",
    limit: totalChunks,
  });

  logger.debug(`transcribeChaptersWithQueue: Retrieved ${batchEntries.length} completed entries for batch ${batchId}`);

  // Organize results by chapter
  const chapterResults = {};

  for (const entry of batchEntries) {
    const params = await groqQueue.getParams({queueEntry: entry});
    const chapterIndex = params.chapterIndex;
    const chunkIndex = params.chunkIndex;

    if (!chapterResults[chapterIndex]) {
      chapterResults[chapterIndex] = [];
    }

    // Get the result (may need to fetch from GCS if large)
    let transcriptionResult = entry.result?.result;

    if (entry.result?.result?.resultGcsPath) {
      // Result is stored in GCS, need to fetch it
      transcriptionResult = await groqQueue.getAndDeleteResult({
        resultGcsPath: entry.result.result.resultGcsPath,
      });
    }

    chapterResults[chapterIndex].push({
      chunkIndex,
      transcription: transcriptionResult,
    });
  }

  // Process each chapter's results
  for (const [chapterIndex, chunkResults] of Object.entries(chapterResults)) {
    // Sort by chunk index to ensure correct order
    chunkResults.sort((a, b) => a.chunkIndex - b.chunkIndex);

    const chunkTranscriptions = [];
    let hasError = false;

    // Extract transcriptions in order
    for (const result of chunkResults) {
      if (typeof result.transcription === "object" && result.transcription.error) {
        hasError = true;
        if (!transcriptions.error) {
          transcriptions.error = {};
        }
        transcriptions.error[`${chapterIndex}_chunk_${result.chunkIndex}`] = result.transcription.error;
      } else {
        chunkTranscriptions.push(result.transcription);
      }
    }

    if (!hasError && chunkTranscriptions.length > 0) {
      // Get chunk metadata for this chapter
      const chapterData = chapterToChunksMap[chapterIndex];
      const chunkMetadata = chapterData.chunkMetadata;

      // Merge chunk transcriptions for this chapter
      if (chunkTranscriptions.length === 1) {
        // Single chunk - use as is
        transcriptions[chapterIndex] = chunkTranscriptions[0];
      } else {
        // Multiple chunks - merge them
        const mergedTranscription = mergeChunkTranscriptions(chunkTranscriptions, chunkMetadata);

        // Validate timing continuity
        if (!validateTimingContinuity(mergedTranscription)) {
          logger.warn(`Chapter ${chapterIndex}: Timing validation warning - potential discontinuity detected`);
        }

        transcriptions[chapterIndex] = mergedTranscription;
      }

      logger.debug(`transcribeChaptersWithQueue: Chapter ${chapterIndex} transcription complete with ${chunkTranscriptions.length} chunks merged`);
    } else if (!hasError) {
      // Empty transcription
      transcriptions[chapterIndex] = [];
    }
  }

  await shutdownAnalytics();
  return transcriptions;
}

/**
 * Validate transcriptions for errors
 * @param {Object} transcriptions - Transcriptions object
 * @param {string} sku - Book SKU for error messages
 * @throws {Error} If transcriptions are undefined or contain errors
 */
function validateTranscriptions(transcriptions, sku) {
  if (transcriptions === undefined) {
    logger.error(`validateTranscriptions: Transcriptions are undefined for ${sku}`);
    throw new Error(`Transcriptions are undefined for ${sku}`);
  }

  if (transcriptions.error) {
    logger.error(`validateTranscriptions: Transcriptions have errors: ${JSON.stringify(transcriptions.error)}`);
    throw new Error(`Transcriptions have errors: ${JSON.stringify(transcriptions.error)}`);
  }

  logger.debug(`validateTranscriptions: Transcriptions validated successfully for ${sku}`);
}

export {
  transcribeChaptersWithQueue,
  validateTranscriptions,
};
