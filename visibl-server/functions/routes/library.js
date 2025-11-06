/* eslint-disable require-jsdoc */
// import app from "../firebase.js";
import {onCall} from "firebase-functions/v2/https";
import {validateOnCallAuth} from "../auth/auth.js";
import {firebaseFnConfig} from "../config/config.js";

import {
  libraryAddItemRtdb,
  libraryDeleteItemRtdb,
  libraryGetAllRtdb,
  librarySetItemProgressRtdb,
} from "../storage/realtimeDb/library.js";

/**
 * Cloud Function to create a new book entry.
 * This function is triggered by an on-call request and requires the user to be authenticated.
 *
 * @param {object} context - The context object provided by Firebase Functions, containing authentication details and data.
 * @returns {Promise<object>} A promise that resolves to an object containing the user's UID and the data provided.
 */
export const v1addItemToLibrary = onCall(firebaseFnConfig, async (context) => {
  const {uid, data} = await validateOnCallAuth(context);
  return libraryAddItemRtdb({uid, data});
});

/**
 * Retrieves a book from the Firestore database based on the user's UID and the book ID provided in the data.
 * This function is triggered by an on-call request and requires the user to be authenticated.
 *
 * @param {object} context - The context object provided by Firebase Functions, containing authentication details and data.
 * @returns {Promise<object>} A promise that resolves to the book data if found and the user is authenticated, otherwise null.
 */
export const v1getLibrary = onCall(firebaseFnConfig, async (context) => {
  const {uid, data} = await validateOnCallAuth(context);
  return libraryGetAllRtdb({uid, data});
});


/**
 * Requests the server delete a book, including any items in storage
 * This function is triggered by an on-call request and requires the user to be authenticated.
 *
 * @param {object} context - The context object provided by Firebase Functions, containing authentication details and data.
 * @returns {Promise<object>} A promise that resolves to the book data if found and the user is authenticated, otherwise null.
 */
export const v1deleteItemsFromLibrary = onCall(firebaseFnConfig, async (context) => {
  const {uid, data} = await validateOnCallAuth(context);
  return libraryDeleteItemRtdb({uid, data});
});

export const v1setLibraryItemProgress = onCall(firebaseFnConfig, async (context) => {
  const {uid, data} = await validateOnCallAuth(context);
  return await librarySetItemProgressRtdb({uid, data});
});
