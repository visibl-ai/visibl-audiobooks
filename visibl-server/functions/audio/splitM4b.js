/* eslint-disable require-jsdoc */
import {
  downloadFileFromBucket,
  uploadFileToBucket,
  deleteLocalFiles,
} from "../storage/storage.js";

import logger from "../util/logger.js";
import ffmpegTools from "./ffmpeg.js";
import {
  getMetaData,
  getAudioPath,
  getSplitAudioPath} from "./audioMetadata.js";
import CatalogueProgressTracker from "../storage/realtimeDb/CatalogueProgressTracker.js";
import pLimit from "p-limit";

const NUM_THREADS = process.env.NUM_THREADS || 8; // 32 GB instances have 8 cores
const CHUNK_SIZE = 5; // Process files in chunks of 5 to avoid overwhelming GCS
const MAX_CONCURRENT_PER_CHUNK = 5; // Concurrent uploads within each chunk

async function uploadFilesToBucket({outputFiles, cloudPath = "splitAudio"}) {
  logger.info(`uploadFilesToBucket: Uploading ${outputFiles.length} files in chunks of ${CHUNK_SIZE}`);

  const allSuccessfulUploads = [];
  const allFailedUploads = [];

  // Split files into chunks for sequential processing
  const chunks = [];
  for (let i = 0; i < outputFiles.length; i += CHUNK_SIZE) {
    chunks.push(outputFiles.slice(i, Math.min(i + CHUNK_SIZE, outputFiles.length)));
  }

  logger.info(`Processing ${chunks.length} chunks sequentially`);

  // Process each chunk sequentially
  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
    const chunk = chunks[chunkIndex];
    const chunkStartIndex = chunkIndex * CHUNK_SIZE;

    logger.info(`Processing chunk ${chunkIndex + 1}/${chunks.length} (files ${chunkStartIndex + 1}-${Math.min(chunkStartIndex + chunk.length, outputFiles.length)})`);

    // Add delay between chunks to avoid overwhelming GCS
    if (chunkIndex > 0) {
      const interChunkDelay = 500; // 0.5 second delay between chunks
      logger.debug(`Waiting ${interChunkDelay}ms before processing next chunk`);
      await new Promise((resolve) => setTimeout(resolve, interChunkDelay));
    }

    // Create a concurrency limiter for this chunk
    const limit = pLimit(MAX_CONCURRENT_PER_CHUNK);

    // Process files in this chunk with limited concurrency
    const chunkPromises = chunk.map((outputFile, indexInChunk) => {
      const globalIndex = chunkStartIndex + indexInChunk;

      return limit(async () => {
        try {
          // uploadFileToBucket already has retry logic built-in
          const uploadResponse = await uploadFileToBucket({
            localPath: outputFile,
            bucketPath: `${cloudPath}${outputFile.split("./bin/")[1]}`,
          });

          logger.debug(`uploadFilesToBucket: Successfully uploaded file ${globalIndex + 1}/${outputFiles.length}: ${outputFile}`);
          return {success: true, response: uploadResponse, file: outputFile};
        } catch (error) {
          logger.error(`Failed to upload ${outputFile}: ${error.message || error}`);
          return {success: false, file: outputFile, error: error.message || error};
        }
      });
    });

    // Wait for this chunk to complete
    const chunkResults = await Promise.all(chunkPromises);

    // Separate successful and failed uploads
    for (const result of chunkResults) {
      if (result.success) {
        allSuccessfulUploads.push(result.response);
      } else {
        allFailedUploads.push(result.file);
      }
    }

    // Log chunk completion
    const chunkSuccesses = chunkResults.filter((r) => r.success).length;
    const chunkFailures = chunkResults.filter((r) => !r.success).length;
    logger.info(`Chunk ${chunkIndex + 1}/${chunks.length} completed: ${chunkSuccesses} succeeded, ${chunkFailures} failed`);
  }

  // Log final summary
  logger.info(`Upload completed: ${allSuccessfulUploads.length} succeeded, ${allFailedUploads.length} failed out of ${outputFiles.length} total files`);

  if (allFailedUploads.length > 0) {
    logger.error(`Failed files: ${allFailedUploads.join(", ")}`);
  }

  // Map successful uploads to their metadata names
  const successfulUploadNames = allSuccessfulUploads.map((uploadResponse) => {
    logger.log(`Uploaded ${uploadResponse.metadata.name} to bucket`);
    return `${uploadResponse.metadata.name}`;
  });

  // Throw error if too many uploads failed
  if (successfulUploadNames.length === 0) {
    throw new Error("All file uploads failed");
  } else if (allFailedUploads.length > outputFiles.length * 0.1) {
    // If more than 10% of uploads failed, throw error
    throw new Error(`Too many upload failures: ${allFailedUploads.length} out of ${outputFiles.length} files failed`);
  }

  return successfulUploadNames;
}

// WARN: Delete Output Files when you're done with them!
/* eslint-disable require-jsdoc */
async function splitM4b({uid, sku, ffmpegPath, maxSize = 20}) {
  // 1. Download file from bucket to local - or, use the one already there.
  const inputFilePath = `./bin/${sku}.m4b`;
  await downloadFileFromBucket({bucketPath: getAudioPath({uid, sku}), localPath: inputFilePath});
  logger.debug("STEP 1: File downloaded from bucket.");
  // 2. get metadata from audio file
  const metadata = await getMetaData(uid, sku);
  logger.debug("STEP 2: Metadata Obtained");

  // 3. Split file in parallel - now returns array of arrays (chunks per chapter)
  const totalChapters = metadata.outputFiles.length;
  let completedChapters = 0;

  // Ensure bitrate is never 0, default to 128 kbps if not set or is 0
  const bitrate = metadata.bookData.bitrate_kbs && metadata.bookData.bitrate_kbs > 0 ?
    metadata.bookData.bitrate_kbs :
    128;

  const chapterChunksArrays = await ffmpegTools.splitAudioInParallel(
      inputFilePath,
      metadata.outputFiles,
      metadata.startTimes,
      metadata.endTimes,
      maxSize,
      metadata.bookData.codec,
      bitrate,
      NUM_THREADS,
      ffmpegPath,
      async () => {
        // Progress callback for each completed chapter
        completedChapters++;
        const progress = Math.round((completedChapters / totalChapters) * 100);
        logger.debug(`Chapter ${completedChapters}/${totalChapters} completed (${progress}%)`);
        await CatalogueProgressTracker.updateProgress(sku, {
          transcriptionStep: "preparing",
          stepProgress: progress,
        });
      },
  );

  logger.debug(`STEP 3: File Split into chapters with chunking for large chapters (max ${maxSize}mb)`);

  // Flatten all chunks for upload
  const allChunkFiles = [];
  chapterChunksArrays.forEach((chunks) => {
    allChunkFiles.push(...chunks);
  });

  // 4. Upload the split files to bucket
  await uploadFilesToBucket({outputFiles: allChunkFiles, cloudPath: getSplitAudioPath(uid, sku)});
  logger.debug("STEP 4: Files uploaded to bucket.");
  await deleteLocalFiles([inputFilePath]);

  // Return the array of arrays structure
  return chapterChunksArrays;
}

export {splitM4b};
