import logger from "../../util/logger.js";
import {
  generateFingerprintFromMetadata,
  generateSkuFromFingerprint,
} from "./audioFingerprint.js";
import {
  moderateMetadata,
  extractMetadata,
} from "./metadataProcessor.js";
import {
  catalogueAddRtdb,
  catalogueGetRtdb,
} from "../../storage/realtimeDb/catalogue.js";
import {libraryAddItemRtdb} from "../../storage/realtimeDb/library.js";
import {addImportedSku} from "../../storage/realtimeDb/users.js";
import {processPrivateM4B} from "../transcribe/index.js";
import {
  downloadFileFromBucket,
  uploadJsonToBucket,
  uploadFileToBucket,
  // deleteFile,
} from "../../storage/storage.js";
import fs from "fs/promises";
import {createWriteStream} from "fs";
import path from "path";
import os from "os";
import {deleteFile} from "../../storage/storage.js";
import axios from "axios";
import {getInstance as getAnalytics} from "../../analytics/bookPipelineAnalytics.js";

/**
 * Download an M4B file from URL and upload to storage bucket
 * @param {string} audioUrl - URL of the M4B file to download
 * @param {string} uid - User ID
 * @return {Promise<string>} Path to uploaded file in storage bucket
 */
async function downloadM4BFromUrl(audioUrl, uid) {
  const tempFileName = `temp_${Date.now()}.m4b`;
  const bucketPath = `UserData/${uid}/Uploads/Raw/${tempFileName}`;

  logger.info(`downloadM4BFromUrl: Downloading M4B from URL: ${audioUrl}`);

  // Create temp directory
  const tempDir = path.join(os.tmpdir(), "visibl-temp");
  await fs.mkdir(tempDir, {recursive: true});
  const localTempPath = path.join(tempDir, tempFileName);

  try {
    // Download the file from URL
    const response = await axios({
      method: "GET",
      url: audioUrl,
      responseType: "stream",
      timeout: 600000, // 10 minute timeout for large M4B files
    });

    // Save to local temp file
    const writer = createWriteStream(localTempPath);
    response.data.pipe(writer);

    await new Promise((resolve, reject) => {
      writer.on("finish", resolve);
      writer.on("error", reject);
    });

    // Upload to storage bucket
    await uploadFileToBucket({
      localPath: localTempPath,
      bucketPath: bucketPath,
    });

    // Clean up temp file
    await fs.unlink(localTempPath).catch(() => {});

    logger.info(`downloadM4BFromUrl: Successfully downloaded and uploaded M4B to ${bucketPath}`);
    return bucketPath;
  } catch (error) {
    logger.error(`downloadM4BFromUrl: Error downloading M4B from URL: ${error.message}`);
    // Clean up temp file if it exists
    await fs.unlink(localTempPath).catch(() => {});
    throw new Error(`Failed to download M4B file: ${error.message}`);
  }
}

/**
 * Process a custom M4B audiobook file
 * @param {Object} params - Parameters object
 * @param {string} params.uid - User ID
 * @param {string} [params.audioPath] - Path to M4B file in storage (e.g., UserData/uid/Uploads/Raw/temp.m4b)
 * @param {string} [params.audioUrl] - URL to download M4B file from
 * @return {Promise<Object>} Processing result with SKU
 */
