/* eslint-disable require-jsdoc */
import logger from "../util/logger.js";
import {onCall, HttpsError} from "firebase-functions/v2/https";
import {onRequest} from "firebase-functions/v2/https";
import {onTaskDispatched} from "firebase-functions/v2/tasks";
import {validateOnCallAuth, validateOnRequestAdmin} from "../auth/auth.js";
import {firebaseFnConfig, firebaseHttpFnConfig} from "../config/config.js";
import {
  largeDispatchInstance,
  mediumDispatchInstance,
  dataToBody,
  dispatchTask,
} from "../util/dispatch.js";
import {validateCallable} from "../util/validateCallable.js";
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
import {processCustomM4B} from "../ai/userBookImport/customM4BProcessor.js";
import {checkUserRateLimit, recordUserRateLimit} from "../storage/realtimeDb/userRateLimiter.js";

export const v1generateTranscriptions = onCall({
  ...firebaseFnConfig,
  memory: "32GiB",
  concurrency: 1,
  timeoutSeconds: 540,
}, async (context) => {
  try {
    const {uid, data} = await validateOnCallAuth(context);
    await checkUserRateLimit({uid, action: "bookImport"});

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

    await recordUserRateLimit({uid, action: "bookImport"});
    return {
      success: true,
      message: "Book import queued successfully",
      queueEntryId: result.id,
      sku: data.sku,
    };
  } catch (error) {
    logger.error(`v1generateTranscriptions error: ${error.message}`);
    if (error instanceof HttpsError) {
      throw error;
    }
    const code = error.code === "resource-exhausted" ? "resource-exhausted" : "internal";
    throw new HttpsError(code, error.message || "An error occurred", error.details);
  }
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
  try {
    const {uid, data} = await validateOnCallAuth(context);
    await checkUserRateLimit({uid, action: "bookImport"});
    const sku = data.sku || data.item?.sku;
    const entryType = data.entryType || "m4b";
    return await processPrivateM4B({uid, item: {sku}, entryType});
  } catch (error) {
    logger.error(`v1processPrivateM4B error: ${error.message}`);
    if (error instanceof HttpsError) {
      throw error;
    }
    const code = error.code === "resource-exhausted" ? "resource-exhausted" : "internal";
    throw new HttpsError(code, error.message || "An error occurred", error.details);
  }
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

// Process custom M4B audiobook uploads with fingerprinting and moderation
export const v1processCustomM4B = onCall({
  ...firebaseFnConfig,
  concurrency: 1,
  timeoutSeconds: 540,
}, async (context) => {
  try {
    const {uid, data} = await validateOnCallAuth(context);
    await checkUserRateLimit({uid, action: "bookImport"});
    validateCallable(data, {oneOf: ["audioPath", "audioUrl"]});
    await dispatchTask({
      functionName: "dispatchedProcessCustomM4B",
      data: {
        uid,
        audioPath: data.audioPath,
        audioUrl: data.audioUrl,
      },
    });
    await recordUserRateLimit({uid, action: "bookImport"});
    return {success: true, message: "Custom M4B processing dispatched"};
  } catch (error) {
    logger.error(`v1processCustomM4B error: ${error.message}`);
    if (error instanceof HttpsError) {
      throw error;
    }
    const code = error.code === "resource-exhausted" ? "resource-exhausted" : "internal";
    throw new HttpsError(code, error.message || "An error occurred", error.details);
  }
});

// Dispatched task for processing custom M4B files (handles long downloads)
export const dispatchedProcessCustomM4B = onTaskDispatched(
    mediumDispatchInstance({maxConcurrentDispatches: 10, concurrency: 1}),
    async (req) => {
      logger.debug(`dispatchedProcessCustomM4B: ${JSON.stringify(req.data)}`);
      const {uid, audioPath, audioUrl} = req.data;
      return await processCustomM4B({uid, audioPath, audioUrl});
    },
);
