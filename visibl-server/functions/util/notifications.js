/* eslint-disable require-jsdoc */
import {getMessaging} from "firebase-admin/messaging";
import logger from "./logger.js";
import {getUsers} from "../storage/firestore/users.js";

async function getTokensFromUids({uids}) {
  const users = await getUsers({uids});
  return users
      .filter((user) => user.fcmToken)
      .map((user) => user.fcmToken);
}

async function sendNotifications({uids, title, body}) {
  const tokens = await getTokensFromUids({uids});
  logger.debug(`Sending notifications to ${JSON.stringify(tokens)} tokens`);
  const messages = [];
  tokens.forEach((token) => {
    const message = {
      notification: {
        title: title,
        body: body,
      },
      token: token,
    };
    messages.push(message);
  });
  if (messages.length === 0) {
    logger.error(`No messages to send`);
    return {successCount: 0, failureCount: 0, responses: []};
  }
  let responses;
  try {
    responses = await getMessaging().sendEach(messages);
  } catch (error) {
    logger.error(`Error sending notifications: ${error}`);
    return {successCount: 0, failureCount: messages.length, responses: []};
  }
  if (responses.responses) {
    logger.debug(`Sent notifications: ${responses.successCount} success, ${responses.failureCount} failure`);
    if (responses.failureCount > 0) {
      logger.error(`Error sending notifications: ${JSON.stringify(responses.responses)}`);
    }
  } else {
    logger.error(`Error sending notifications: ${responses}`);
  }
  return responses;
}

export {
  sendNotifications,
  getTokensFromUids,
};
