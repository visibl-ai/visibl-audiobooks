import logger from "../util/logger.js";

/**
 * Calculate the maximum duration in seconds that can fit within a target file size
 * @param {number} targetSizeMB - Target size in megabytes
 * @param {number} bitrateKbps - Bitrate in kilobits per second
 * @return {number} Maximum duration in seconds
 */
function calculateMaxDuration(targetSizeMB, bitrateKbps) {
  // Ensure bitrate is never 0, default to 128 kbps if not set or is 0
  const safeBitrate = bitrateKbps && bitrateKbps > 0 ? bitrateKbps : 128;

  // Convert MB to bits and calculate duration
  const targetSizeBits = targetSizeMB * 1024 * 1024 * 8;
  const maxDurationSeconds = targetSizeBits / (safeBitrate * 1000);

  logger.debug(`calculateMaxDuration: targetSize=${targetSizeMB}MB, bitrate=${safeBitrate}kbps, maxDuration=${maxDurationSeconds}s`);

  return maxDurationSeconds;
}

/**
 * Determine if a chapter needs to be split into chunks
 * @param {number} chapterDuration - Duration of the chapter in seconds
 * @param {number} maxDuration - Maximum allowed duration per chunk in seconds
 * @return {boolean} True if chapter needs splitting
 */
function needsChunking(chapterDuration, maxDuration) {
  return chapterDuration > maxDuration;
}

/**
 * Calculate chunk boundaries for a chapter
 * Always returns an array of chunks, even for short chapters (single-element array)
 * @param {number} chapterStart - Start time of chapter in seconds
 * @param {number} chapterEnd - End time of chapter in seconds
 * @param {number} maxDuration - Maximum duration per chunk in seconds
 * @param {string} outputFilePrefix - Prefix for output files
 * @param {number} chapterIndex - Index of the chapter
 * @return {Array} Array of chunk objects with timing and file info
 */
function calculateChunkBoundaries(chapterStart, chapterEnd, maxDuration, outputFilePrefix, chapterIndex) {
  const chapterDuration = chapterEnd - chapterStart;
  const chunks = [];

  if (!needsChunking(chapterDuration, maxDuration)) {
    // Short chapter - return single chunk in array for consistency
    chunks.push({
      chunkIndex: 0,
      file: `${outputFilePrefix}-ch${chapterIndex}-chunk0.m4a`,
      startTime: 0, // Relative to chapter start
      endTime: chapterDuration,
      absoluteStartTime: chapterStart, // Absolute time in original file
      absoluteEndTime: chapterEnd,
      chapterOffset: chapterStart,
      duration: chapterDuration,
    });

    logger.debug(`Chapter ${chapterIndex} fits in single chunk: duration=${chapterDuration}s`);
  } else {
    // Long chapter - split into multiple chunks
    let currentTime = 0;
    let chunkIndex = 0;

    while (currentTime < chapterDuration) {
      const chunkStart = currentTime;
      const chunkEnd = Math.min(currentTime + maxDuration, chapterDuration);
      const chunkDuration = chunkEnd - chunkStart;

      chunks.push({
        chunkIndex,
        file: `${outputFilePrefix}-ch${chapterIndex}-chunk${chunkIndex}.m4a`,
        startTime: chunkStart, // Relative to chapter start
        endTime: chunkEnd,
        absoluteStartTime: chapterStart + chunkStart, // Absolute time in original file
        absoluteEndTime: chapterStart + chunkEnd,
        chapterOffset: chapterStart,
        duration: chunkDuration,
      });

      currentTime = chunkEnd;
      chunkIndex++;
    }

    logger.debug(`Chapter ${chapterIndex} split into ${chunks.length} chunks: totalDuration=${chapterDuration}s, maxDuration=${maxDuration}s`);
  }

  return chunks;
}

