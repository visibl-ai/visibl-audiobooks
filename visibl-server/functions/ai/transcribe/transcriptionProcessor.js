import whisper from "../groq/whisper.js";
import logger from "../../util/logger.js";
import CatalogueProgressTracker from "../../storage/realtimeDb/CatalogueProgressTracker.js";
import {mergeChunkTranscriptions, validateTimingContinuity} from "../../audio/audioChunker.js";

/**
 * Transcribe audio files in parallel for all chapter chunks
 * Now handles chunks and merges them back into chapter transcriptions
 * @param {Object} bookData - Book metadata including title, author, and chapters
 * @param {Array} outputStreams - Array of readable streams for each chunk
 * @param {Object} chapterToChunksMap - Mapping of chapters to their chunks
 * @param {Object} chunkPlan - Chunk plan with metadata
 * @param {Array} chunkFiles - Array of chunk file paths
 * @param {string} sku - Book SKU for progress tracking
 * @return {Object} Transcriptions object with chapter indices as keys
 */
async function transcribeChapters({bookData, outputStreams, chapterToChunksMap, chunkPlan, chunkFiles, sku, uid}) {
  const transcriptions = {};
  const totalChunks = outputStreams.length;
  let completedChunks = 0;

  const prompt = `The transcript is an audiobook version of ${bookData.title} by ${bookData.author}.`;

  // Create all transcription promises for all chunks across all chapters
  const allChunkPromises = [];
  const chunkToChapterMap = {};

  // Build all promises for parallel execution
  for (const [chapterIndex, chapterData] of Object.entries(chapterToChunksMap)) {
    const {chunkIndices, chunkFiles: chapterChunkFiles, chunkMetadata} = chapterData;

    logger.debug(
        `transcribeChapters: Preparing chapter ${chapterIndex} with ${chapterChunkFiles.length} chunks`,
    );

    for (let i = chunkIndices.start; i < chunkIndices.end; i++) {
      const chunkIndex = i - chunkIndices.start;
      const chunk = chunkMetadata[chunkIndex];
      const stream = outputStreams[i];
      const chunkFile = chunkFiles[i];

      // Map global chunk index to chapter and local chunk index
      chunkToChapterMap[i] = {
        chapterIndex,
        localChunkIndex: chunkIndex,
        chunkMetadata: chunk,
      };

      logger.debug(
          `transcribeChapters: Queuing chunk ${i + 1}/${totalChunks} - Chapter ${chapterIndex}, ` +
          `chunk ${chunkIndex} (${chunk.duration.toFixed(1)}s) from file: ${chunkFile}`,
      );

      allChunkPromises.push(
          (async () => {
            const startTime = Date.now();
            const transcription = await whisper.whisperTranscribe({
              stream: stream,
              chapter: chunkFile,
              offset: chunk.absoluteStartTime, // Use absolute time for correct timing
              prompt,
              distinctId: uid,
              traceId: `${sku}-ch${chapterIndex}-chunk${chunkIndex}`,
              posthogGroups: {
                sku: sku,
                uid: uid,
              },
            });
            const elapsedTime = Date.now() - startTime;
            return {transcription, elapsedTime};
          })().then(async ({transcription, elapsedTime}) => {
            completedChunks++;
            const progress = Math.round((completedChunks / totalChunks) * 100);
            logger.debug(
                `Transcription: Chunk ${completedChunks}/${totalChunks} completed (${progress}%) - ` +
                `Chapter ${chapterIndex}, chunk ${chunkIndex}, file: ${chunkFile}, time: ${elapsedTime}ms`,
            );
            await CatalogueProgressTracker.updateProgress(sku, {
              transcriptionStep: "transcribing",
              stepProgress: progress,
            });

            return {
              globalChunkIndex: i,
              chapterIndex,
              localChunkIndex: chunkIndex,
              transcription,
            };
          }).catch(async (error) => {
            logger.error(
                `Transcription ERROR: Chunk ${i + 1}/${totalChunks} - Chapter ${chapterIndex}, ` +
                `chunk ${chunkIndex}, file: ${chunkFile}, error: ${error.message}`,
            );

            // Still increment completed chunks to avoid progress hanging
            completedChunks++;
            const progress = Math.round((completedChunks / totalChunks) * 100);
            await CatalogueProgressTracker.updateProgress(sku, {
              transcriptionStep: "transcribing",
              stepProgress: progress,
            });

            // Return error object
            return {
              globalChunkIndex: i,
              chapterIndex,
              localChunkIndex: chunkIndex,
              transcription: {error: error.message},
            };
          }),
      );
    }
  }

  logger.debug(`transcribeChapters: Starting parallel transcription of ${allChunkPromises.length} chunks`);

  // Execute all transcriptions in parallel
  const allResults = await Promise.all(allChunkPromises);

  logger.debug(`transcribeChapters: All ${allResults.length} chunks transcribed, organizing by chapter`);

  // Group results by chapter
  const chapterResults = {};
  for (const result of allResults) {
    const {chapterIndex, localChunkIndex, transcription} = result;

    if (!chapterResults[chapterIndex]) {
      chapterResults[chapterIndex] = [];
    }

    chapterResults[chapterIndex].push({
      chunkIndex: localChunkIndex,
      transcription,
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

      logger.debug(`transcribeChapters: Chapter ${chapterIndex} transcription complete with ${chunkTranscriptions.length} chunks merged`);
    } else if (!hasError) {
      // Empty transcription
      transcriptions[chapterIndex] = [];
    }
  }


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
  transcribeChapters,
  validateTranscriptions,
};
