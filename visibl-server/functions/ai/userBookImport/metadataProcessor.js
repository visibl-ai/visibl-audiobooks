import {OpenRouterClient} from "../openrouter/base.js";
import {loadTranscriptions} from "../transcribe/transcriptionStorage.js";
import globalPrompts from "../prompts/globalPrompts.js";
import logger from "../../util/logger.js";
import ffmpeg from "fluent-ffmpeg";
import fs from "fs/promises";
import path from "path";
import OpenAI from "openai";
import {OPENAI_API_KEY} from "../../config/config.js";

/**
 * Extract title and author from first chapter transcription using DeepSeek LLM
 * @param {Object} params - Parameters object
 * @param {string} params.uid - User ID
 * @param {string} params.sku - Book SKU
 * @param {Object} params.transcriptions - Optional transcriptions
 * @param {Object} params.mockResponse - Optional mock response for testing
 * @param {string} params.tentativeTitle - Optional tentative title for book
 * @return {Promise<Object>} Extracted metadata with title and author
 */
export async function extractTitleAndAuthorFromTranscription({uid, sku, transcriptions={}, mockResponse, tentativeTitle="Untitled"}) {
  try {
    logger.info(`Extracting title and author from transcription for SKU: ${sku}`);

    // 1. Load full book transcription
    const fullTranscriptions = transcriptions && Object.keys(transcriptions).length > 0 ?
      transcriptions : await loadTranscriptions({uid, sku});

    // Check if transcriptions exist
    if (!fullTranscriptions || Object.keys(fullTranscriptions).length === 0) {
      logger.warn(`No transcriptions found for ${sku}`);
      return {
        title: "",
        author: "",
        error: "No transcription available",
      };
    }

    // 2. Extract segments until we have at least 15 (intro typically in first 10 seconds)
    const targetSegmentCount = 15;
    const allSegments = [];
    let chaptersProcessed = 0;

    // Sort chapter keys numerically to process in order
    const chapterKeys = Object.keys(fullTranscriptions)
        .filter((key) => key !== "error") // Exclude any error keys
        .sort((a, b) => parseInt(a) - parseInt(b));

    // Collect segments from multiple chapters until we have at least 15
    for (const chapterKey of chapterKeys) {
      const chapterSegments = fullTranscriptions[chapterKey];

      if (!chapterSegments || !Array.isArray(chapterSegments)) {
        logger.debug(`Skipping invalid chapter ${chapterKey} for ${sku}`);
        continue;
      }

      // Add all segments from this chapter
      allSegments.push(...chapterSegments);
      chaptersProcessed++;

      // Check if we have enough segments
      if (allSegments.length >= targetSegmentCount) {
        break;
      }
    }

    if (allSegments.length === 0) {
      logger.warn(`No valid segments found in transcriptions for ${sku}`);
      return {
        title: "",
        author: "",
        error: "No valid segments in transcription",
      };
    }

    // Take up to 15 segments from the combined chapters
    const segmentCount = Math.min(targetSegmentCount, allSegments.length);
    const transcriptText = allSegments
        .slice(0, segmentCount)
        .map((seg) => seg.text || "")
        .join(" ")
        .trim();

    if (!transcriptText) {
      logger.warn(`Empty transcription text for ${sku} from ${chaptersProcessed} chapters`);
      return {
        title: "",
        author: "",
        error: "Transcription text is empty",
      };
    }

    logger.debug(`Processing ${segmentCount} segments from ${chaptersProcessed} chapter(s) for ${sku}`);

    // 3. Call DeepSeek via OpenRouter
    const openRouterClient = new OpenRouterClient();
    const result = await openRouterClient.sendRequest({
      promptOverride: globalPrompts.EXTRACT_TITLE_AUTHOR_FROM_TRANSCRIPTION,
      message: transcriptText,
      replacements: [{key: "TRANSCRIPT", value: transcriptText}, {key: "TITLE", value: tentativeTitle || "Untitled"}],
      analyticsOptions: {
        uid,
        sku,
        promptId: "extract_metadata_from_transcription",
      },
      mockResponse,
    });

    // Handle error response
    if (result.error) {
      logger.error(`Failed to extract metadata for ${sku}: ${result.error}`);
      return {
        title: "",
        author: "",
        error: result.error,
      };
    }

    // 4. Return extracted metadata
    const extractedData = {
      title: result.result.title || "",
      author: result.result.author || "",
      confidence: result.result.confidence || "unknown",
      tokensUsed: result.tokensUsed,
    };

    logger.info(`Extraction complete for ${sku}. Title: "${extractedData.title}", Author: "${extractedData.author}", Confidence: ${extractedData.confidence}`);

    return extractedData;
  } catch (error) {
    logger.error(`Error extracting title/author for ${sku}:`, error);
    throw error;
  }
}