/**
 * Plan chunking for all chapters in a book
 * @param {Object} metadata - Book metadata with chapters
 * @param {number} maxSizeMB - Maximum size per chunk in megabytes
 * @param {string} outputPathPrefix - Prefix for output file paths
 * @return {Object} Chunking plan with all chapters and their chunks
 */
function planChapterChunking(metadata, maxSizeMB, outputPathPrefix) {
  const {bookData} = metadata;
  const bitrateKbps = bookData.bitrate_kbs && bookData.bitrate_kbs > 0 ? bookData.bitrate_kbs : 128;
  const maxDuration = calculateMaxDuration(maxSizeMB, bitrateKbps);

  const chunkingPlan = {
    bookInfo: {
      title: bookData.title,
      author: bookData.author,
      bitrate: bitrateKbps,
      maxChunkSize: maxSizeMB,
      maxChunkDuration: maxDuration,
    },
    chapters: {},
    totalChunks: 0,
  };

  // Process each chapter
  Object.entries(bookData.chapters).forEach(([chapterIndex, chapter]) => {
    const chunks = calculateChunkBoundaries(
        chapter.startTime,
        chapter.endTime,
        maxDuration,
        outputPathPrefix,
        chapterIndex,
    );

    chunkingPlan.chapters[chapterIndex] = {
      title: chapter.title || `Chapter ${chapterIndex}`,
      originalStartTime: chapter.startTime,
      originalEndTime: chapter.endTime,
      duration: chapter.endTime - chapter.startTime,
      chunks: chunks,
    };

    chunkingPlan.totalChunks += chunks.length;
  });

  logger.info(`Chunking plan created: ${Object.keys(chunkingPlan.chapters).length} chapters, ${chunkingPlan.totalChunks} total chunks`);

  return chunkingPlan;
}

/**
 * Merge transcriptions from multiple chunks back into a single chapter transcription
 * @param {Array} chunkTranscriptions - Array of transcription arrays from chunks
 * @param {Array} chunkMetadata - Array of chunk metadata with timing info
 * @return {Array} Merged transcription with corrected timings
 */
function mergeChunkTranscriptions(chunkTranscriptions, chunkMetadata) {
  const mergedTranscription = [];
  let segmentIdOffset = 0;

  chunkTranscriptions.forEach((chunkTranscription) => {
    // Note: chunkMetadata is available if timing adjustments are needed
    // Currently, whisper already provides absolute timing via the offset parameter

    // Adjust timing and IDs for each segment in the chunk
    chunkTranscription.forEach((segment) => {
      mergedTranscription.push({
        id: segmentIdOffset + segment.id,
        startTime: segment.startTime, // Already includes chapter offset from whisper
        text: segment.text,
      });
    });

    // Update segment ID offset for next chunk
    if (chunkTranscription.length > 0) {
      segmentIdOffset += chunkTranscription.length;
    }
  });

  logger.debug(`Merged ${chunkTranscriptions.length} chunk transcriptions into ${mergedTranscription.length} segments`);

  return mergedTranscription;
}

/**
 * Validate timing continuity in merged transcriptions
 * @param {Array} transcription - Merged transcription array
 * @return {boolean} True if timing is continuous
 */
function validateTimingContinuity(transcription) {
  if (!transcription || transcription.length === 0) {
    return true;
  }

  let isValid = true;
  let lastEndTime = transcription[0].startTime;

  for (let i = 1; i < transcription.length; i++) {
    const currentStartTime = transcription[i].startTime;

    // Check for timing gaps or overlaps (allow small tolerance)
    const timingGap = Math.abs(currentStartTime - lastEndTime);
    if (timingGap > 60) { // More than 60 seconds gap indicates potential issue
      logger.warn(`Timing discontinuity detected at segment ${i}: gap of ${timingGap}s`);
      isValid = false;
    }

    lastEndTime = currentStartTime;
  }

  return isValid;
}

export {
  calculateMaxDuration,
  needsChunking,
  calculateChunkBoundaries,
  planChapterChunking,
  mergeChunkTranscriptions,
  validateTimingContinuity,
};
