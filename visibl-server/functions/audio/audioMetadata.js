/* eslint-disable require-jsdoc */
import {
  getJsonFile,
} from "../storage/storage.js";
import {catalogueGetRtdb} from "../storage/realtimeDb/catalogue.js";

// import {ENVIRONMENT} from "../config/config.js";
import logger from "../util/logger.js";

function getMetadataPath(uid, sku) {
  if (uid === "admin") {
    return `Catalogue/Raw/${sku}.json`;
  } else {
    return `UserData/${uid}/Uploads/Raw/${sku}.json`;
  }
}

async function getMetaData(uid, sku, path) {
  if (!path) {
    path = `./bin/`;
  }
  let bookData = {};

  // First, try to get metadata from catalogue RTDB
  try {
    const catalogueItem = await catalogueGetRtdb({sku});
    if (catalogueItem && catalogueItem.metadata) {
      logger.info(`Found metadata in catalogue RTDB for ${sku}`);
      bookData = {...catalogueItem.metadata};

      // Convert chapters from array format to object format if needed
      if (Array.isArray(bookData.chapters)) {
        const chaptersObj = {};
        bookData.chapters.forEach((chapter, index) => {
          chaptersObj[index.toString()] = chapter;
        });
        bookData.chapters = chaptersObj;
      }
    }
  } catch (error) {
    logger.debug(`No catalogue metadata in RTDB for ${sku}: ${error.message}`);
  }

  // If not found in catalogue, fall back to GCS file (original approach)
  if (!bookData.chapters) {
    try {
      bookData = await getJsonFile({filename: getMetadataPath(uid, sku)});
      logger.info(`Found metadata in GCS file for ${sku}`);
    } catch (error) {
      logger.error(`Metadata unavailable for ${sku}: ${error}`);
      return {bookData, outputFiles: [], startTimes: [], endTimes: []};
    }
  }

  // logger.debug(`Book Data: ${JSON.stringify(bookData, null, 2)}`);
  // if (ENVIRONMENT.value() === "development") {
  //   bookData.chapters = Object.fromEntries(
  //       Object.entries(bookData.chapters).slice(0, 2),
  //   );
  // }
  const outputFiles = Object.keys(bookData.chapters).map(
      (chapterIndex) => `${path}${sku}-ch${chapterIndex}.m4a`,
  );
  const startTimes = Object.values(bookData.chapters).map(
      (chapter) => chapter.startTime,
  );
  const endTimes = Object.values(bookData.chapters).map(
      (chapter) => chapter.endTime,
  );
  return {bookData, outputFiles, startTimes, endTimes};
}

function getAudioPath({uid, sku}) {
  if (uid === "admin") {
    return `Catalogue/Raw/${sku}.m4b`;
  } else {
    return `UserData/${uid}/Uploads/Raw/${sku}.m4b`;
  }
}

function getSplitAudioPath(uid, sku) {
  if (uid === "admin") {
    return `Catalogue/Processed/${sku}/`;
  } else {
    return `UserData/${uid}/Uploads/Processed/${sku}/`;
  }
}

export {getMetaData, getAudioPath, getSplitAudioPath};
