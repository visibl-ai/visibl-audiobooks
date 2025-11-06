/* eslint-disable require-jsdoc */
import {onRequest, onCall} from "firebase-functions/v2/https";
import {validateOnCallAuth} from "../auth/auth.js";
import {onValueWritten} from "firebase-functions/v2/database";
import {ENVIRONMENT, firebaseFnConfig, firebaseHttpFnConfig} from "../config/config.js";
import logger from "../util/logger.js";
import {validateOnRequestAdmin} from "../auth/auth.js";
import {
  deleteAllData,
} from "../storage/realtimeDb/database.js";

// import {
//   dispatchCarouselGeneration,
// } from "../storage/firestore.js";
import {
  imageGenCurrentTime,
} from "../ai/imageGen.js";

import {
  handleChapterProgress,
} from "../graph/v0.1/logic/chapterProgressHandler.js";

import {
  getCarouselListFromLibraryRtdb,
  libraryGetRtdb,
} from "../storage/realtimeDb/library.js";

import {
  catalogueGetRtdb,
} from "../storage/realtimeDb/catalogue.js";

import {
  getScenesFromCache,
} from "../storage/realtimeDb/scenesCache.js";

import {
  shouldProcessProgressUpdate,
} from "../util/progressDebouncer.js";


export const v1cacheNuke = onRequest(firebaseHttpFnConfig, async (req, res) => {
  await validateOnRequestAdmin(req);
  res.status(200).send(await deleteAllData());
});

export const v1getCachedScenes = onCall(firebaseFnConfig, async (context) => {
  const {data} = await validateOnCallAuth(context);
  return await getScenesFromCache({sceneId: data.sceneId});
});

const region = process.env["FUNCTIONS_EMULATOR"] !== "true" ? "europe-west1" : "us-central1";

export const libraryChapterProgressWritten = onValueWritten(
    {
      ref: "/users/{uid}/library/{sku}/clientData/playbackInfo/currentResourceIndex",
      region,
      memory: "4GiB",
    },
    async (event) => {
      const pathParts = event.ref.toString().split("/");
      const uid = pathParts[1];
      const sku = pathParts[3];
      const currentChapter = event.data.after.val(); // 0-based index
      const previousChapter = event.data.before.val();

      await handleChapterProgress({uid, sku, currentChapter, previousChapter});
    },
);

export const libraryItemProgressWritten = onValueWritten(
    {
      ref: "/users/{uid}/library/{sku}/clientData/playbackInfo/totalProgress",
      // instance: "visibl-rtdb-dev-default-rtdb",
      // This example assumes us-central1, but to set location:
      region,
      memory: "4GiB",
    },
    async (event) => {
      return await processProgressUpdate(event);
    },
);

export async function processProgressUpdate(event) {
  const pathParts = event.ref.toString().split("/");
  const uid = pathParts[1];
  const sku = pathParts[3];
  const progress = event.data.after.val();

  // Rate limit check - only process every 5 seconds per user/sku to prevent hammering GCS/Firestore
  const shouldProcess = await shouldProcessProgressUpdate({uid, sku});
  if (!shouldProcess && ENVIRONMENT.value() !== "development") {
    logger.info(`⏸️  THROTTLED: Progress update for uid: ${uid} sku: ${sku}, progress: ${progress} - preventing GCS/Firestore hammering`);
    return; // Skip this update to prevent hammering the backend
  }

  const catalogueItem = await catalogueGetRtdb({sku});

  let carouselList = await getCarouselListFromLibraryRtdb({uid, sku});
  if (!carouselList || carouselList.length === 0) {
    // Try to use the default scene ID as fallback
    if (catalogueItem?.defaultSceneId) {
      logger.info(`No carousel list found for uid: ${uid} sku: ${sku}, using defaultSceneId: ${catalogueItem.defaultSceneId}`);
      carouselList = [catalogueItem.defaultSceneId];
    } else {
      logger.info(`No carousel list and no defaultSceneId for uid: ${uid} sku: ${sku}, skipping progress update`);
      return; // no carousel list and no default, likely new book addition
    }
  }

  // Ensure default scene ID is in the carousel list
  if (!carouselList.includes(catalogueItem.defaultSceneId)) {
    carouselList.push(catalogueItem.defaultSceneId);
  }

  logger.info(`▶️  PROCESSING: Progress update for uid: ${uid} sku: ${sku}, progress: ${progress} - rate limit passed`);

  // Check if currentTime > 0 and trigger next chapter graphing if needed
  if (progress > 0) {
    try {
      // Get the current chapter index from library
      const libraryItem = await libraryGetRtdb({uid, sku});
      const currentChapter = libraryItem?.clientData?.playbackInfo?.currentResourceIndex;

      if (currentChapter !== undefined && currentChapter !== null) {
        // Call handleChapterProgress with currentTime to check if next chapter needs graphing
        await handleChapterProgress({
          uid,
          sku,
          currentChapter,
          previousChapter: null, // Not relevant for currentTime check
          currentTime: progress,
        });
      }
    } catch (error) {
      logger.error(`Error checking/triggering chapter progress in processProgressUpdate:`, error);
      // Don't throw - let carousel generation continue even if chapter check fails
    }
  }

  // Dispatch the carousel generation.
  // await dispatchCarouselGeneration({carouselList, currentTime: progress, sku});
  await Promise.all(carouselList.map(async (styleId) => {
    const req = {body: {styleId, currentTime: progress, sku}};
    return await imageGenCurrentTime(req);
  }));
  return;
}
