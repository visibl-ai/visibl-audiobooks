/* eslint-disable require-jsdoc */

import logger from "./logger.js";
import {catalogueGetRtdb} from "../storage/realtimeDb/catalogue.js";
import {getCDNM4bUrl} from "../storage/realtimeDb/library.js";
import ffmpegTools from "../audio/ffmpeg.js";
import {
  uploadFileToBucket,
  deleteLocalFiles,
  makeFilePublic,
} from "../storage/storage.js";
import {ENVIRONMENT} from "../config/config.js";

/**
 * Creates a shareable audio clip from a public catalogue item
 * @param {Object} params - Parameters for creating the shareable clip
 * @param {string} params.sku - The SKU of the catalogue item
 * @param {number} params.startTime - Start time in seconds
 * @param {number} params.endTime - End time in seconds
 * @param {string} params.uid - User ID of the requester
 * @return {Object} Object containing the gs:// path of the shareable clip
 */
async function createShareableClip({sku, startTime, endTime, uid}) {
  // Validate input parameters
  if (!sku || startTime === undefined || endTime === undefined || !uid) {
    throw new Error("sku, startTime, endTime, and uid are required");
  }

  if (startTime < 0 || endTime <= startTime) {
    throw new Error("Invalid time range: startTime must be >= 0 and endTime must be > startTime");
  }

  // Verify SKU exists in catalogue and is public
  const catalogueItem = await catalogueGetRtdb({sku});
  if (!catalogueItem) {
    throw new Error(`SKU ${sku} not found in catalogue`);
  }

  if (catalogueItem.visibility !== "public") {
    throw new Error(`SKU ${sku} is not public and cannot be shared`);
  }

  // Download ffmpeg binary (handles Node 22+ built-in ffmpeg)
  let ffmpegPath = await ffmpegTools.downloadFfmpegBinary();
  if (ENVIRONMENT.value() === "development") {
    ffmpegPath = "ffmpeg";
  }

  const timestamp = Date.now();
  const localOutputPath = `./bin/${sku}-${uid}-${timestamp}.m4b`;
  const bucketOutputPath = `Catalogue/Shares/${sku}-${uid}-${timestamp}.m4b`;

  logger.debug(`createShareableClip: ${sku} (${startTime}s-${endTime}s) for uid=${uid}, output=${bucketOutputPath}`);

  try {
    // Get HTTP URL for the source audio (enables HTTP seeking in ffmpeg)
    const publicUrl = getCDNM4bUrl({sku});
    logger.debug(`createShareableClip: Using HTTP URL for ffmpeg: ${publicUrl}`);

    // Clip the audio using ffmpeg with HTTP source (uses HTTP range requests for seeking)
    await ffmpegTools.clipAudio({
      inputFile: publicUrl,
      outputFile: localOutputPath,
      startTime,
      endTime,
      sku,
      ffmpegPath,
    });

    // Upload and make public
    await uploadFileToBucket({
      localPath: localOutputPath,
      bucketPath: bucketOutputPath,
    });

    await makeFilePublic({path: bucketOutputPath});

    const gsPath = `gs://${bucketOutputPath}`;
    logger.info(`createShareableClip: Created shareable clip at ${gsPath}`);

    return {
      success: true,
      path: gsPath,
      duration: Math.round((endTime - startTime) * 1000) / 1000,
    };
  } finally {
    // Cleanup local files
    try {
      await deleteLocalFiles([localOutputPath]);
    } catch (error) {
      logger.debug(`createShareableClip: No files to delete for ${localOutputPath}: ${error.message}`);
    }
  }
}

export {
  createShareableClip,
};
