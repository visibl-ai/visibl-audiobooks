/* eslint-disable require-jsdoc */
import {onRequest} from "firebase-functions/v2/https";
import {onTaskDispatched} from "firebase-functions/v2/tasks";
import logger from "../util/logger.js";
import {validateOnRequestAdmin} from "../auth/auth.js";
import {
  queueNuke,
  queueAddEntries,
  queueGetEntries,
  queueUpdateEntries,
  queueDeleteEntries,
} from "../storage/firestore/queue.js";

import {
  microDispatchInstance,
  mediumDispatchInstance,
  largeDispatchInstance,
  dispatchTask,
  dataToBody,
} from "../util/dispatch.js";

import {getFirestore} from "firebase-admin/firestore";
import {stabilityQueue} from "../ai/stability/stability.js";
import {dalleQueue} from "../ai/openai/dallE.js";
import {geminiQueue} from "../ai/queue/geminiQueue.js";
import {openaiQueue} from "../ai/queue/openaiQueue.js";
import {modalQueue} from "../ai/queue/modalQueue.js";
import {transcriptionQueue} from "../ai/transcribe/index.js";
import {imagerouterQueue} from "../ai/queue/imagerouterQueue.js";
import {falQueue} from "../ai/queue/falQueue.js";
import {wavespeedQueue} from "../ai/queue/wavespeedQueue.js";
import {groqQueue} from "../ai/queue/groqQueue.js";
import {bookImportQueue} from "../ai/queue/bookImportQueue.js";
import {
  firebaseHttpFnConfig,
} from "../config/config.js";


export const v1queueNuke = onRequest(firebaseHttpFnConfig, async (req, res) => {
  await validateOnRequestAdmin(req);
  res.status(200).send(await queueNuke(req.body));
});

export const v1queueAdd = onRequest(firebaseHttpFnConfig, async (req, res) => {
  await validateOnRequestAdmin(req);
  res.status(200).send(await queueAddEntries(req.body));
});

export const v1queueGet = onRequest(firebaseHttpFnConfig, async (req, res) => {
  await validateOnRequestAdmin(req);
  res.status(200).send(await queueGetEntries(req.body));
});

export const v1queueUpdate = onRequest(firebaseHttpFnConfig, async (req, res) => {
  await validateOnRequestAdmin(req);
  res.status(200).send(await queueUpdateEntries(req.body));
});

export const v1queueDelete = onRequest(firebaseHttpFnConfig, async (req, res) => {
  await validateOnRequestAdmin(req);
  res.status(200).send(await queueDeleteEntries(req.body));
});

export const v1queueBatchStatus = onRequest(firebaseHttpFnConfig, async (req, res) => {
  await validateOnRequestAdmin(req);

  const {batchId, queueName} = req.body;

  if (!batchId) {
    res.status(400).send({error: "batchId is required"});
    return;
  }

  // Get the appropriate queue instance based on queueName
  let queue;
  switch (queueName) {
    case "gemini":
      queue = geminiQueue;
      break;
    case "openai":
      queue = openaiQueue;
      break;
    case "modal":
      queue = modalQueue;
      break;
    case "imagerouter":
      queue = imagerouterQueue;
      break;
    case "fal":
      queue = falQueue;
      break;
    case "wavespeed":
      queue = wavespeedQueue;
      break;
    case "groq":
      queue = groqQueue;
      break;
    case "transcription":
      queue = transcriptionQueue;
      break;
    case "bookImport":
      queue = bookImportQueue;
      break;
    default: {
      // If no specific queue name provided, we'll need to check the batch directly
      const db = getFirestore();
      const batchRef = db.collection("QueueBatches").doc(batchId);
      const doc = await batchRef.get();

      if (!doc.exists) {
        res.status(404).send({error: "Batch not found"});
        return;
      }

      const batchData = doc.data();
      const completionPercentage = batchData.totalItems > 0 ?
        Math.round(((batchData.completedItems + batchData.failedItems) / batchData.totalItems) * 100) :
        0;

      res.status(200).send({
        id: doc.id,
        ...batchData,
        completionPercentage,
        isComplete: batchData.status === "complete",
      });
      return;
    }
  }

  const status = await queue.getBatchStatus(batchId);

  if (!status) {
    res.status(404).send({error: "Batch not found"});
    return;
  }

  res.status(200).send(status);
});

