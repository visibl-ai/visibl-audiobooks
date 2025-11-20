/* eslint-disable require-jsdoc */
import {storeData, getData, deleteData, updateData} from "./database.js";
import {
  catalogueGetRtdb,
  catalogueUpdateRtdb,
} from "./catalogue.js";
import logger from "../../util/logger.js";
import {
  aaxGetItemFirestore,
} from "../firestore/aax.js";
import {
  sendNotifications,
} from "../../util/notifications.js";
import {
  CDN_URL,
} from "../../config/config.js";
import {
  getPublicUrl,
} from "../storage.js";
import {
  getInstance as getAnalytics,
} from "../../analytics/bookPipelineAnalytics.js";

function libraryItemToDbRef({uid, sku}) {
  return `users/${uid}/library/${sku}`;
}

function fullLibraryToDbRef({uid}) {
  return `users/${uid}/library`;
}

async function libraryGetRtdb({uid, sku}) {
  logger.debug(`getting library item ${sku}`);
  const item = await getData({ref: libraryItemToDbRef({uid, sku})});
  if (!item) {
    throw new Error(`Library item not found for sku: ${sku}`);
  }
  return item;
}

async function libraryAddItemRtdb({uid, data}) {
  if (!data.sku) {
    throw new Error("SKU is required");
  }
  // Check for duplicates
  const sku = data.sku;
  const existingItem = await getData({ref: libraryItemToDbRef({uid, sku})});
  if (existingItem) {
    logger.info(`Item with sku ${sku} already exists in user ${uid}'s library`);
    return existingItem;
  }
  logger.debug(`Request to add item ${sku} to library for user ${uid}`);
  const catalogueItem = await catalogueGetRtdb({sku: sku});

  // Set addedToFirstUserAt timestamp if not already set
  if (!catalogueItem.addedToFirstUserAt) {
    await catalogueUpdateRtdb({
      body: {
        id: sku,
        addedToFirstUserAt: Date.now(),
      },
    });
    logger.info(`Set addedToFirstUserAt timestamp for catalogue item ${sku}`);
  }

  // Add the new item to the Library
  const newItem = {
    id: sku,
    catalogueId: sku,
    visibility: catalogueItem.visibility,
    uid: uid,
    sku: sku,
    addedAt: Date.now(),
    clientData: {
      isArchived: false,
      isFavourite: false,
      isFinished: false,
      playbackInfo: {
        currentResourceIndex: 0,
        progressInCurrentResource: 0,
        totalProgress: 0,
      },
    },
    content: {},
  };

  // Check if this is a private item. If it is, add the key, iv and url for the encrypted file.
  if (catalogueItem.visibility === "private") {
    // get UID:SKU from UserAAXSync
    const aaxItem = await aaxGetItemFirestore(`${uid}:${sku}`);
    if (aaxItem) {
      // Check if catalogue item has a default graph or no transcription/graph in progress. If not, transcribe.
      logger.debug(`libraryAddItemRtdb: uid: ${uid}, aaxItem in DB: ${aaxItem.sku}`);
      if (!catalogueItem.defaultGraphId && !catalogueItem.graphProgress?.inProgress && !catalogueItem.graphProgress?.transcriptionInProgress) {
        await sendNotifications({uids: [uid], title: "Audible Import Started", body: `Importing ${aaxItem.title} - we'll notify you when it's ready.`});
        logger.debug(`libraryAddItemRtdb: uid: ${uid} completed - dispatched ${aaxItem.sku}.`);
      }
    } else {
      logger.error(
          `libraryAddItemRtdb: No aax item found for ${uid}:${sku}`,
      );
      throw new Error(`User does not have access to this catalogue item ${uid}:${sku}`);
    }
  } else {
    newItem.content.m4b = {
      url: getCDNM4bUrl({sku}),
      urlGcp: await getGcpM4bUrl({sku}),
    };
  }

  // Initialise the transcription status to waiting for all chapters
  const numChapters = catalogueItem.metadata?.numChapters || catalogueItem.metadata?.chapters?.length;
  if (numChapters) {
    newItem.content.chapters = {};
    for (let i = 0; i < numChapters; i++) {
      newItem.content.chapters[i.toString()] = {
        transcriptions: {
          status: catalogueItem.graphAvailable ? "ready" : "waiting",
        },
      };
    }
  }

  await storeData({ref: libraryItemToDbRef({uid, sku}), data: newItem});

  // Track book added to library
  const analytics = getAnalytics();
  await analytics.trackBookAddedToLibrary({
    uid,
    sku,
    source: data.source || "user", // Default to 'user' if not specified
    graphAvailable: !!catalogueItem.defaultGraphId,
    metadata: {
      visibility: catalogueItem.visibility,
      numChapters,
    },
  });

  return await libraryGetRtdb({uid, sku});
}

function getCDNM4bUrl({sku}) {
  return `${CDN_URL.value()}${sku}.m4b`;
}

async function getGcpM4bUrl({sku}) {
  return await getPublicUrl({path: `Catalogue/Raw/${sku}.m4b`});
}

async function libraryDeleteItemRtdb({uid, data}) {
  const {libraryIds} = data;
  if (!Array.isArray(libraryIds) || libraryIds.length === 0) {
    throw new Error("Invalid or empty libraryIds array provided");
  }
  const deletionResults = {success: [], failed: []};
  for (const libraryId of libraryIds) {
    await deleteData({ref: libraryItemToDbRef({uid, sku: libraryId})});
    deletionResults.success.push(libraryId);
  }
  return {
    message: "Deletion process completed",
    results: deletionResults,
  };
}

