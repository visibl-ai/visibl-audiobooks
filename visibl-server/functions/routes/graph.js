/* eslint-disable require-jsdoc */
import logger from "../util/logger.js";
import {onRequest} from "firebase-functions/v2/https";
import {onTaskDispatched} from "firebase-functions/v2/tasks";
import {onSchedule} from "firebase-functions/v2/scheduler";
import {validateOnRequestAdmin} from "../auth/auth.js";
import {onCall} from "firebase-functions/v2/https";

import {generateGraphNodeImages} from "../graph/v0/graphImages.js";

import {
  outpaintWideAndTall,
} from "../modal/outpaint.js";

import {
  structure,
  testStabilityBatch,
} from "../ai/stability/stability.js";

import {
  mediumDispatchInstance,
  dataToBody,
} from "../util/dispatch.js";

import {
  generateNewGraph,
  graphQueue,
  continueGraphPipeline as continueGraphPipelineFunc,
} from "../graph/graphPipeline.js";

import {
  getGraphFirestore,
} from "../storage/firestore/graph.js";

import {
  getGraph,
} from "../storage/storage.js";

import {
  firebaseFnConfig,
  firebaseHttpFnConfig,
  GRAPH_CHECKUP_THRESHOLD_MINUTES,
} from "../config/config.js";

import {
  cleanupGraphData,
  graphCheckup,
} from "../util/graphHelper.js";

import {
  resetCatalogueItemForGraphGeneration,
} from "../util/adminLogic.js";

export const v1AdminOutpaintImage = onRequest(firebaseHttpFnConfig, async (req, res) => {
  await validateOnRequestAdmin(req);
  res.status(200).send(await outpaintWideAndTall(req.body));
});

export const v1AdminStructureImage = onRequest(firebaseHttpFnConfig, async (req, res) => {
  await validateOnRequestAdmin(req);
  res.status(200).send(await structure(req.body));
});

export const v1AdminBatchStabilityTEST = onRequest(firebaseHttpFnConfig, async (req, res) => {
  await validateOnRequestAdmin(req);
  res.status(200).send(await testStabilityBatch(req.body));
});

// Dispatch Tasks.

export const v1generateGraph = onRequest(firebaseHttpFnConfig, async (req, res) => {
  await validateOnRequestAdmin(req);
  res.status(200).send(await generateNewGraph({
    ...req.body,
  }));
});

export const v1getGraphs = onRequest(firebaseHttpFnConfig, async (req, res) => {
  await validateOnRequestAdmin(req);
  res.status(200).send(await getGraphFirestore({
    ...req.body,
  }));
});

export const v1continueGraph = onRequest(firebaseHttpFnConfig, async (req, res) => {
  await validateOnRequestAdmin(req);
  res.status(200).send(await continueGraphPipelineFunc({
    ...req.body,
  }));
});

export const graphPipeline = onTaskDispatched(
    mediumDispatchInstance({maxConcurrentDispatches: 50, concurrency: 1}),
    async (req) => {
      logger.debug(`graphPipeline: ${JSON.stringify(req.data)}`);
      return await graphQueue(dataToBody(req).body);
    });

export const continueGraphPipeline = onTaskDispatched(
    mediumDispatchInstance({maxConcurrentDispatches: 50}),
    async (req) => {
      logger.debug(`continueGraphPipeline task: ${JSON.stringify(req.data)}`);
      const {graphId, stage, startChapter, endChapter} = req.data;
      return await continueGraphPipelineFunc({graphId, stage, startChapter, endChapter});
    });

export const v1graphContents = onRequest(firebaseHttpFnConfig, async (req, res) => {
  await validateOnRequestAdmin(req);
  res.status(200).send(await getGraph(req.body));
});

export const v1adminInitGraphGeneration = onRequest(firebaseHttpFnConfig, async (req, res) => {
  await validateOnRequestAdmin(req);
  await resetCatalogueItemForGraphGeneration({sku: req.body.sku, uid: req.body.uid, replace: true});
  res.status(200).send({status: `v1adminInitGraphGeneration: attempting to create new graph for ${req.body.sku} by ${req.body.uid}`});
});

/**
 * Generate node images (characters and locations) for a graph
 */
export const generateNodeImages = onCall({...firebaseFnConfig, cors: true}, async (request) => {
  const {graphId, uid, sku, visibility} = request.data;

  if (!graphId) {
    throw new Error("graphId is required");
  }

  logger.debug(`Generating node images for graph ${graphId}`);

  try {
    await generateGraphNodeImages({
      graphId,
      uid,
      sku,
      visibility,
    });
  } catch (error) {
    logger.error(`Error generating node images: ${error.message}`);
    throw new Error(`Failed to generate node images: ${error.message}`);
  }
});

/**
 * Clean up graph data from Catalogue and users library items
 * Unsets graph-related fields and removes library items
 */
export const v1cleanupGraphs = onCall({...firebaseFnConfig, cors: true}, async (request) => {
  const {excludeSkus, excludeUsers} = request.data;
  return await cleanupGraphData({excludeSkus, excludeUsers});
});

/**
 * Scheduled function to check for stuck graph processing
 * Runs every 30 minutes to identify catalogue items with missing graphs
 */
export const v1graphCheckupCron = onSchedule({
  schedule: "every 10 minutes",
  region: "europe-west1",
  memory: "512MiB",
  maxInstances: 1,
}, async () => {
  const thresholdMinutes = parseInt(GRAPH_CHECKUP_THRESHOLD_MINUTES.value(), 10);
  logger.info(`Running scheduled graph checkup with threshold: ${thresholdMinutes} minutes`);
  try {
    await graphCheckup(thresholdMinutes);
    logger.info("Graph checkup completed successfully");
  } catch (error) {
    logger.error(`Graph checkup cron failed: ${error.message}`);
  }
});

