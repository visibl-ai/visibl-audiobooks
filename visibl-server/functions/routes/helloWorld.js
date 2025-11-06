/* eslint-disable no-unused-vars */
/* eslint-disable require-jsdoc */
import logger from "../util/logger.js";
import {onCall} from "firebase-functions/v2/https";
import {validateOnCallAuth} from "../auth/auth.js";
import {ENVIRONMENT, firebaseFnConfig} from "../config/config.js";

/**
 * HTTP Cloud Function test.
 *
 * @param {Request} req - The HTTP request object.
 * @param {Response} res - The HTTP response object.
 */
export const helloWorld = onCall(firebaseFnConfig, async (context) => {
  // Check if the request is made by an authenticated user
  logger.debug(`ENVIRONMENT: ${ENVIRONMENT.value()}`);
  let uid;
  let data;
  try {
    const req = await validateOnCallAuth(context);
    uid = req.uid;
    data = req.data;
  } catch (error) {
    return {error: "User not authenticated"};
  }
  return {uid: uid, message: `Success! You made an authenticated request.`};
});
