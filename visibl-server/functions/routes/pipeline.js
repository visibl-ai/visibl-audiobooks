/* eslint-disable require-jsdoc */
import logger from "../util/logger.js";
import {onCall} from "firebase-functions/v2/https";
import {onRequest} from "firebase-functions/v2/https";
import {onTaskDispatched} from "firebase-functions/v2/tasks";
import {validateOnCallAuth, validateOnRequestAdmin} from "../auth/auth.js";
import {firebaseFnConfig, firebaseHttpFnConfig} from "../config/config.js";
import {
  largeDispatchInstance,
  mediumDispatchInstance,
  dataToBody,
} from "../util/dispatch.js";
import {
  imageGenCurrentTime,
} from "../ai/imageGen.js";

import {
  processRawPublicItem,
} from "../util/publicContent.js";
import {
  processPrivateM4B,
} from "../ai/transcribe/index.js";
import {bookImportQueue} from "../ai/queue/bookImportQueue.js";
import {
  initTranscriptionGeneration,
} from "../graph/admin.js";

export const v1generateTranscriptions = onCall({
  ...firebaseFnConfig,
  memory: "32GiB",
  concurrency: 1,
  timeoutSeconds: 540,
}, async (context) => {
  const {uid, data} = await validateOnCallAuth(context);

  // Add the transcription task to the BookImportQueue
  const result = await bookImportQueue.addToQueue({
    model: "default",
    params: {
      uid,
      sku: data.sku,
      entryType: "bookImport",
    },
    estimatedTokens: 0,
  });

  return {
    success: true,
    message: "Book import queued successfully",
    queueEntryId: result.id,
    sku: data.sku,
  };
});

// Processes public M4B files - similar processing requirements as private M4B
export const processM4B = onTaskDispatched(
    largeDispatchInstance({maxConcurrentDispatches: 20, concurrency: 1}),
    async (req) => {
      logger.debug(`processM4B: ${JSON.stringify(req.data)}`);
      return await processRawPublicItem(dataToBody(req));
    },
);

export const generateSceneImagesCurrentTime = onTaskDispatched(
    mediumDispatchInstance({
      maxConcurrentDispatches: 50,
      concurrency: 3, // If we see odd memory errors or other problems reduce this to 1.
    }),
    async (req) => {
      logger.debug(`generateSceneImagesCurrentTime: ${JSON.stringify(req.data)}`);
      return await imageGenCurrentTime(dataToBody(req));
    },
);

export const v1processPrivateM4B = onCall({
  ...firebaseFnConfig,
  // memory: "32GiB", // no longer needs to be huge.
  concurrency: 1,
  timeoutSeconds: 540,
}, async (context) => {
  const {uid, data} = await validateOnCallAuth(context);
  const sku = data.sku || data.item?.sku;
  const entryType = data.entryType || "m4b";
  return await processPrivateM4B({uid, item: {sku}, entryType});
});

// Unified function for both public and private M4B transcriptions
export const generateM4BTranscriptions = onTaskDispatched(
    largeDispatchInstance({maxConcurrentDispatches: 20, concurrency: 1}),
    async (req) => {
      logger.debug(`generateM4BTranscriptions: ${JSON.stringify(req.data)}`);
      const {uid, sku} = req.data;

      // Add the transcription task to the BookImportQueue
      const result = await bookImportQueue.addToQueue({
        model: "default",
        params: {
          uid,
          sku,
          entryType: "bookImport",
        },
        estimatedTokens: 0,
      });

      return {
        success: true,
        message: "Book import queued successfully",
        queueEntryId: result.id,
        uid,
        sku,
      };
    },
);

// Admin endpoint to initiate transcription generation
export const v1adminInitTranscriptionGeneration = onRequest(firebaseHttpFnConfig, async (req, res) => {
  await validateOnRequestAdmin(req);
  const {sku, cleanupPublicBooks = true} = req.body;

  const result = await initTranscriptionGeneration({sku, cleanupPublicBooks});

  res.status(200).send(result);
});
