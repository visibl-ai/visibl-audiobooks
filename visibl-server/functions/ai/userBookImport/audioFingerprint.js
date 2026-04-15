import crypto from "crypto";
import ffmpegTools from "../../audio/ffmpeg.js";
import logger from "../../util/logger.js";

/**
 * Core function to generate fingerprint from structured chapter data
 * @param {Object} data - Object containing numChapters, chapterTimestamps, and totalDuration
 * @return {Object} Fingerprint data including hash
 */
function _generateFingerprint(data) {
  // Sort the fingerprint data keys for consistent hashing
  const sortedData = {
    numChapters: data.numChapters,
    chapterTimestamps: data.chapterTimestamps,
    totalDuration: data.totalDuration,
  };

  // Generate SHA-256 hash
  const dataString = JSON.stringify(sortedData);
  const fingerprint = crypto
      .createHash("sha256")
      .update(dataString)
      .digest("hex");

  logger.debug(`generateAudiobookFingerprint: Fingerprint generated for ${dataString}: ${fingerprint}`);

  return {
    ...sortedData,
    fingerprint,
    version: "v1",
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Generate a fingerprint for an audiobook file (M4B/M4A) based on chapter structure
 * @param {Object} params - Parameters object
 * @param {string} params.filePath - Path to the audiobook file
 * @param {string} params.ffprobePath - Path to ffprobe binary
 * @return {Promise<Object>} Fingerprint data including hash
 */
async function generateAudiobookFingerprint({filePath, ffprobePath}) {
  try {
    const metadata = await ffmpegTools.ffprobe(filePath, ffprobePath);
    const chapters = metadata.chapters || [];

    // Build fingerprint data structure
    const fingerprintData = {
      numChapters: chapters.length,
      chapterTimestamps: chapters.map((ch) => {
        // Round to 0.01 seconds precision to avoid floating point issues
        const startTime = parseFloat(ch.start_time) || 0;
        return Math.round(startTime * 100) / 100;
      }),
      totalDuration: Math.round((parseFloat(metadata.format?.duration) || 0) * 100) / 100,
    };

    return _generateFingerprint(fingerprintData);
  } catch (error) {
    console.error("Error generating audiobook fingerprint:", error);
    throw new Error(`Failed to generate fingerprint: ${error.message}`);
  }
}

/**
 * Generate a fingerprint from existing metadata object
 * @param {Object} metadata - Metadata object with chapters and length properties
 * @return {Object} Fingerprint data including hash
 */
function generateFingerprintFromMetadata(metadata) {
  try {
    const chapters = metadata.chapters || {};
    const chapterArray = Object.values(chapters);

    // Build fingerprint data structure
    const fingerprintData = {
      numChapters: chapterArray.length,
      chapterTimestamps: chapterArray.map((ch) => {
        // Round to 0.01 seconds precision
        const startTime = ch.startTime || 0;
        return Math.round(startTime * 100) / 100;
      }),
      totalDuration: Math.round((metadata.length || 0) * 100) / 100,
    };

    return _generateFingerprint(fingerprintData);
  } catch (error) {
    console.error("Error generating fingerprint from metadata:", error);
    throw new Error(`Failed to generate fingerprint: ${error.message}`);
  }
}

/**
 * Generate a unique SKU from user ID and audiobook fingerprint
 * @param {Object} params - Parameters object
 * @param {string} params.fingerprint - Audio fingerprint hash
 * @param {string} [params.prefix] - Optional prefix for SKU (defaults to "CSTM")
 * @return {string} Generated SKU in format: CSTM_X{16}
 */
function generateSkuFromFingerprint({fingerprint, prefix = "CSTM"}) {
  try {
    if (!fingerprint) {
      throw new Error("The fingerprint is required to generate SKU");
    }

    // Use fingerprint directly (it's already a hash)
    const fingerprintHash = fingerprint.toUpperCase();

    // Create SKU: PREFIX_FINGERPRINT(16)
    const sku = `${prefix}_${fingerprintHash.substring(0, 16)}`;

    logger.debug(`Generated SKU: ${sku} for fingerprint: ${fingerprint}`);

    return sku;
  } catch (error) {
    logger.error("Error generating SKU from fingerprint:", error);
    throw new Error(`Failed to generate SKU: ${error.message}`);
  }
}

export {
  generateAudiobookFingerprint,
  generateFingerprintFromMetadata,
  generateSkuFromFingerprint,
};
