/* eslint-disable require-jsdoc */
// import app from "../firebase.js";
import logger from "../util/logger.js";
import {onCall, onRequest} from "firebase-functions/v2/https";
import {beforeUserCreated} from "firebase-functions/v2/identity";
import {firebaseFnConfig, firebaseHttpFnConfig} from "../config/config.js";
import {
  newUser,
  validateOnCallAuth,
  validateOnRequestAdmin,
  getAllUsers,
  checkAccountExists,
  mergeAnonymousUser,
} from "../auth/auth.js";
import {usersRegisterToken, getUser} from "../storage/realtimeDb/users.js";
import {sendNotifications} from "../util/notifications.js";

export const newUserTriggers =
  beforeUserCreated({region: "europe-west1", memory: "512MiB"}, async (event) => {
    logger.debug(`FUNCTION: beforeUserCreated - newUserTriggers`);
    logger.debug(event);
    try {
      await newUser(event);
    } catch (error) {
      logger.error(error);
    }
    return;
  });

export const getCurrentUser = onCall(firebaseFnConfig, async (context) => {
  const {uid} = await validateOnCallAuth(context);
  return await getUser({uid});
});

export const registerForNotifications = onCall(firebaseFnConfig, async (context) => {
  const {uid, data} = await validateOnCallAuth(context);
  return await usersRegisterToken({uid, data});
});

export const v1sendTestNotification = onRequest(firebaseHttpFnConfig, async (req, res) => {
  await validateOnRequestAdmin(req);
  const {uid, title, body} = req.body;
  const responses = await sendNotifications({uids: [uid], title, body});
  res.status(200).send(responses);
});

export const v1adminGetUsers = onRequest(firebaseHttpFnConfig, async (req, res) => {
  await validateOnRequestAdmin(req);
  const users = await getAllUsers(req.body);
  res.status(200).send(users);
});

export const lookupAccountByEmail = onCall(firebaseFnConfig, async (context) => {
  const {data} = await validateOnCallAuth(context);
  return await checkAccountExists({email: data.email});
});

export const migrateAnonymousData = onCall(firebaseFnConfig, async (context) => {
  const {uid, data} = await validateOnCallAuth(context);
  return await mergeAnonymousUser({uid, anonymousUid: data?.anonymousUid});
});