async function libraryDeleteAllPrivateItemsRtdb({uid}) {
  // 1. Get all library items for the user
  const allItems = await libraryGetAllRtdb({uid});

  // 2. Filter for private items
  const privateItems = Object.entries(allItems || {}).filter(([, item]) =>
    item.visibility === "private",
  );

  // 3. Delete each private item
  const deletionResults = {success: [], failed: []};
  for (const [sku] of privateItems) {
    try {
      await deleteData({ref: libraryItemToDbRef({uid, sku})});
      deletionResults.success.push(sku);
    } catch (error) {
      deletionResults.failed.push({sku, error: error.message});
    }
  }

  return {
    message: "Private items deletion completed",
    totalPrivateItems: privateItems.length,
    results: deletionResults,
  };
}

async function libraryGetAllRtdb({uid}) {
  const items = await getData({ref: fullLibraryToDbRef({uid})});
  return items;
}

async function libraryUpdateItemRtdb({uid, sku, data}) {
  await updateData({ref: libraryItemToDbRef({uid, sku}), data: data});
  return await getData({ref: libraryItemToDbRef({uid, sku})});
}

async function libraryUpdateTranscriptionStatusRtdb({uid, sku, chapter, status}) {
  const ref = libraryItemToDbRef({uid, sku});
  const existingItem = await getData({ref});
  if (!existingItem) {
    logger.warn(`libraryUpdateTranscriptionStatusRtdb: No item found for uid: ${uid} sku: ${sku}`);
    return;
  }

  await updateData({ref, data: {[`content/chapters/${chapter}/transcriptions/status`]: status}});
  return await getData({ref});
}

async function librarySetItemProgressRtdb({uid, data}) {
  const sku = data.sku;
  const progress = data.progress;
  const ref = `${libraryItemToDbRef({uid, sku})}/clientData/playbackInfo/totalProgress`;
  logger.debug(`librarySetItemProgressRtdb: Setting progress for ${ref} to ${progress}`);
  await storeData({ref, data: progress});
  return await getData({ref});
}

async function getCurrentSceneFromLibraryRtdb({uid, sku}) {
  const ref = `${libraryItemToDbRef({uid, sku})}/clientData/sceneInfo/currentSceneStyle`;
  let currentScene = await getData({ref});
  if (!currentScene) {
    const catalogueItem = await catalogueGetRtdb({sku});
    currentScene = catalogueItem.defaultSceneId;
  }
  return currentScene;
}

/**
 * Get the carousel list from the library
 * @param {string} uid - The user ID
 * @param {string} sku - The SKU of the book
 * @return {Promise<string[]>} The carousel list, or an empty array if no carousel list is found
 */
async function getCarouselListFromLibraryRtdb({uid, sku}) {
  const ref = `${libraryItemToDbRef({uid, sku})}/clientData/sceneInfo/carouselList`;
  const carouselList = await getData({ref});
  if (!carouselList) {
    logger.info(`getCarouselListFromLibraryRtdb: No carousel list found for uid: ${uid} sku: ${sku} - likely new book addition.`);
    return [];
  }
  // Convert comma separated string to array
  if (typeof carouselList === "string") {
    const sceneIds = carouselList.split(",").map((id) => id.trim());

    // Check for duplicates and auto-deduplicate if found
    const uniqueSceneIds = [...new Set(sceneIds)];
    if (uniqueSceneIds.length < sceneIds.length) {
      logger.warn(`Found duplicates in carousel list for uid: ${uid} sku: ${sku}. Auto-deduplicating...`);
      await deduplicateCarouselList({uid, sku});
      return uniqueSceneIds;
    }

    return sceneIds;
  }
  return carouselList;
}

async function deduplicateCarouselList({uid, sku}) {
  const carouselRef = `${libraryItemToDbRef({uid, sku})}/clientData/sceneInfo/carouselList`;

  // Get current carousel list
  const currentList = await getData({ref: carouselRef});

  if (!currentList) {
    logger.debug(`No carousel list to deduplicate for user ${uid}, book ${sku}`);
    return;
  }

  // Parse the carousel list and remove duplicates
  let sceneIds = [];
  if (typeof currentList === "string") {
    sceneIds = currentList.split(",").map((id) => id.trim());
  } else if (Array.isArray(currentList)) {
    sceneIds = currentList;
  }

  // Remove duplicates using Set
  const uniqueSceneIds = [...new Set(sceneIds)];

  if (uniqueSceneIds.length < sceneIds.length) {
    const deduplicatedList = uniqueSceneIds.join(",");
    logger.info(`Deduplicated carousel list for user ${uid}, book ${sku}. Original: ${sceneIds.length} items, Deduplicated: ${uniqueSceneIds.length} items`);
    return deduplicatedList;
  } else {
    logger.debug(`No duplicates found in carousel list for user ${uid}, book ${sku}`);
    return currentList;
  }
}

export {
  libraryGetRtdb,
  libraryAddItemRtdb,
  libraryGetAllRtdb,
  libraryUpdateItemRtdb,
  libraryDeleteItemRtdb,
  libraryDeleteAllPrivateItemsRtdb,
  librarySetItemProgressRtdb,
  libraryUpdateTranscriptionStatusRtdb,
  getCurrentSceneFromLibraryRtdb,
  getCarouselListFromLibraryRtdb,
  deduplicateCarouselList,
  getCDNM4bUrl,
  getGcpM4bUrl,
};
