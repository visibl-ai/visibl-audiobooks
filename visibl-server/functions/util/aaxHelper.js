/* eslint-disable require-jsdoc */
import axios from "axios";
import logger from "./logger.js";
import fs from "fs/promises";
import {AUDIBLE_OPDS_API_KEY,
  AUDIBLE_OPDS_FIREBASE_URL,
  STORAGE_BUCKET_ID,
  ENVIRONMENT,
  BOOK_RUNTIME_MIN,
} from "../config/config.js";

import {
  setAAXConnectDisableFirestore,
} from "../storage/firestore/users.js";

import {
  usersUpdateImportedList,
  deleteImportedList,
} from "../storage/realtimeDb/users.js";

import {
  aaxStoreAuthFirestore,
  aaxGetAuthByAAXIdFirestore,
  aaxStoreItemsFirestore,
  aaxUpdateItemFirestore,
  aaxGetItemsFirestore,
  aaxGetItemFirestore,
  aaxDeleteItemsByUidFirestore,
} from "../storage/firestore/aax.js";

import {
  populateCatalogueWithAAXItems,
  catalogueUpdateRtdb,
  catalogueGetRtdb,
} from "../storage/realtimeDb/catalogue.js";

import {
  libraryDeleteAllPrivateItemsRtdb,
  libraryUpdateTranscriptionStatusRtdb,
  libraryGetRtdb,
} from "../storage/realtimeDb/library.js";

import {
  queueAddEntries,
} from "../storage/firestore/queue.js";

import {OpenRouterClient, OpenRouterMockResponse} from "../ai/openrouter/base.js";

import pLimit from "p-limit";

import {sendTranscriptionToLlmWithQueue} from "../ai/transcribe/index.js";

import {
  uploadFileToBucket,
  getJsonFile,
  fileExists,
  getFilesByPrefix,
} from "../storage/storage.js";

import {
  dispatchTask,
} from "../util/dispatch.js";

import {
  checkAndInitiateGraphGeneration,
} from "./graphGenerationHelper.js";

import {stichTranscriptionChapters} from "./transcribe.js";
import {getTranscriptionsPath} from "../ai/transcribe/index.js";

function formatFunctionsUrl(functionName) {
  return `${AUDIBLE_OPDS_FIREBASE_URL.value().replace("FUNCTION", functionName.replace(/_/g, "-"))}/${functionName}`;
}

async function getAAXLibrary({uid, auth}) {
  try {
    const response = await axios.post(formatFunctionsUrl("audible_get_library"), {
      auth: auth,
      type: "raw",
    }, {
      headers: {
        "API-KEY": AUDIBLE_OPDS_API_KEY.value(),
      },
    });
    if (response.status === 200 && response.data.status === "success") {
      let library = response.data.library;
      if (ENVIRONMENT.value() === "development") {
        logger.info("TEST, return reduced list for library.");
        const skus = [process.env.SKU1, process.env.SKU2];
        library = library.filter((item) => skus.includes(item.sku_lite));
        logger.info(`Reduced library to ${library.length} items for development environment.`);
        logger.debug(`Library: ${JSON.stringify(library)}`);
      }
      // Process the library data here
      // For example, you might want to store it in Firestore or perform other operations
      logger.info(`getAAXLibrary: Successfully retrieved AAX library for user ${uid}, ${library.length} items found`);
      return library;
    } else {
      logger.error(`getAAXLibrary: Failed to retrieve AAX library for user ${uid}`, response.data);
      return;
    }
  } catch (error) {
    logger.error(`getAAXLibrary: Error updating AAX catalogue for user ${uid}`, error);
    return {success: false, error: error.message};
  }
}

async function filterNewAAXLibraryItems({uid, library}) {
  // get current user items in aaxSync table.
  const aaxItems = await aaxGetItemsFirestore({uid});
  // find any new items in the library array.
  const newItems = library.filter((libraryItem) => {
    return !aaxItems.some((aaxItem) => aaxItem.sku === libraryItem.sku_lite);
  });
  // return the new items.
  return newItems;
}

