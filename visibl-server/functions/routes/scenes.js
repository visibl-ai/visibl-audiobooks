/* eslint-disable require-jsdoc */
import {onCall, onRequest} from "firebase-functions/v2/https";
import {validateOnCallAuth, validateOnRequestAdmin} from "../auth/auth.js";
import logger from "../util/logger.js";
import {firebaseFnConfig, firebaseHttpFnConfig} from "../config/config.js";

import {
  deleteSceneFiles,
} from "../storage/storage.js";

import {
  getScenesFromCache,
  deleteSceneFromCache,
} from "../storage/realtimeDb/scenesCache.js";

import {
  getStylesFromCatalogueRtdb,
  catalogueDeleteStyleRtdb,
} from "../storage/realtimeDb/catalogue.js";

import {styleScenesWithQueue, createStyle} from "../ai/images/style/index.js";

import {
  compressImage,
} from "../util/sharp.js";

export const v1compressImage = onRequest(firebaseHttpFnConfig, async (req, res) => {
  await validateOnRequestAdmin(req);
  res.status(200).send(await compressImage(req.body));
});

export const v1getScene = onRequest(firebaseHttpFnConfig, async (req, res) => {
  await validateOnRequestAdmin(req);
  logger.debug(`getScene request ${JSON.stringify(req.body)}`);
  const scenes = await getScenesFromCache({sceneId: req.body.sceneId});
  res.status(200).send(scenes);
});


export const v1getStyles = onCall(firebaseFnConfig, async (context) => {
  const {data} = await validateOnCallAuth(context);
  return await getStylesFromCatalogueRtdb({sku: data.sku});
});

/**
 * Delete a scene from the database and the cache.
 * @param {Object} context - The context object.
 * @param {Object} data - The data object.
 * @param {string} data.sceneId - The scene ID.
 * @param {string} data.sku - The SKU.
 * @returns {Promise<Object>} - The response object.
 */
export const v1deleteStyle = onCall(firebaseFnConfig, async (context) => {
  const {data} = await validateOnCallAuth(context);
  data.sceneId = await deleteSceneFromCache(data);
  await catalogueDeleteStyleRtdb(data);
  return await deleteSceneFiles(data);
});

export const v1adminGetAllScenesBySku = onRequest(firebaseHttpFnConfig, async (req, res) => {
  await validateOnRequestAdmin(req);
  res.status(200).send(await getStylesFromCatalogueRtdb({sku: req.body.sku}));
});

export const v1adminDeleteScene = onRequest(firebaseHttpFnConfig, async (req, res) => {
  await validateOnRequestAdmin(req);
  // TODO: Fix admin to use styleID instead of sceneId
  res.status(200).send(await catalogueDeleteStyleRtdb({styleId: req.body.sceneId, sku: req.body.sku}));
});

export const v1addStyle = onCall({
  ...firebaseFnConfig,
  minInstances: 1,
  memory: "512MiB",
}, async (context) => {
  const {uid, data} = await validateOnCallAuth(context);
  logger.debug(`v1addStyle: Adding style ${JSON.stringify(data)}`);
  return await createStyle({uid, ...data});
});

export const v1AdminStyleScenes = onRequest(firebaseHttpFnConfig, async (req, res) => {
  await validateOnRequestAdmin(req);
  await styleScenesWithQueue(req.body);
  res.status(200).send({
    success: true,
    message: `Queued ${req.body.scenes.length} scenes for styling with ${req.body.provider || "stability"}`,
  });
});

