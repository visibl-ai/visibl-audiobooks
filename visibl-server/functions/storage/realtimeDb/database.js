/* eslint-disable require-jsdoc */

// eslint-disable-next-line no-unused-vars
import {getDatabase, getDatabaseWithUrl} from "firebase-admin/database";
import logger from "../../util/logger.js";
import app from "../../firebase.js";

let dbGlobal = null;

function getDb() {
  if (!dbGlobal) {
    if (process.env.FIREBASE_DATABASE_EMULATOR_HOST) {
      logger.debug(`Using database emulator with URL: ${process.env.FIREBASE_DATABASE_EMULATOR_HOST}?ns=visibl-rtdb-dev-default-rtdb`);
      dbGlobal = getDatabaseWithUrl(`http://${process.env.FIREBASE_DATABASE_EMULATOR_HOST}?ns=visibl-rtdb-dev-default-rtdb`);
    } else {
      dbGlobal = getDatabase(app);
    }
  }
  return dbGlobal;
}

async function storeData({ref, data}) {
  const db = getDb();
  await db.ref(ref).set(data);
}

async function getData({ref, query}) {
  const db = getDb();
  let dbRef = db.ref(ref);

  // Apply query parameters if provided
  if (query) {
    if (query.orderByKey) {
      dbRef = dbRef.orderByKey();
    }
    if (query.orderByChild) {
      dbRef = dbRef.orderByChild(query.orderByChild);
    }
    if (query.equalTo !== undefined) {
      dbRef = dbRef.equalTo(query.equalTo);
    }
    if (query.limitToFirst) {
      dbRef = dbRef.limitToFirst(query.limitToFirst);
    }
    if (query.limitToLast) {
      dbRef = dbRef.limitToLast(query.limitToLast);
    }
    if (query.startAt !== undefined) {
      dbRef = dbRef.startAt(query.startAt);
    }
    if (query.startAfter !== undefined) {
      dbRef = dbRef.startAfter(query.startAfter);
    }
    if (query.endAt !== undefined) {
      dbRef = dbRef.endAt(query.endAt);
    }
  }

  const snapshot = await dbRef.get();
  return snapshot.val();
}

async function deleteData({ref}) {
  const db = getDb();
  await db.ref(ref).remove();
}

async function deleteAllData() {
  const db = getDb();
  await db.ref().remove();
}

async function updateData({ref, data}) {
  const db = getDb();
  await db.ref(ref).update(data);
}

export {
  storeData,
  getData,
  deleteData,
  deleteAllData,
  updateData,
};