export async function processCustomM4B({uid, audioPath, audioUrl}) {
  if (!uid) {
    throw new Error("User ID is required");
  }

  // Must provide either audioPath or audioUrl, but not both
  if (!audioPath && !audioUrl) {
    throw new Error("Either audioPath or audioUrl is required");
  }
  if (audioPath && audioUrl) {
    throw new Error("Cannot provide both audioPath and audioUrl");
  }

  let normalizedAudioPath;

  // If audioUrl is provided, download the file first
  if (audioUrl) {
    normalizedAudioPath = await downloadM4BFromUrl(audioUrl, uid);
    logger.info(`processCustomM4B: Using downloaded M4B at ${normalizedAudioPath}`);
  } else {
    // Using existing audioPath - normalize and validate it
    const expectedPrefix = `UserData/${uid}/Uploads/Raw/`;

    // If full path is not provided, prepend the expected prefix
    normalizedAudioPath = audioPath.includes("UserData") ?
      path.posix.normalize(audioPath) :
      expectedPrefix + audioPath;

    if (!normalizedAudioPath.startsWith(expectedPrefix)) {
      throw new Error("Invalid audioPath: must point to your uploads directory");
    }
    if (!normalizedAudioPath.toLowerCase().endsWith(".m4b")) {
      throw new Error("Invalid audioPath: only .m4b files are supported");
    }
  }

  logger.info(`processCustomM4B: Starting processing for ${normalizedAudioPath} by user ${uid}`);

  // Get analytics instance
  const analytics = getAnalytics();

  // Track import started
  await analytics.trackBookImportStarted({
    uid,
    sku: null, // SKU not generated yet
    bookTitle: "Unknown", // Not yet extracted
    bookAuthor: "Unknown",
    source: "custom_m4b_upload",
    entryType: "m4b",
  }).catch((err) => logger.debug(`Analytics error: ${err.message}`));

  // 1. Extract metadata from M4B file
  logger.info(`processCustomM4B: Extracting metadata from ${normalizedAudioPath}`);

  // Create temp directory inside the writable /tmp mount for Cloud Functions
  const tempDir = path.join(os.tmpdir(), "visibl-temp");
  await fs.mkdir(tempDir, {recursive: true});

  // Download M4B file locally
  const fileName = path.basename(normalizedAudioPath);
  const localM4bPath = path.join(tempDir, fileName);

  await downloadFileFromBucket({
    bucketPath: normalizedAudioPath,
    localPath: localM4bPath,
  });

  // Extract metadata using ffmpeg - returns standardized format
  const metadata = await extractMetadata(localM4bPath);

  if (!metadata || !metadata.length) {
    throw new Error("Invalid M4B file: unable to extract metadata");
  }

  if (!metadata.chapters || Object.keys(metadata.chapters).length === 0) {
    throw new Error("No chapters found in M4B file");
  }

  // Debug: Log the metadata structure
  logger.debug(`processCustomM4B: Metadata keys: ${Object.keys(metadata).join(", ")}`);
  logger.debug(`processCustomM4B: Found ${metadata.numChapters} chapters, duration: ${metadata.length}s`);

  // 2. Generate fingerprint and SKU
  logger.info(`processCustomM4B: Generating fingerprint and SKU`);

  // Metadata is already in the correct format for fingerprint generation
  const fingerprintData = generateFingerprintFromMetadata(metadata);

  const sku = generateSkuFromFingerprint({
    fingerprint: fingerprintData.fingerprint,
    prefix: "CSTM",
  });

  logger.info(`processCustomM4B: Generated SKU ${sku} with fingerprint ${fingerprintData.fingerprint}`);

  // Check if this SKU already exists
  // Simply add existing SKU to user's library
  const existingItem = await catalogueGetRtdb({sku});
  if (existingItem) {
    logger.warn(`processCustomM4B: SKU ${sku} already exists in catalogue`);
    // Clean up local file
    await fs.unlink(localM4bPath).catch(() => { });

    // Add existing SKU to user's library
    await libraryAddItemRtdb({uid, data: {sku}});

    // Add existing SKU to imported SKUs
    await addImportedSku({uid, sku});

    return {
      success: true,
      message: "This audiobook has already been processed",
      sku,
    };
  }

  // 3. Moderate metadata
  logger.info(`processCustomM4B: Moderating metadata for ${sku}`);

  const moderatedMetadata = await moderateMetadata({
    metadata,
    uid,
    sku,
  });

  // 5. Save metadata and copy m4b to use the SKU
  logger.info(`processCustomM4B: Saving metadata for ${sku}`);

  const metadataPath = `Catalogue/Custom/Raw/${sku}.json`;
  await uploadJsonToBucket({
    json: moderatedMetadata,
    bucketPath: metadataPath,
  });

  await uploadFileToBucket({
    localPath: localM4bPath,
    bucketPath: `Catalogue/Custom/Raw/${sku}.m4b`,
  });

  // 6. Create private catalogue item and add to user's library
  logger.info(`processCustomM4B: Creating catalogue item for ${sku}`);

  await catalogueAddRtdb({
    body: {
      sku,
      title: moderatedMetadata.title || "Untitled",
      // Ensure author is always an array
      author: Array.isArray(moderatedMetadata.author) ?
        (moderatedMetadata.author.length > 0 ? moderatedMetadata.author : ["Unknown"]) :
        (moderatedMetadata.author ? [moderatedMetadata.author] : ["Unknown"]),
      visibility: "private",
      addedBy: uid,
      fiction: true, // Default to fiction for custom uploads
      coverArtUrl: null, // No longer using a placeholder cover art
      metadata: moderatedMetadata,
      // Store fingerprint data separately from metadata
      fingerprintData: {
        fingerprint: fingerprintData.fingerprint,
        version: fingerprintData.version,
        numChapters: fingerprintData.numChapters,
        chapterTimestamps: fingerprintData.chapterTimestamps,
        totalDuration: fingerprintData.totalDuration,
        generatedAt: fingerprintData.generatedAt,
      },
      graphProgress: {
        status: "pending",
        currentStep: "transcription",
        completion: 0,
        inProgress: false,
      },
      isCustomUpload: true,
      uploadedAt: new Date().toISOString(),
    },
  });

  logger.info(`processCustomM4B: Adding ${sku} to user ${uid}'s library`);
  await libraryAddItemRtdb({
    uid,
    data: {sku},
  });

  // Add SKU to user's importedSkus
  await addImportedSku({uid, sku});

  // 7. Clean up local files and original upload if different
  await fs.unlink(localM4bPath).catch(() => {});

  // Delete original upload file (always different from final Catalogue path)
  const finalAudioPath = `Catalogue/Custom/Raw/${sku}.m4b`;
  if (normalizedAudioPath !== finalAudioPath) {
    await deleteFile({path: normalizedAudioPath}).catch((error) => {
      logger.debug(`Could not delete original upload file: ${error.message}`);
    });
  }

  // 8. Start transcription and graph generation process
  logger.info(`processCustomM4B: Initiating transcription for ${sku}`);

  const transcriptionResult = await processPrivateM4B({
    uid,
    item: {sku},
    entryType: "m4b",
  });

  return {
    success: true,
    sku,
    message: "Custom M4B processing initiated successfully",
    fingerprint: fingerprintData.fingerprint,
    metadata: {
      title: moderatedMetadata.title,
      author: moderatedMetadata.author,
      numChapters: moderatedMetadata.numChapters,
      duration: moderatedMetadata.length,
      wasModerated: moderatedMetadata.wasModerated,
    },
    transcriptionQueued: transcriptionResult.success,
  };
}

export default processCustomM4B;