export const v1adminLaunchQueue = onRequest(firebaseHttpFnConfig, async (req, res) => {
  await validateOnRequestAdmin(req);
  logger.debug(`v1adminLaunchQueue: body: ${JSON.stringify(req.body)}`);
  const queueToLaunch = req.body.queue;
  switch (queueToLaunch) {
    case "stability":
      await dispatchTask({functionName: "launchStabilityQueue", data: {}});
      break;
    case "dalle":
      await dispatchTask({functionName: "launchDalleQueue", data: {}});
      break;
    case "graph":
      await dispatchTask({functionName: "graphPipeline", data: {}});
      break;
    case "transcription":
      await dispatchTask({functionName: "launchTranscriptionQueue", data: {}});
      break;
    case "gemini":
      await dispatchTask({functionName: "launchGeminiQueue", data: {}});
      break;
    case "openai":
      await dispatchTask({functionName: "launchOpenAiQueue", data: {}});
      break;
    case "modal":
      await dispatchTask({functionName: "launchModalQueue", data: {}});
      break;
    case "imagerouter":
      await dispatchTask({functionName: "launchImageRouterQueue", data: {}});
      break;
    case "fal":
      await dispatchTask({functionName: "launchFalQueue", data: {}});
      break;
    case "wavespeed":
      await dispatchTask({functionName: "launchWavespeedQueue", data: {}});
      break;
    case "groq":
      await dispatchTask({functionName: "launchGroqQueue", data: {}});
      break;
    case "bookImport":
      await dispatchTask({functionName: "launchBookImportQueue", data: {}});
      break;
    default:
      throw new Error(`Unknown queue type: ${queueToLaunch}`);
  }
  res.status(200).send({
    message: `Queue ${queueToLaunch} launched`,
    queue: queueToLaunch,
    success: true,
  });
});

export const launchStabilityQueue = onTaskDispatched(
    largeDispatchInstance(),
    async (req) => {
      logger.debug(`launchStabilityQueue: ${JSON.stringify(req.data)}`);
      return await stabilityQueue(dataToBody(req));
    },
);

export const launchDalleQueue = onTaskDispatched(
    largeDispatchInstance(),
    async (req) => {
      logger.debug(`launchDalleQueue: ${JSON.stringify(req.data)}`);
      return await dalleQueue(dataToBody(req));
    },
);

export const launchGeminiQueue = onTaskDispatched(
    microDispatchInstance(),
    async (req) => {
      logger.debug(`launchGeminiQueue: ${JSON.stringify(req.data)}`);
      return await geminiQueue.processQueue();
    },
);

export const launchOpenAiQueue = onTaskDispatched(
    largeDispatchInstance(),
    async (req) => {
      logger.debug(`launchOpenAiQueue: ${JSON.stringify(req.data)}`);
      return await openaiQueue.processQueue();
    },
);

export const launchModalQueue = onTaskDispatched(
    largeDispatchInstance(),
    async (req) => {
      logger.debug(`launchModalQueue: ${JSON.stringify(req.data)}`);
      return await modalQueue.processQueue();
    },
);

export const launchTranscriptionQueue = onTaskDispatched(
    mediumDispatchInstance({maxConcurrentDispatches: 20, concurrency: 1}),
    async (req) => {
      logger.debug(`launchTranscriptionQueue: ${JSON.stringify(req.data)}`);
      // Wait only if explicitly requested
      if (req.data.await) {
        return await transcriptionQueue.processQueueAndWait();
      }
      return await transcriptionQueue.processQueue();
    },
);

export const launchImageRouterQueue = onTaskDispatched(
    largeDispatchInstance(),
    async (req) => {
      logger.debug(`launchImageRouterQueue: ${JSON.stringify(req.data)}`);
      return await imagerouterQueue.processQueue();
    },
);

export const launchFalQueue = onTaskDispatched(
    largeDispatchInstance(),
    async (req) => {
      logger.debug(`launchFalQueue: ${JSON.stringify(req.data)}`);
      return await falQueue.processQueue();
    },
);

export const launchWavespeedQueue = onTaskDispatched(
    largeDispatchInstance(),
    async (req) => {
      logger.debug(`launchWavespeedQueue: ${JSON.stringify(req.data)}`);
      return await wavespeedQueue.processQueue();
    },
);

export const launchGroqQueue = onTaskDispatched(
    largeDispatchInstance(),
    async (req) => {
      logger.debug(`launchGroqQueue: ${JSON.stringify(req.data)}`);
      return await groqQueue.processQueue();
    },
);

export const launchBookImportQueue = onTaskDispatched(
    largeDispatchInstance({maxConcurrentDispatches: 20, concurrency: 1}),
    async (req) => {
      logger.debug(`launchBookImportQueue: ${JSON.stringify(req.data)}`);
      return await bookImportQueue.processQueue();
    },
);