async function downloadAAXC({uid, auth, newItems}) {
  const downloadedItems = [];
  const limit = pLimit(6); // Limit to 6 concurrent downloads (3 instances with 2 concurrency)

  await Promise.all(newItems.map((item) =>
    limit(async () => {
      try {
        if (ENVIRONMENT.value() === "development") {
          logger.info(`Download of AAXC for item ${item.asin} in development environment.`);
          item.transcriptionsGenerated = false;
          item.licenceRules = [{"name": "DefaultExpiresRule", "parameters": [{"expireDate": "3000-01-01T00:00:00Z", "type": "EXPIRES"}]}];
          if (item.sku_lite === process.env.SKU1) {
            item.key = process.env.SKU1KEYIV.split(":")[0];
            item.iv = process.env.SKU1KEYIV.split(":")[1];
          } else if (item.sku_lite === process.env.SKU2) {
            item.key = process.env.SKU2KEYIV.split(":")[0];
            item.iv = process.env.SKU2KEYIV.split(":")[1];
          }
          downloadedItems.push(item);
        } else { // Production
          logger.debug(`downloadAAXC: uid: ${uid}, Downloading AAXC for item ${item.sku_lite} in production environment.`);
          item = await triggerDownload({item, auth, uid});
          downloadedItems.push(item);
        }
      } catch (error) {
        const errorMessage = error.toString().substring(0, 500);
        logger.error(`Error downloading AAXC for item ${item.asin}`, errorMessage);
      }
    }),
  ));
  return downloadedItems;
}

async function queueTranscription({uid, itemsToTranscribe}) {
  for (const item of itemsToTranscribe) {
    await queueAddEntries({
      types: ["transcription"],
      entryTypes: ["aaxc"],
      entryParams: [{uid, item}],
      uniques: [aaxcTranscribeQueueToUnique({type: "transcription", entryType: "aaxc", uid, itemId: item.id})],
    });
  }
}

// TODO: Delete later after full process is working with
// device transcriptions.
async function aaxPostAuthHook(uid, data) {
  logger.debug(`aaxPostAuthHook: uid: ${uid}`);
  const auth = data.auth;
  const audibleUserId = auth.customer_info.user_id;
  // 1. Check that no other user has already registered this AAX account
  // (no account sharing/piracy)
  const existingAuth = await aaxGetAuthByAAXIdFirestore({aaxUserId: audibleUserId});
  if (existingAuth && existingAuth.uid !== uid) {
    logger.error(`AAX account already registered, ${audibleUserId}, ${existingAuth.uid}`);
    throw new Error("AAX Account already in use by another user. Please have that user disconnect their account and try again.");
  }
  await aaxStoreAuthFirestore(uid, audibleUserId, auth);

  // 1. Get the library items.
  const library = await getAAXLibrary({uid, auth});
  logger.debug(`audiblePostAuthHook: uid: ${uid}, library: ${library.map((item) => item.sku_lite).join(", ")}`);
  if (library.success === false) {
    logger.error(`Failed to get AAX library for user ${uid}`, library.error);
    throw new Error("Failed to get AAX library");
  }
  const newItems = await filterNewAAXLibraryItems({uid, library});
  logger.debug(`audiblePostAuthHook: uid: ${uid}, newItems: ${newItems.map((item) => item.sku).join(", ")}`);
  // 1.1 For any new items, do a download
  const downloadedItems = await downloadAAXC({uid, auth, newItems});
  logger.debug(`audiblePostAuthHook: uid: ${uid}, downloadedItems: ${downloadedItems.map((item) => item.sku).join(", ")}`);
  // add downloaded items to the aaxSync table.
  await aaxStoreItemsFirestore({uid, library: downloadedItems});

  // 2 classify items as fiction or non-fiction.
  for (const item of downloadedItems) {
    try {
      const isFiction = await classifyNovelFiction({
        title: item.title,
        author: item.author,
        description: item.description || "",
      });
      item.fiction = isFiction;
      logger.info(`audiblePostAuthHook: uid: ${uid}, Classified ${item.title} as ${isFiction ? "fiction" : "non-fiction"}`);
    } catch (error) {
      logger.error(`audiblePostAuthHook: uid: ${uid}, Error classifying ${item.title}:`, error);
      item.fiction = true; // Default to fiction on error
    }
    const id = `${uid}:${item.sku_lite}`;
    await aaxUpdateItemFirestore({id, fiction: item.fiction});
  }


  // 3. Add fiction items to the catalogue.
  // get aaxItems from DB again in case there was a missed item last time.
  const aaxItems = await aaxGetItemsFirestore({uid});
  let fictionItems = aaxItems.filter((item) => item.fiction === true);
  fictionItems = fictionItems.map((item) => ({
    type: "audiobook",
    title: item.title,
    visibility: "private",
    addedBy: uid,
    sku: item.sku,
    fiction: item.fiction,
  }));
  await populateCatalogueWithAAXItems({uid, items: fictionItems});

  // 4. add fiction items to users imported list.
  await usersUpdateImportedList({uid});
}

