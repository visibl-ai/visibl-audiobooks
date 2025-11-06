/* eslint-disable require-jsdoc */
/* eslint-disable no-unused-vars */
import {
  getFirestore,
  Timestamp} from "firebase-admin/firestore";
import logger from "../../util/logger.js";

async function aaxStoreAuthFirestore({uid, aaxUserId}) {
  const db = getFirestore();
  const authRef = db.collection("AAXAuth").doc(aaxUserId);
  await authRef.set({uid, aaxUserId});
}

async function aaxGetAuthByAAXIdFirestore({aaxUserId}) {
  const db = getFirestore();
  const authRef = db.collection("AAXAuth").doc(aaxUserId);
  const auth = await authRef.get();
  return auth.data();
}

async function aaxStoreItemsFirestore({uid, library}) {
  const db = getFirestore();

  const batch = db.batch();

  for (const libraryItem of library) {
    logger.debug(`UserAAXSync: Storing item ${JSON.stringify(libraryItem)}`);
    const item = {
      uid,
      id: `${uid}:${libraryItem.sku_lite}`,
      title: libraryItem.title,
      asin: libraryItem.asin,
      sku: libraryItem.sku_lite,
      ...(libraryItem.licenceRules && {licenceRules: libraryItem.licenceRules}),
      ...(libraryItem.transcriptionsGenerated && {transcriptionsGenerated: libraryItem.transcriptionsGenerated}),
      ...(libraryItem.key && {key: libraryItem.key}),
      ...(libraryItem.iv && {iv: libraryItem.iv}),
      ...(libraryItem.chapterMap && {chapterMap: libraryItem.chapterMap}),
      ...(libraryItem.fiction && {fiction: libraryItem.fiction}),
      ...(libraryItem.isConsumableOffline !== undefined && {isConsumableOffline: libraryItem.customer_rights?.is_consumable_offline}),
      ...(libraryItem.isListenable !== undefined && {isListenable: libraryItem.is_listenable}),
      ...(libraryItem.runtimeLengthMinutes !== undefined && {runtimeLengthMinutes: libraryItem.runtime_length_min}),
      ...(libraryItem.transcriptions && {transcriptions: libraryItem.transcriptions}),
    };
    const libraryRef = db.collection("UserAAXSync").doc(`${uid}:${item.sku}`);
    batch.set(libraryRef, item, {merge: true});
  }
  await batch.commit();
}

async function aaxGetItemsFirestore({uid}) {
  const db = getFirestore();
  const itemsRef = db.collection("UserAAXSync").where("uid", "==", uid);
  const items = await itemsRef.get();
  return items.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  }));
}

async function aaxGetItemFirestore(id) {
  const db = getFirestore();
  const itemRef = db.collection("UserAAXSync").doc(id);
  const item = await itemRef.get();
  const data = item.data();
  return {id, ...data};
}

async function aaxAsinFromSkuFirestore(uid, sku) {
  const db = getFirestore();
  const itemRef = db.collection("UserAAXSync").doc(`${uid}:${sku}`);
  const item = await itemRef.get();

  if (!item.exists) {
    return null; // or throw an error, depending on your preference
  }

  const data = item.data();
  return data && data.asin ? data.asin : null;
}

async function aaxUpdateItemFirestore(item) {
  const db = getFirestore();
  const itemRef = db.collection("UserAAXSync").doc(item.id);
  await itemRef.update(item);
}

async function aaxDeleteItemFirestore(item) {
  const db = getFirestore();
  const itemRef = db.collection("UserAAXSync").doc(item.id);
  await itemRef.delete();
}


async function aaxGetUsersBySkuFirestore({sku}) {
  const db = getFirestore();
  const itemsRef = db.collection("UserAAXSync").where("sku", "==", sku);
  const items = await itemsRef.get();
  return items.docs.map((doc) => doc.data().uid);
}

/**
 * Delete all AAX syncs for a user
 * @param {string} uid - The UID of the user
 * @return {Promise<{deletedCount: number}>} - The number of deleted syncs
 */
async function aaxDeleteItemsByUidFirestore({uid}) {
  const db = getFirestore();
  const syncRef = db.collection("UserAAXSync").where("uid", "==", uid);
  const snapshot = await syncRef.get();
  if (!snapshot.empty) {
    const batch = db.batch();
    snapshot.docs.forEach((doc) => {
      batch.delete(doc.ref);
    });
    await batch.commit();
    logger.info(`Deleted ${snapshot.docs.length} AAX sync(s) for user: ${uid}`);
    return {deletedCount: snapshot.docs.length};
  } else {
    logger.info(`No AAX sync found for user: ${uid}`);
    return {deletedCount: 0};
  }
}


export {
  aaxStoreAuthFirestore,
  aaxGetAuthByAAXIdFirestore,
  aaxStoreItemsFirestore,
  aaxUpdateItemFirestore,
  aaxDeleteItemFirestore,
  aaxGetItemsFirestore,
  aaxAsinFromSkuFirestore,
  aaxGetItemFirestore,
  aaxGetUsersBySkuFirestore,
  aaxDeleteItemsByUidFirestore,
};
