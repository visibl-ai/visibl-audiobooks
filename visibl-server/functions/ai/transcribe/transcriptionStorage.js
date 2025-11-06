import {uploadJsonToBucket, fileExists, getJsonFile} from "../../storage/storage.js";
import logger from "../../util/logger.js";

/**
 * Get the transcriptions path for a given user and SKU
 * @param {string} uid - User ID
 * @param {string} sku - Book SKU
 * @param {number} chapter - Chapter number (optional)
 * @return {string} The path to the transcriptions file
 */
function getTranscriptionsPath({uid, sku, chapter, identifier = null}) {
  if (uid === "admin") {
    return chapter === undefined ?
      `Catalogue/Processed/${sku}/${sku}-transcriptions${identifier ? `-${identifier}` : ""}.json` :
      `Catalogue/Processed/${sku}/${sku}-transcriptions-${chapter}${identifier ? `-${identifier}` : ""}.json`;
  }
  return chapter === undefined ?
    `UserData/${uid}/Uploads/Processed/${sku}/${sku}-transcriptions${identifier ? `-${identifier}` : ""}.json` :
    `UserData/${uid}/Uploads/Processed/${sku}/${sku}-transcriptions-${chapter}${identifier ? `-${identifier}` : ""}.json`;
}

/**
 * Save uncorrected transcriptions as fallback
 * @param {string} uid - User ID
 * @param {string} sku - Book SKU
 * @param {string} identifier - Identifier for the transcriptions (optional)
 * @param {Object} transcriptions - Transcriptions object
 */
async function saveUncorrectedTranscriptions({uid, sku, transcriptions, identifier = null}) {
  const transcriptionPath = getTranscriptionsPath({uid, sku, identifier});

  // Always upload/overwrite uncorrected transcriptions
  await uploadJsonToBucket({json: transcriptions, bucketPath: transcriptionPath});
  logger.debug(`saveUncorrectedTranscriptions: Uploaded uncorrected transcriptions to ${transcriptionPath}`);
}

/**
 * Load transcriptions from storage
 * @param {string} uid - User ID
 * @param {string} sku - Book SKU
 * @param {number} chapter - Chapter number (optional)
 * @return {Object} The transcriptions object
 */
async function loadTranscriptions({uid, sku, chapter}) {
  const transcriptionPath = getTranscriptionsPath({uid, sku, chapter});

  try {
    const transcriptions = await getJsonFile({filename: transcriptionPath});
    logger.debug(`loadTranscriptions: Loaded transcriptions from ${transcriptionPath}`);
    return transcriptions;
  } catch (error) {
    logger.error(`loadTranscriptions: Failed to load transcriptions from ${transcriptionPath}: ${error}`);
    throw error;
  }
}

/**
 * Check if transcriptions exist
 * @param {string} uid - User ID
 * @param {string} sku - Book SKU
 * @param {number} chapter - Chapter number (optional)
 * @return {boolean} True if transcriptions exist
 */
async function transcriptionsExist({uid, sku, chapter}) {
  const transcriptionPath = getTranscriptionsPath({uid, sku, chapter});
  return await fileExists({path: transcriptionPath});
}

export {
  getTranscriptionsPath,
  saveUncorrectedTranscriptions,
  loadTranscriptions,
  transcriptionsExist,
};