async function triggerDownload({item, auth, uid, retry = false}) {
  const response = await axios.post(formatFunctionsUrl("audible_download_aaxc"), {
    country_code: auth.locale_code, // You might want to make this dynamic based on user's country
    auth: auth,
    asin: item.asin,
    sku: item.sku_lite,
    bucket: STORAGE_BUCKET_ID.value(),
    path: `UserData/${uid}/Uploads/AAXRaw/`,
  }, {
    headers: {
      "API-KEY": AUDIBLE_OPDS_API_KEY.value(),
    },
  });
  if (response.status === 200 && response.data.status === "success") {
    logger.info(`Successfully downloaded aaxc for item ${item.asin}`);
    item.transcriptionsGenerated = false;
    item.key = response.data.key;
    item.iv = response.data.iv;
    item.licenceRules = response.data.licence_rules;
    return item;
  } else if (retry) {
    return triggerDownload({item, auth, uid, retry: false});
  } else {
    throw new Error(`Failed to download aaxc for item ${item.asin}`);
  }
}

function aaxcTranscribeQueueToUnique(params) {
  const {type, entryType, uid, itemId, retry = false} = params;
  // Check if any of the required parameters are undefined
  if (type === undefined || entryType === undefined || uid === undefined ||
    itemId === undefined) {
    throw new Error("All parameters (type, entryType, uid, itemId) must be defined");
  }

  // If all parameters are defined, return a unique identifier
  const retryString = retry ? "_retry" : "";
  return `${type}_${entryType}_${uid}_${itemId}${retryString}`;
}

async function connectAAXAuth({uid, aaxUserId}) {
  const existingAuth = await aaxGetAuthByAAXIdFirestore({aaxUserId});
  if (existingAuth && existingAuth.uid !== uid) {
    return {success: false, error: "duplicate account"};
  }
  await aaxStoreAuthFirestore({uid, aaxUserId});
  return {success: true, message: "AAX account connected successfully"};
}

async function disconnectAAXAuth(uid) {
  // TODO: A lot more to delete here!
  await deleteImportedList({uid});
  await libraryDeleteAllPrivateItemsRtdb({uid});
  await aaxDeleteItemsByUidFirestore({uid});
  return await setAAXConnectDisableFirestore(uid);
}

async function updateAAXCChapterFileSizes({chapters, item, metadata}) {
  const chapterMap = {};
  await Promise.all(chapters.map(async (chapter, index) => {
    try {
      const stats = await fs.stat(chapter);
      chapterMap[index] = {
        fileSizeBytes: stats.size,
        startTime: metadata.startTimes[index],
        endTime: metadata.endTimes[index],
      };
    } catch (error) {
      logger.error(`Error getting file size for chapter ${chapter}:`, error);
      return chapter;
    }
  }));
  item.chapterMap = chapterMap;
  await aaxUpdateItemFirestore(item);
}

