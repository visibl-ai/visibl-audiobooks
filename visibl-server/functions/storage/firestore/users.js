/* eslint-disable require-jsdoc */
import {
  getFirestore} from "firebase-admin/firestore";

import logger from "../../util/logger.js";

import {
  usersRegisterToken,
  usersGet,
} from "../realtimeDb/users.js";

import {
  AAX_CONNECT_SOURCE,
} from "../../config/config.js";

const AAX_ACTIVE_DEFAULT = true;


async function getAAXAvailableFirestore(uid) {
  const snapshot = await getFirestore().collection("AAXActive").doc(uid).get();
  const active = snapshot.exists ? snapshot.data().active : AAX_ACTIVE_DEFAULT;
  if (active) {
    return {active: active, source: AAX_CONNECT_SOURCE.value()};
  }
  return {active: active};
}

async function setAAXAvailableFirestore(req) {
  await getFirestore().collection("AAXActive").doc(req.body.uid).set({active: req.body.active});
  return {active: req.body.active, uid: req.body.uid};
}

async function setAAXConnectDisableFirestore(uid) {
  const db = getFirestore();
  logger.debug(`setAAXConnectDisableFirestore: ${uid}`);
  const authRef = db.collection("AAXAuth").where("uid", "==", uid);
  const snapshot = await authRef.get();
  if (!snapshot.empty) {
    const batch = db.batch();
    snapshot.docs.forEach((doc) => {
      batch.delete(doc.ref);
    });
    await batch.commit();
    logger.info(`Deleted ${snapshot.docs.length} AAX connection(s) for user: ${uid}`);
    return {deletedCount: snapshot.docs.length};
  } else {
    logger.info(`No AAX connection found for user: ${uid}`);
    return {deletedCount: 0};
  }
}

async function registerForNotificationsFirestore(uid, data) {
  const token = data.fcmToken;
  if (!token) {
    throw new Error("fcmToken is required");
  }
  return await usersRegisterToken({uid, fcmToken: token});
}

async function getUsers({uids}) {
  return await usersGet({uids});
}

export {
  getAAXAvailableFirestore,
  setAAXAvailableFirestore,
  setAAXConnectDisableFirestore,
  registerForNotificationsFirestore,
  getUsers,
};
