import logger from "../../util/logger.js";
import globalPrompts from "../prompts/globalPrompts.js";
import {queueAddEntries} from "../../storage/firestore/queue.js";
import {dispatchTask} from "../../util/dispatch.js";

/**
 * Generate a book cover prompt based on title and author
 * @param {Object} params - Parameters object
 * @param {string} params.title - Book title
 * @param {string} params.author - Book author
 * @return {string} Generated prompt for cover art
 */
function generateBookCoverPrompt({title, author}) {
  const promptTemplate = globalPrompts.GENERATE_BOOK_COVER.promptTemplate;
  const prompt = promptTemplate
      .replace("%TITLE%", title)
      .replace("%AUTHOR%", author);
  return prompt;
}

/**
 * Generate unique queue ID for book cover
 * @param {Object} params - Parameters object
 * @param {string} params.uid - User ID
 * @param {string} params.sku - Book SKU
 * @return {string} Unique queue ID
 */
function bookCoverQueueToUnique({uid, sku}) {
  return `wavespeed_generate_bookcover_${uid}_${sku}`;
}

/**
 * Generate book cover art using AI image generation via Wavespeed queue
 * @param {Object} params - Parameters object
 * @param {string} params.title - Book title
 * @param {string} params.author - Book author
 * @param {string} params.uid - User ID
 * @param {string} params.sku - Book SKU
 * @param {string} [params.model] - Image generation model (defaults to imagen4-fast)
 * @return {Promise<Object>} Queue result with success status
 */
export async function generateBookCover({title, author, uid, sku, modelOverride}) {
  try {
    logger.info(`Queueing book cover generation for "${title}" by ${author} (SKU: ${sku})`);

    // Validate inputs
    if (!title || !author) {
      throw new Error("Title and author are required to generate book cover");
    }

    // Use imagen4-fast model for book covers
    const imageModel = modelOverride || globalPrompts.GENERATE_BOOK_COVER.openAIModel;
    const outputFormat = globalPrompts.GENERATE_BOOK_COVER.imageConfig.outputFormat || "jpeg";

    // Generate the prompt
    const prompt = generateBookCoverPrompt({title, author});

    // Define output path for the generated image
    const outputPath = sku.startsWith("CSTM") ?
      `Catalogue/Custom/Processed/${sku}/${sku}.${outputFormat}` :
      `UserData/${uid}/Processed/${sku}/${sku}.${outputFormat}`;

    // Prepare queue entry arrays
    const types = ["wavespeed"];
    const entryTypes = ["generate"];
    const entryParams = [{
      prompt,
      model: imageModel,
      outputPath,
      outputFormat,
      modelParams: {
        aspect_ratio: "1:1",
        seed: Math.floor(Math.random() * 2 ** 32),
        enable_base64_output: true,
        enable_safety_checker: false,
      },
      uid,
      sku,
      title,
      author,
      type: "coverArt",
    }];
    const uniques = [bookCoverQueueToUnique({uid, sku})];

    // Add to queue
    const queueResult = await queueAddEntries({
      types,
      entryTypes,
      entryParams,
      uniques,
    });

    if (queueResult.success) {
      logger.info(`Book cover generation queued successfully for ${sku}`);

      // Dispatch the wavespeed queue
      await dispatchTask({
        functionName: "launchWavespeedQueue",
        data: {},
      });

      return {
        success: true,
        queued: true,
        queueId: queueResult.ids?.[0],
        title,
        author,
        sku,
        model: imageModel,
        prompt,
      };
    } else {
      logger.error(`Failed to queue book cover generation for ${sku}`);
      return {
        success: false,
        error: "Failed to queue book cover generation",
        title,
        author,
        sku,
      };
    }
  } catch (error) {
    logger.error(`Error queueing book cover for ${sku}:`, error);
    return {
      success: false,
      error: error.message,
      title,
      author,
      sku,
    };
  }
}

/**
 * Generate book cover from extracted metadata
 * @param {Object} params - Parameters object
 * @param {Object} params.metadata - Extracted metadata object
 * @param {string} params.uid - User ID
 * @param {string} params.sku - Book SKU
 * @param {string} [params.model] - Image generation model
 * @return {Promise<Object>} Generated cover data
 */
export async function generateBookCoverFromMetadata({metadata, uid, sku, model}) {
  try {
    // Check if metadata has title and author
    if (!metadata || !metadata.title || !metadata.author) {
      logger.warn(`Cannot generate cover for ${sku}: missing title or author in metadata`);
      return {
        success: false,
        error: "Missing title or author in metadata",
        sku,
      };
    }

    // Generate the cover
    return await generateBookCover({
      title: metadata.title,
      author: metadata.author,
      uid,
      sku,
      model,
    });
  } catch (error) {
    logger.error(`Error generating cover from metadata for ${sku}:`, error);
    throw error;
  }
}

export default {
  generateBookCover,
  generateBookCoverFromMetadata,
  generateBookCoverPrompt,
};