async function classifyNovelFiction({title, author, description}) {
  const openRouterClient = new OpenRouterClient();
  const response = await openRouterClient.sendRequest({
    prompt: "classifyNovelFiction",
    message: `${title} by ${author}, ${description}`,
    replacements: [],
    mockResponse: new OpenRouterMockResponse({
      content: {
        fiction: true,
      },
    }),
  });
  if (response.result) {
    return response.result.fiction;
  }
  return true; // Default to fiction if we can't classify.
}

async function updateAAXCLibrary({uid, data}) {
  try {
    logger.info(`updateAAXCLibrary: Processing aaxcLibrary for user ${uid}`);

    let aaxcLibrary;
    let bucketPath;

    // Check if we should use existing library from storage (for admin use only)
    if (data.useExistingLibrary === true) {
      logger.info(`updateAAXCLibrary: Using existing library from storage for user ${uid}`);

      // Fetch the latest library from storage
      // We need to get the most recent file from the user's AAXRaw folder
      const prefix = `UserData/${uid}/Uploads/AAXRaw/`;
      const files = await getFilesByPrefix({prefix});

      const libraryFiles = files
          .filter((file) => file.name.includes("aaxcLibrary_"))
          .sort((a, b) => b.metadata.timeCreated.localeCompare(a.metadata.timeCreated));

      if (libraryFiles.length === 0) {
        throw new Error("No existing library found in storage");
      }

      // Get the most recent library file
      const latestFile = libraryFiles[0].name;
      logger.info(`updateAAXCLibrary: Found latest library file: ${latestFile}`);

      aaxcLibrary = await getJsonFile({filename: latestFile});
      bucketPath = latestFile;
    } else {
      // Normal update: use provided library and store it
      if (!data.aaxcLibrary || !Array.isArray(data.aaxcLibrary.books)) {
        throw new Error("Invalid aaxcLibrary format. Expected object with 'books' array.");
      }

      aaxcLibrary = data.aaxcLibrary;

      // Store the library in Storage bucket
      bucketPath = `UserData/${uid}/Uploads/AAXRaw/aaxcLibrary_${Date.now()}.json`;
      await uploadFileToBucket({
        bucketPath: bucketPath,
        content: JSON.stringify(aaxcLibrary, null, 2),
        contentType: "application/json",
      });
    }

    const library = aaxcLibrary.books;
    logger.info(`updateAAXCLibrary: Found ${library.length} books in aaxcLibrary`);

    if (library.length === 0) {
      return {
        success: true,
        message: "No items to process",
        totalBooks: library.length,
        newItemsProcessed: 0,
      };
    }

    // For all books - update userAAXSync record
    const cleanLibrary = await Promise.all(library.map(async (book) => {
      const userLibrary = await aaxGetItemFirestore(`${uid}:${book.sku_lite}`) || {};
      // Overwrite userLibrary with book data
      const updatedLibrary = {
        ...userLibrary,
        ...book,
      };

      // Classify new items as fiction or non-fiction if not already classified
      if (updatedLibrary.fiction === undefined) {
        updatedLibrary.fiction = await classifyNovelFiction({
          title: book.title,
          author: book.authors,
          description: book.merchandising_summary,
        });
      }

      // Add fields used for filtering to the library
      updatedLibrary.isConsumableOffline = book.customer_rights?.is_consumable_offline;
      updatedLibrary.isListenable = book.is_listenable;
      updatedLibrary.runtimeLengthMinutes = book.runtime_length_min;

      return updatedLibrary;
    }));

    // Store updated library in Firestore
    await aaxStoreItemsFirestore({uid, library: cleanLibrary});

    // Get existing catalogue items from RTDB
    const existingCatalogs = await Promise.all(library.map(async (item) => {
      return await catalogueGetRtdb({sku: item.sku_lite});
    }));
    const existingCatalogueSkus = existingCatalogs.filter(Boolean).map((item) => item.sku);

    // Filter for items that aren't already in the catalogue
    const newCatalogueItems = cleanLibrary.filter((item) => !existingCatalogueSkus.includes(item.sku_lite));
    logger.info(`updateAAXCLibrary: Found ${newCatalogueItems.length} new items to add to catalogue`);

    // Filter for fiction items then transform for catalogue
    // Filter for listenable and consumable items
    // Filter out items with runtimeLengthMinutes less than configured minimum (default: 30 minutes)
    const bookRuntimeMin = parseInt(BOOK_RUNTIME_MIN.value(), 10);
    const downloadableItems = newCatalogueItems
        .filter((item) => item.fiction === true)
        .filter((item) => item.is_listenable === true)
        .filter((item) => item.customer_rights?.is_consumable_offline === true)
        .filter((item) => item.runtime_length_min >= bookRuntimeMin)
        .map((item) => ({
          asin: item.asin,
          type: "audiobook",
          sku: item.sku_lite,
          title: item.title,
          author: item.authors,
          description: item.merchandising_summary,
          visibility: "private",
          fiction: true,
          coverArtUrl: item.product_images ? decodeURIComponent(item.product_images) : "",
          addedBy: uid,
        }));

    // Populate catalogue with the new fiction items
    await populateCatalogueWithAAXItems({uid, items: downloadableItems});
    logger.info(`updateAAXCLibrary: Populated catalogue with ${downloadableItems.length} items`);

    // Update the user's imported SKUs list
    await usersUpdateImportedList({uid});
    logger.info(`updateAAXCLibrary: Updated user's imported SKUs list`);

    return {
      success: true,
      message: "AAX library updated successfully",
      totalBooks: library.length,
      newItemsProcessed: newCatalogueItems.length,
      newItems: newCatalogueItems.map((item) => ({
        sku: item.sku_lite,
        title: item.title,
        asin: item.asin,
      })),
    };
  } catch (error) {
    logger.critical(`updateAAXCLibrary: Error updating AAX library for user ${uid}`, error);
    throw error;
  }
}

