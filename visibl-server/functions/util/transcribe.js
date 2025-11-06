import {getTranscriptionsPath, loadTranscriptions} from "../ai/transcribe/index.js";
import {uploadFileToBucket} from "../storage/storage.js";
import logger from "../util/logger.js";


/**
 * Stitch chapters into the main transcription file
 * Merges new chapters with existing transcription data instead of overwriting
 * @param {string} uid - The UID of the user
 * @param {string} sku - The SKU of the book
 * @param {Array} chapters - Array of {chapter, result} objects to add/update
 */
async function stichTranscriptionChapters({uid, sku, chapters}) {
  const transcriptionPath = getTranscriptionsPath({uid, sku});

  // Load existing transcription if it exists
  let transcriptionJson = {};
  try {
    const existingTranscription = await loadTranscriptions({uid, sku});
    if (existingTranscription) {
      transcriptionJson = {...existingTranscription};
      logger.info(`stichTranscriptionChapters: Loaded existing transcription with ${Object.keys(transcriptionJson).length} chapters for ${sku}`);
    }
  } catch (error) {
    // File doesn't exist yet, start with empty object
    logger.info(`stichTranscriptionChapters: No existing transcription found for ${sku}, creating new one`);
  }

  // Merge new chapters into the transcription object
  for (const {chapter, result} of chapters) {
    transcriptionJson[chapter] = result;
  }

  const chapterNumbers = chapters.map((c) => c.chapter).sort((a, b) => parseInt(a) - parseInt(b));
  const totalChapters = Object.keys(transcriptionJson).sort((a, b) => parseInt(a) - parseInt(b));
  logger.info(`stichTranscriptionChapters: Adding/updating ${chapterNumbers.length} chapters for ${sku}`);
  logger.info(`stichTranscriptionChapters: Updated chapters: ${chapterNumbers.join(", ")}`);
  logger.info(`stichTranscriptionChapters: Total chapters after update: ${totalChapters.join(", ")}`);

  // Write the merged transcription
  await uploadFileToBucket({
    bucketPath: transcriptionPath,
    content: JSON.stringify(transcriptionJson, null, 2),
    contentType: "application/json",
  });

  logger.info(`stichTranscriptionChapters: Successfully uploaded transcription with ${totalChapters.length} total chapters to ${transcriptionPath}`);
}

export {stichTranscriptionChapters};
