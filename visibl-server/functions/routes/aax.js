/* eslint-disable require-jsdoc */
import {onCall, onRequest} from "firebase-functions/v2/https";
import logger from "../util/logger.js";
import {validateOnCallAuth, validateOnRequestAdmin} from "../auth/auth.js";
import {firebaseFnConfig, firebaseHttpFnConfig} from "../config/config.js";
import {onTaskDispatched} from "firebase-functions/v2/tasks";
import {
  microDispatchInstance,
} from "../util/dispatch.js";
import {
  connectAAXAuth,
  disconnectAAXAuth,
  submitAAXTranscription,
  processAAXTranscription,
  updateAAXCLibrary,
  updateMetadata,
} from "../util/aaxHelper.js";

import {
  getAAXAvailableFirestore,
  setAAXAvailableFirestore,
} from "../storage/firestore/users.js";

import {
  aaxGetItemsFirestore,
  aaxUpdateItemFirestore,
  aaxDeleteItemFirestore,
} from "../storage/firestore/aax.js";


export const v1aaxConnect = onCall(firebaseFnConfig, async (context) => {
  const {uid, data} = await validateOnCallAuth(context);
  return await connectAAXAuth({uid, aaxUserId: data.aaxUserId});
});

export const v1disconnectAAX = onCall(firebaseFnConfig, async (context) => {
  const {uid, data} = await validateOnCallAuth(context);
  return await disconnectAAXAuth(uid, data);
});

export const v1getAAXAvailable = onCall(firebaseFnConfig, async (context) => {
  const {uid, data} = await validateOnCallAuth(context);
  return await getAAXAvailableFirestore(uid, data);
});

export const v1AdminSetAAXAvailable = onRequest(firebaseHttpFnConfig, async (req, res) => {
  await validateOnRequestAdmin(req);
  res.status(200).send(await setAAXAvailableFirestore(req));
});

export const v1AdminGetUserAAXSync = onRequest(firebaseHttpFnConfig, async (req, res) => {
  await validateOnRequestAdmin(req);
  await updateAAXCLibrary({uid: req.body.uid, data: {useExistingLibrary: true}});
  const items = await aaxGetItemsFirestore({uid: req.body.uid});
  res.status(200).send({success: true, items});
});

export const v1AdminDeleteUserAAXItem = onRequest(firebaseHttpFnConfig, async (req, res) => {
  await validateOnRequestAdmin(req);
  await aaxDeleteItemFirestore(req.body);
  res.status(200).send({success: true});
});

export const v1AdminUpdateAAXItem = onRequest(firebaseHttpFnConfig, async (req, res) => {
  await validateOnRequestAdmin(req);
  logger.debug(`v1AdminUpdateAAXItem: ${JSON.stringify(req.body)}`);
  await aaxUpdateItemFirestore(req.body);
  res.status(200).send({success: true});
});

export const v1updateAAXCLibrary = onCall({
  ...firebaseFnConfig,
  memory: "512MiB",
}, async (context) => {
  const {uid, data} = await validateOnCallAuth(context);
  return await updateAAXCLibrary({uid, data});
});

export const v1updateAAXMetadata = onCall(firebaseFnConfig, async (context) => {
  const {uid, data} = await validateOnCallAuth(context);
  return await updateMetadata({uid, sku: data.sku, metadata: data.metadata});
});

export const v1submitAAXTranscription = onCall(firebaseFnConfig, async (context) => {
  const {uid, data} = await validateOnCallAuth(context);
  return await submitAAXTranscription({
    uid,
    sku: data.sku,
    chapter: data.chapter,
    transcription: data.transcription,
  });
});

export const v1processAAXTranscription = onTaskDispatched(
    microDispatchInstance(),
    async (req) => {
      logger.debug(`v1processAAXTranscription: ${JSON.stringify(req.data).substring(0, 150)}...`);
      return await processAAXTranscription(req.data);
    });