async function updateMetadata({uid, sku, metadata}) {
  const item = await aaxGetItemFirestore(`${uid}:${sku}`);
  if (!item) {
    throw new Error(`Item with SKU ${sku} not found`);
  }

  try {
    logger.info(`updateMetadata: Updating metadata for item ${sku}`);
    logger.info(`updateMetadata: Metadata: ${JSON.stringify(metadata)}`);

    let processedMetadata = {...metadata};
    // Convert chapters object format to array format
    logger.info(`updateMetadata: Converting chapters format to array format for SKU ${sku}`);
    const chaptersArray = Object.keys(metadata.chapters)
        .map((key) => parseInt(key))
        .sort((a, b) => a - b)
        .map((key) => metadata.chapters[key.toString()]);

    processedMetadata = {
      ...metadata,
      chapters: chaptersArray,
    };

    // Add missing fields
    if (!processedMetadata.codec) {
      processedMetadata.codec = "aac"; // Default codec
    }
    if (!processedMetadata.language) {
      processedMetadata.language = "english"; // Default language
    }

    // Merge with existing metadata if available, filtering out undefined values
    const updatedMetadata = {
      ...Object.fromEntries(
          Object.entries(item.metadata || {}).filter(([, value]) => value !== undefined),
      ),
      ...processedMetadata,
    };

    // Update the item in Firestore
    const id = `${uid}:${sku}`;
    await aaxUpdateItemFirestore({
      id,
      metadata: updatedMetadata,
    });

    // Also update the catalogue with the metadata
    try {
      const catalogueItem = await catalogueGetRtdb({sku});
      if (catalogueItem) {
        // Update catalogue with metadata fields
        const catalogueUpdates = {
          ...catalogueItem,
          metadata: updatedMetadata,
          sku: sku,
          numChapters: updatedMetadata.chapters ? updatedMetadata.chapters.length : 0,
          updatedAt: Date.now(),
        };

        await catalogueUpdateRtdb({body: catalogueUpdates});
        logger.info(`updateMetadata: Updated catalogue for SKU ${sku}`);
      } else {
        logger.warn(`updateMetadata: Catalogue item not found for SKU ${sku}`);
      }
    } catch (error) {
      logger.error(`updateMetadata: Error updating catalogue for SKU ${sku}:`, error);
      // Don't fail the entire request if catalogue update fails
    }

    return updatedMetadata;
  } catch (error) {
    logger.error(`updateMetadata: Error updating metadata for item ${sku}:`, error);
    throw error;
  }
}

