import fs from "fs";
import ffmpegTools from "../../audio/ffmpeg.js";
import {splitM4b} from "../../audio/splitM4b.js";
import {planChapterChunking} from "../../audio/audioChunker.js";
import {deleteFile, deleteLocalFiles} from "../../storage/storage.js";
import logger from "../../util/logger.js";
import {ENVIRONMENT} from "../../config/config.js";
import {getAudioPath, getMetaData, getSplitAudioPath} from "../../audio/audioMetadata.js";

const MAX_SIZE_FOR_TRANSCRIBE = 10;

/**
 * Prepare audio streams from M4B file
 * Downloads ffmpeg binary and splits M4B into chapter chunks
 * @param {string} uid - User ID
 * @param {string} sku - Book SKU
 * @param {string} ffmpegPath - Path to ffmpeg binary (optional)
 * @return {Object} Object containing chunkPlan, outputStreams, chunkFiles, and chapterToChunksMap
 */
async function prepareAudioStreams({uid, sku, ffmpegPath}) {
  logger.debug(`prepareAudioStreams: Preparing audio for ${sku}`);

  // Download ffmpeg binary if not provided
  if (!ffmpegPath) {
    logger.debug(`prepareAudioStreams: Downloading ffmpeg binary`);
    ffmpegPath = await ffmpegTools.downloadFfmpegBinary();
    if (ENVIRONMENT.value() === "development") {
      ffmpegPath = `ffmpeg`;
    }
  }

  logger.debug(`prepareAudioStreams: using ffmpeg path: ${ffmpegPath}`);

  // Split M4B into chapter chunks
  const {chunkPlan, outputStreams, chunkFiles, chapterToChunksMap} = await outputStreamsFromM4b({uid, sku, ffmpegPath});

  return {
    chunkPlan,
    outputStreams,
    chapters: chunkFiles, // Keep as 'chapters' for backward compatibility
    chapterToChunksMap,
    ffmpegPath,
  };
}

/**
 * Convert M4B file to output streams for each chapter chunk
 * Now returns arrays of chunks for each chapter to handle long chapters
 * @param {string} uid - User ID
 * @param {string} sku - Book SKU
 * @param {string} ffmpegPath - Path to ffmpeg binary
 * @return {Object} Object containing chunkPlan, outputStreams, and chunkFiles
 */
async function outputStreamsFromM4b({uid, sku, ffmpegPath}) {
  // Get metadata first to plan chunking
  const metadata = await getMetaData(uid, sku);
  const outputPathPrefix = `./bin/${sku}`;

  // Plan the chunking based on duration
  const chunkPlan = planChapterChunking(metadata, MAX_SIZE_FOR_TRANSCRIBE, outputPathPrefix);

  // Split M4B using the new approach - returns array of arrays (chunks per chapter)
  const chapterChunksArrays = await splitM4b({uid, sku, ffmpegPath, maxSize: MAX_SIZE_FOR_TRANSCRIBE});

  // Flatten all chunks into a single array for streaming
  const allChunkFiles = [];
  const chapterToChunksMap = {};

  chapterChunksArrays.forEach((chunkFiles, chapterIndex) => {
    const startIndex = allChunkFiles.length;
    allChunkFiles.push(...chunkFiles);
    const endIndex = allChunkFiles.length;

    chapterToChunksMap[chapterIndex] = {
      chunkIndices: {start: startIndex, end: endIndex},
      chunkFiles: chunkFiles,
      chunkMetadata: chunkPlan.chapters[chapterIndex]?.chunks || [],
    };
  });

  // Create streams for all chunks
  const outputStreams = allChunkFiles.map((file) => fs.createReadStream(file));

  return {
    chunkPlan,
    outputStreams,
    chunkFiles: allChunkFiles,
    chapterToChunksMap,
  };
}

/**
 * Clean up local and cloud audio files after processing
 * @param {Array<string>} chapters - Array of local chapter file paths
 */
async function cleanupAudioFiles({uid, sku, chapters}) {
  // Delete local chunk files
  if (chapters && chapters.length > 0) {
    logger.debug(`cleanupAudioFiles: Deleting ${chapters.length} local chunk files`);
    await deleteLocalFiles(chapters);
  }

  // Delete m4b file for private books only
  if (uid !== "admin") {
    // Delete the original m4b file
    const m4bPath = getAudioPath({uid, sku});
    logger.debug(`cleanupAudioFiles: Deleting private m4b file: ${m4bPath}`);
    await deleteFile({path: m4bPath});
  }

  // Delete the split m4a chapter files from cloud storage
  // These files have the same names as local files but are stored in cloud storage
  if (chapters && chapters.length > 0) {
    const splitAudioPath = getSplitAudioPath(uid, sku);
    logger.debug(`cleanupAudioFiles: Deleting split audio files from: ${splitAudioPath}`);

    // Convert local file paths to cloud storage paths
    const cloudPaths = chapters.map((localPath) => {
      // Extract just the filename from the local path (e.g., "./bin/SKU-ch0-chunk0.m4a" -> "SKU-ch0-chunk0.m4a")
      const filename = localPath.split("/").pop();
      return `${splitAudioPath}${filename}`;
    });

    logger.debug(`cleanupAudioFiles: Deleting ${cloudPaths.length} split audio files from cloud storage`);

    // Delete each split audio file
    const deletePromises = cloudPaths.map((cloudPath) =>
      deleteFile({path: cloudPath}).catch((error) => {
        logger.error(`cleanupAudioFiles: Failed to delete ${cloudPath}: ${error.message}`);
        return null; // Continue with other deletions even if one fails
      }),
    );

    await Promise.all(deletePromises);
    logger.debug(`cleanupAudioFiles: Deleted split audio files from cloud storage`);
  }
}

export {
  prepareAudioStreams,
  outputStreamsFromM4b,
  cleanupAudioFiles,
  MAX_SIZE_FOR_TRANSCRIBE,
};