/**
 * Moderate metadata fields for safety and policy compliance using OpenAI + DeepSeek
 * @param {Object} params - Parameters object
 * @param {Object} params.metadata - Metadata object to moderate
 * @param {string} params.uid - User ID for analytics
 * @param {string} params.sku - Book SKU for analytics
 * @param {Object} params.mockResponse - Optional mock response for testing
 * @return {Promise<Object>} Moderated metadata with wasModerated flag
 */
export async function moderateMetadata({metadata, uid, sku, mockResponse}) {
  try {
    // If no metadata provided, return empty result
    if (!metadata || Object.keys(metadata).length === 0) {
      logger.info(`No metadata to moderate for ${sku}`);
      return {
        ...metadata,
        wasModerated: false,
      };
    }

    logger.info(`Moderating metadata for SKU: ${sku}`);

    // Prepare metadata for moderation - extract only fields we want to moderate
    const fieldsToModerate = {};

    // Add common fields if they exist
    if (metadata.title) fieldsToModerate.title = metadata.title;
    if (metadata.author) fieldsToModerate.author = metadata.author;
    if (metadata.description) fieldsToModerate.description = metadata.description;

    // Add chapter titles if they exist
    if (metadata.chapters && typeof metadata.chapters === "object") {
      fieldsToModerate.chapters = {};
      Object.keys(metadata.chapters).forEach((chapterKey) => {
        const chapter = metadata.chapters[chapterKey];
        if (chapter && chapter.title) {
          fieldsToModerate.chapters[chapterKey] = chapter.title;
        }
      });
    }

    // If no fields need moderation, return original
    if (Object.keys(fieldsToModerate).length === 0) {
      logger.info(`No moderatable fields found for ${sku}`);
      return {
        ...metadata,
        wasModerated: false,
      };
    }

    // Step 1: Use OpenAI Moderation API to check for flagged content
    const flaggedFields = {};
    const openAIModerationFlags = {};

    try {
      const openai = new OpenAI({apiKey: OPENAI_API_KEY.value()});

      // Prepare text for moderation - combine all text fields
      const textsToModerate = [];
      const fieldMapping = [];

      // Add title
      if (fieldsToModerate.title) {
        textsToModerate.push(fieldsToModerate.title);
        fieldMapping.push({field: "title", value: fieldsToModerate.title});
      }

      // Add author
      if (fieldsToModerate.author) {
        const authorText = Array.isArray(fieldsToModerate.author) ?
          fieldsToModerate.author.join(", ") : fieldsToModerate.author;
        textsToModerate.push(authorText);
        fieldMapping.push({field: "author", value: fieldsToModerate.author});
      }

      // Add description
      if (fieldsToModerate.description) {
        textsToModerate.push(fieldsToModerate.description);
        fieldMapping.push({field: "description", value: fieldsToModerate.description});
      }

      // Add chapter titles
      if (fieldsToModerate.chapters) {
        Object.keys(fieldsToModerate.chapters).forEach((chapterKey) => {
          const chapterTitle = fieldsToModerate.chapters[chapterKey];
          textsToModerate.push(chapterTitle);
          fieldMapping.push({field: "chapter", chapterKey: chapterKey, value: chapterTitle});
        });
      }

      logger.debug(`Checking ${textsToModerate.length} text items with OpenAI Moderation API`);

      // Call OpenAI moderation API
      const moderationResponse = await openai.moderations.create({
        input: textsToModerate,
      });

      // Process moderation results
      moderationResponse.results.forEach((result, index) => {
        if (result.flagged) {
          const mapping = fieldMapping[index];
          logger.info(`OpenAI flagged content in ${mapping.field} for ${sku}: ${JSON.stringify(result.categories)}`);

          // Store flagged fields for DeepSeek moderation
          if (mapping.field === "chapter") {
            if (!flaggedFields.chapters) flaggedFields.chapters = {};
            flaggedFields.chapters[mapping.chapterKey] = mapping.value;
          } else {
            flaggedFields[mapping.field] = mapping.value;
          }

          // Store flags for logging - sanitize category keys for Firebase
          const sanitizedCategories = {};
          Object.keys(result.categories).forEach((category) => {
            // Replace forward slashes with underscores for Firebase compatibility
            const sanitizedKey = category.replace(/\//g, "_");
            sanitizedCategories[sanitizedKey] = result.categories[category];
          });

          if (mapping.field === "chapter") {
            // For chapters, store with chapter key
            const chapterFlagKey = `chapter_${mapping.chapterKey}`;
            openAIModerationFlags[chapterFlagKey] = sanitizedCategories;
          } else {
            openAIModerationFlags[mapping.field] = sanitizedCategories;
          }
        }
      });

      logger.info(`OpenAI moderation complete for ${sku}. Flagged fields: ${Object.keys(flaggedFields).length}`);
    } catch (openAIError) {
      logger.warn(`OpenAI moderation failed for ${sku}, proceeding with all fields: ${openAIError.message}`);
      // If OpenAI moderation fails, send all fields to DeepSeek as fallback
      Object.assign(flaggedFields, fieldsToModerate);
    }

    // Step 2: Only send flagged fields to DeepSeek for further moderation
    // If no fields were flagged, return original metadata
    if (Object.keys(flaggedFields).length === 0) {
      logger.info(`No fields flagged by OpenAI for ${sku}, skipping DeepSeek moderation`);
      return {
        ...metadata,
        wasModerated: false,
      };
    }

    // Call DeepSeek via OpenRouter for moderation of flagged fields only
    logger.info(`Sending ${Object.keys(flaggedFields).length} flagged fields to DeepSeek for ${sku}`);
    const openRouterClient = new OpenRouterClient();
    const result = await openRouterClient.sendRequest({
      promptOverride: globalPrompts.MODERATE_METADATA,
      message: JSON.stringify(flaggedFields),
      replacements: [{key: "METADATA", value: JSON.stringify(flaggedFields, null, 2)}],
      analyticsOptions: {
        uid,
        sku,
        promptId: "moderate_metadata",
      },
      mockResponse,
    });

    // Handle error response
    if (result.error) {
      logger.error(`Failed to moderate metadata with DeepSeek for ${sku}: ${result.error}`);
      // On error, return original metadata unmoderated
      return {
        ...metadata,
        wasModerated: false,
        moderationError: result.error,
        openAIModerationFlags,
      };
    }

    // Extract moderation result
    const moderationResult = result.result;
    const wasModerated = moderationResult.wasModerated || false;

    // Return original metadata if no moderation was needed
    if (!wasModerated) {
      logger.info(`No further moderation needed by DeepSeek for ${sku}`);
      return {
        ...metadata,
        wasModerated: false,
      };
    }

    // Merge moderated fields back into original metadata
    const moderatedMetadata = {...metadata};

    // Only apply fields that were actually changed (different from original flagged values)
    if (moderationResult.title !== undefined && moderationResult.title !== flaggedFields.title) {
      moderatedMetadata.title = moderationResult.title;
      logger.info(`Moderated title for ${sku}: "${flaggedFields.title}" -> "${moderationResult.title}"`);
    }
    if (moderationResult.author !== undefined) {
      // For author, check if the value actually changed (handle array comparison)
      const originalAuthor = Array.isArray(flaggedFields.author) ?
        flaggedFields.author.join(", ") : flaggedFields.author;
      const moderatedAuthor = Array.isArray(moderationResult.author) ?
        moderationResult.author.join(", ") : moderationResult.author;

      if (originalAuthor !== moderatedAuthor) {
        moderatedMetadata.author = moderationResult.author;
        logger.info(`Moderated author for ${sku}: "${originalAuthor}" -> "${moderatedAuthor}"`);
      }
    }
    if (moderationResult.description !== undefined && moderationResult.description !== flaggedFields.description) {
      moderatedMetadata.description = moderationResult.description;
      logger.info(`Moderated description for ${sku}`);
    }

    // Apply moderated chapter titles (only if actually changed)
    if (moderationResult.chapters && typeof moderationResult.chapters === "object") {
      Object.keys(moderationResult.chapters).forEach((chapterKey) => {
        const originalChapterTitle = flaggedFields.chapters?.[chapterKey];
        const moderatedChapterTitle = moderationResult.chapters[chapterKey];

        if (originalChapterTitle !== moderatedChapterTitle &&
            moderatedMetadata.chapters && moderatedMetadata.chapters[chapterKey]) {
          moderatedMetadata.chapters[chapterKey] = {
            ...moderatedMetadata.chapters[chapterKey],
            title: moderatedChapterTitle,
          };
          logger.info(`Moderated chapter ${chapterKey} title for ${sku}`);
        }
      });
    }

    // Add moderation metadata
    moderatedMetadata.wasModerated = wasModerated;
    if (wasModerated && moderationResult.moderationNotes) {
      moderatedMetadata.moderationNotes = moderationResult.moderationNotes;
    }

    // Add OpenAI moderation flags if any fields were flagged
    if (Object.keys(openAIModerationFlags).length > 0) {
      moderatedMetadata.openAIModerationFlags = openAIModerationFlags;
    }

    moderatedMetadata.tokensUsed = result.tokensUsed;

    return moderatedMetadata;
  } catch (error) {
    logger.error(`Error moderating metadata for ${sku}:`, error);
    // On error, return original metadata
    return {
      ...metadata,
      wasModerated: false,
      moderationError: error.message,
    };
  }
}

/**
 * Extract metadata from M4B file using ffmpeg -f ffmetadata
 * Standardized to match the bindings format
 * @param {string} filePath - Path to the M4B file
 * @param {number} retryCount - Internal retry counter (default 0)
 * @return {Promise<Object>} Metadata object with standardized format
 */
export async function extractMetadata(filePath, retryCount = 0) {
  const maxRetries = 1;
  let stderrOutput = "";
  // Initialize with standardized bindings format
  const metadata = {
    title: "",
    author: [],
    year: "",
    description: "",
    language: "english", // Default, can be overridden
    bitrate_kbs: 0,
    codec: "aac", // Default, can be overridden
    chapters: {},
    length: 0,
    numChapters: 0,
  };

  // Keep temporary arrays for intermediate processing
  const tempChapters = [];
  const tempTags = {};

  // Generate a temp file path for ffmetadata output
  const tempMetadataFile = path.join(path.dirname(filePath), `${path.basename(filePath)}.metadata.txt`);

  try {
    // Use ffmpeg -i INPUT -f ffmetadata OUTPUT to extract metadata in a structured format
    await new Promise((resolve, reject) => {
      const command = ffmpeg(filePath)
          .outputFormat("ffmetadata")
          .output(tempMetadataFile)
          .on("start", (commandLine) => {
            logger.debug(`extractMetadata: ${commandLine}`);
          })
          .on("stderr", (stderrLine) => {
            stderrOutput += stderrLine + "\n";
          })
          .on("end", () => {
            resolve();
          })
          .on("error", (err) => {
            // Extract basic metadata from stderr even on error
            logger.warn(`FFmpeg returned error (expected for metadata extraction): ${err.message}`);
            resolve(); // Still resolve as we can extract from stderr
          });

      command.run();
    });

    // Parse stderr for duration and bitrate
    if (stderrOutput) {
      // Extract duration
      const durationMatch = stderrOutput.match(/Duration: (\d{2}):(\d{2}):(\d{2}\.\d{2})/);
      if (durationMatch) {
        const hours = parseFloat(durationMatch[1]);
        const minutes = parseFloat(durationMatch[2]);
        const seconds = parseFloat(durationMatch[3]);
        metadata.length = hours * 3600 + minutes * 60 + seconds;
      }

      // Extract bitrate
      const bitrateMatch = stderrOutput.match(/bitrate: (\d+) kb\/s/);
      if (bitrateMatch) {
        metadata.bitrate_kbs = parseInt(bitrateMatch[1]);
      }

      // Extract codec from audio stream info
      const codecMatch = stderrOutput.match(/Audio: ([a-zA-Z0-9_]+)/);
      if (codecMatch) {
        metadata.codec = codecMatch[1].toLowerCase();
      }

      // Extract basic tags from stderr Metadata section
      const metadataSection = stderrOutput.match(/Metadata:([\s\S]*?)(?=Stream|Chapter|\n\s*$)/);
      if (metadataSection) {
        const metadataLines = metadataSection[1].split("\n");
        metadataLines.forEach((line) => {
          const tagMatch = line.trim().match(/^\s*(.+?)\s*:\s*(.+)$/);
          if (tagMatch) {
            const key = tagMatch[1].toLowerCase().replace(/\s+/g, "_");
            tempTags[key] = tagMatch[2];
          }
        });
      }

      // Extract chapters from stderr
      const chapterMatches = stderrOutput.matchAll(/Chapter #\d+:\d+: start ([\d.]+), end ([\d.]+)([\s\S]*?)(?=Chapter #|Stream #|$)/g);
      for (const match of chapterMatches) {
        const chapter = {
          startTime: parseFloat(match[1]),
          endTime: parseFloat(match[2]),
          title: "",
        };

        const chapterMetadata = match[3];
        if (chapterMetadata) {
          const titleMatch = chapterMetadata.match(/title\s*:\s*(.+)/i);
          if (titleMatch) {
            chapter.title = titleMatch[1].trim();
          }
        }

        tempChapters.push(chapter);
      }
    }

    // Try to read the ffmetadata file if it was created
    try {
      const ffmetadataContent = await fs.readFile(tempMetadataFile, "utf8");

      // Parse ffmetadata format
      const lines = ffmetadataContent.split("\n");
      let currentSection = "header";
      let currentChapter = null;
      const chaptersFromFile = [];

      lines.forEach((line) => {
        line = line.trim();

        // Skip comments and empty lines
        if (line.startsWith(";") || line === "") return;

        // Detect section headers
        if (line === "[CHAPTER]") {
          // Save previous chapter if exists
          if (currentChapter) {
            chaptersFromFile.push(currentChapter);
          }
          currentChapter = {
            title: "",
            startTime: 0,
            endTime: 0,
          };
          currentSection = "chapter";
          return;
        }

        // Parse key=value pairs
        const match = line.match(/^([^=]+)=(.*)$/);
        if (match) {
          const key = match[1].trim();
          const value = match[2].trim();

          if (currentSection === "header") {
            // Override tags from ffmetadata file (more reliable)
            tempTags[key.toLowerCase()] = value;
          } else if (currentSection === "chapter" && currentChapter) {
            // Chapter metadata
            if (key === "TIMEBASE") {
              currentChapter.time_base = value;
              // Parse the timebase fraction (e.g., "1/44100" -> 44100)
              const timebaseMatch = value.match(/^1\/(\d+)$/);
              if (timebaseMatch) {
                currentChapter.time_base_divisor = parseInt(timebaseMatch[1]);
              }
            } else if (key === "START") {
              const startRaw = parseFloat(value);
              // Convert based on timebase divisor to seconds
              const divisor = currentChapter.time_base_divisor || 1000;
              currentChapter.startTime = startRaw / divisor;
            } else if (key === "END") {
              const endRaw = parseFloat(value);
              // Convert based on timebase divisor to seconds
              const divisor = currentChapter.time_base_divisor || 1000;
              currentChapter.endTime = endRaw / divisor;
            } else {
              // Chapter tags (like title)
              if (key.toLowerCase() === "title") {
                currentChapter.title = value;
              }
            }
          }
        }
      });

      // Don't forget the last chapter
      if (currentChapter) {
        chaptersFromFile.push(currentChapter);
      }

      // If we got chapters from file, use those (more accurate)
      if (chaptersFromFile.length > 0) {
        // Clear any chapters from stderr and use file chapters
        tempChapters.length = 0;
        tempChapters.push(...chaptersFromFile);
      }

      // Clean up temp file
      await fs.unlink(tempMetadataFile).catch(() => {});
    } catch (readError) {
      logger.debug(`Could not read ffmetadata file, using stderr data: ${readError.message}`);
    }

    // Populate metadata from extracted tags
    if (tempTags) {
      // Title
      metadata.title = tempTags.title || tempTags.album || "";

      // Remove "(Unabridged)" from title if present (case-insensitive)
      metadata.title = metadata.title.replace(/\s*\(unabridged\)\s*/gi, "").trim();

      // Author (convert to array)
      const authorValue = tempTags.artist || tempTags.album_artist || tempTags.author || "";
      if (authorValue) {
        metadata.author = [authorValue];
      } else {
        metadata.author = [];
      }

      // Other fields
      metadata.year = tempTags.date || tempTags.year || "";
      metadata.description = tempTags.comment || tempTags.description || "";
      metadata.genre = tempTags.genre || "";

      // Language if present
      if (tempTags.language) {
        metadata.language = tempTags.language.toLowerCase();
      }
    }

    // Convert chapters array to object with string keys
    if (tempChapters.length > 0) {
      tempChapters.forEach((chapter, index) => {
        metadata.chapters[index.toString()] = {
          startTime: chapter.startTime,
          endTime: chapter.endTime,
          title: chapter.title || `Chapter ${index + 1}`,
        };
      });

      // Update length to the last chapter's end time if not already set
      const lastChapter = tempChapters[tempChapters.length - 1];
      if (lastChapter && !metadata.length) {
        metadata.length = lastChapter.endTime;
      }
    }

    // Set number of chapters
    metadata.numChapters = Object.keys(metadata.chapters).length;

    logger.info(`extractMetadata: Found ${metadata.numChapters} chapters, duration: ${metadata.length}s`);
    return metadata;
  } catch (error) {
    logger.error(`Failed to extract metadata (attempt ${retryCount + 1}/${maxRetries + 1}): ${error.message}`);

    // Retry once if this is the first attempt
    if (retryCount < maxRetries) {
      logger.info(`Retrying metadata extraction for ${filePath}...`);
      // Wait a short time before retrying
      await new Promise((resolve) => setTimeout(resolve, 1000));
      return extractMetadata(filePath, retryCount + 1);
    }

    // If we've exhausted retries, throw an exception
    logger.error(`Failed to extract metadata after ${maxRetries + 1} attempts`);
    throw error;
  }
}

export default {
  extractTitleAndAuthorFromTranscription,
  moderateMetadata,
  extractMetadata,
};