async function submitAAXTranscription({uid, sku, chapter, transcription}) {
  logger.info(`submitAAXTranscription: Submitting transcription for item ${sku} chapter ${chapter}`);

  // Get the title and author from the catalogue
  const catalogueItem = await catalogueGetRtdb({sku});
  const title = catalogueItem.title || "Unknown Title";
  const author = catalogueItem.author || "Unknown Author";

  // Store the raw transcription in Storage bucket
  const bucketPath = `UserData/${uid}/Uploads/AAXRaw/${sku}-${chapter}.txt`;
  try {
    await uploadFileToBucket({
      bucketPath: bucketPath,
      content: transcription,
      contentType: "text/plain",
    });
    logger.info(`submitAAXTranscription: Successfully uploaded transcription to ${bucketPath}`);
  } catch (error) {
    logger.error(`submitAAXTranscription: Error uploading transcription to ${bucketPath}:`, error);
    throw error;
  }

  // Dispatch the transcription to the LLM for correction
  await dispatchTask({
    functionName: "v1processAAXTranscription",
    data: {uid, sku, title, author, chapter, transcription},
  });

  await libraryUpdateTranscriptionStatusRtdb({uid, sku, chapter, status: "processing"});

  return {success: true, message: "Transcription submitted successfully"};
}

async function processAAXTranscription({uid, sku, title, author, chapter, transcription}) {
  // Format the transcription for the LLM
  const formattedChunks = await formatTranscriptionForLlm({uid, transcription, sku, chapter});
  logger.info(`submitAAXTranscription: Successfully formatted transcription for LLM`);

  try {
    // Send the transcription to the LLM for correction
    const replacements = [
      {key: "TITLE", value: title},
      {key: "AUTHOR", value: author},
    ];
    logger.debug(`submitAAXTranscription: Created replacements: ${JSON.stringify(replacements)}`);

    logger.debug(`processAAXTranscription: formattedChunks keys: ${Object.keys(formattedChunks)}`);
    logger.debug(`processAAXTranscription: formattedChunks[${chapter}] exists: ${formattedChunks[chapter] !== undefined}`);
    if (formattedChunks[chapter]) {
      logger.debug(`processAAXTranscription: formattedChunks[${chapter}] length: ${formattedChunks[chapter].length}`);
    }

    const correctedTranscriptions = await sendTranscriptionToLlmWithQueue({
      uid,
      sku,
      chapter,
      prompt: "correctTranscription",
      replacements: replacements,
      message: formattedChunks[chapter], // We send only the array of transcriptions for the chapter
      awaitCompletion: true,
    });

    await libraryUpdateTranscriptionStatusRtdb({uid, sku, chapter, status: "ready"});

    logger.info(`processAAXTranscription: Stitching chapter ${chapter} for ${sku}`);

    // Get all individual chapter transcription files to build the complete transcription
    const libraryItem = await libraryGetRtdb({uid, sku});
    if (libraryItem && libraryItem.content && libraryItem.content.chapters) {
      const chapters = libraryItem.content.chapters;
      const chapterNumbers = Object.keys(chapters).map((ch) => parseInt(ch)).sort((a, b) => a - b);

      // Collect all ready chapters
      const readyChapters = [];
      for (const chapterNum of chapterNumbers) {
        const chapterData = chapters[chapterNum.toString()];
        if (chapterData?.transcriptions?.status === "ready") {
          // Load the individual chapter transcription
          const chapterPath = getTranscriptionsPath({uid, sku, chapter: chapterNum});
          if (await fileExists({path: chapterPath})) {
            const chapterTranscription = await getJsonFile({filename: chapterPath});
            readyChapters.push({chapter: chapterNum, result: chapterTranscription});
          }
        }
      }

      // Stitch all ready chapters into the main transcription file
      if (readyChapters.length > 0) {
        await stichTranscriptionChapters({uid, sku, chapters: readyChapters});
        logger.info(`processAAXTranscription: Stitched ${readyChapters.length} chapters into main transcription for ${sku}`);
      }

      // Check if all chapters are now ready
      const allChaptersReady = chapterNumbers.every((chapterNum) =>
        chapters[chapterNum.toString()]?.transcriptions?.status === "ready",
      );

      if (allChaptersReady) {
        logger.info(`processAAXTranscription: All ${chapterNumbers.length} chapters ready for ${sku}, initiating graph generation`);
        await checkAndInitiateGraphGeneration({uid, sku, chapter: chapterNumbers.length});
      } else {
        const readyCount = readyChapters.length;
        const totalCount = chapterNumbers.length;
        logger.info(`processAAXTranscription: ${readyCount}/${totalCount} chapters ready for ${sku}`);
      }
    }

    return correctedTranscriptions;
  } catch (error) {
    logger.error(`Error processing transcription corrections: ${error.message}`, error.stack);
    await libraryUpdateTranscriptionStatusRtdb({uid, sku, chapter, status: "error"});
  }
}

async function formatTranscriptionForLlm({uid, transcription, sku, chapter}) {
  // Consolidate transcriptions in 10-second chunks
  const CHUNK_SIZE_SECONDS = 10;
  const chunks = [];
  let currentChunk = [];
  let chunkStart = null;
  let chunkEnd = 0;
  let chunkDuration = 0;

  // If transcription has no new lines, let's add new lines between segments
  if (!transcription.includes("\n")) {
    transcription = transcription.replace(/(?=\[\d+\.\d+s\s*-\s*\d+\.\d+s\]:)/g, "\n");
  }

  // In development, just do the first 500 lines
  const lines = ENVIRONMENT.value() === "development" ? transcription.split("\n").slice(0, 500) : transcription.split("\n");
  let segmentId = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Extract the timestamps from the line and calculate the duration
    const match = line.match(/\[(\d+\.\d+)s\s*-\s*(\d+\.\d+)s\]:\s*(.*)/);
    if (!match) continue;

    const [, start, end, text] = match;
    const startTime = parseFloat(start);
    const endTime = parseFloat(end);
    const duration = endTime - startTime;

    // Chunk by a minimum of 10-second intervals
    // Ensure end of sentence
    if (chunkDuration > CHUNK_SIZE_SECONDS) {
      segmentId++;
      chunks.push({
        id: segmentId,
        text: currentChunk.join(" "),
        startTime: chunkStart,
        endTime: chunkEnd,
      });
      currentChunk = [];
      chunkDuration = 0;
      chunkStart = startTime; // Set to current segment's start time
    }

    // Set chunkStart to the first segment's start time if this is the first segment in the chunk
    if (chunkStart === null) {
      chunkStart = startTime;
    }

    currentChunk.push(text.trim());
    chunkDuration += duration;
    chunkEnd = endTime;

    // Final chunk
    if (i === lines.length - 1 && currentChunk.length > 0) {
      segmentId++;
      chunks.push({
        id: segmentId,
        text: currentChunk.join(" "),
        startTime: chunkStart,
        endTime: chunkEnd,
      });
    }
  }

  logger.log(`Total number of segments: ${chunks.length}`);
  const formattedChunks = {[chapter]: chunks};

  // Upload formatted chunks to bucket
  const formattedChunksPath = `UserData/${uid}/Uploads/AAXRaw/${sku}-${chapter}-formatted.json`;
  await uploadFileToBucket({
    bucketPath: formattedChunksPath,
    content: JSON.stringify(formattedChunks, null, 2),
    contentType: "application/json",
  });

  return formattedChunks;
}

export {
  aaxPostAuthHook,
  connectAAXAuth,
  disconnectAAXAuth,
  updateAAXCChapterFileSizes,
  classifyNovelFiction,
  queueTranscription,
  submitAAXTranscription,
  processAAXTranscription,
  updateAAXCLibrary,
  updateMetadata,
};
