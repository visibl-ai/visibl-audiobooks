import {GoogleAuth} from "google-auth-library";
import {getFunctions} from "firebase-admin/functions";
import {
  getDispatchFunction,
  storeDispatchFunction,
} from "../storage/realtimeDb/dispatchCache.js";
import {ENVIRONMENT} from "../config/config.js";
import {firebaseFnConfig} from "../config/config.js";

import logger from "./logger.js";

const DEFAULT_REGION = "europe-west1";

let auth;
/**
 * Get the URL of a given v2 cloud function.
 * Not used anymore, until google requires it.
 *
 * @param {string} name the function's name
 * @param {string} location the function's location
 * @return {Promise<string>} The URL of the function
 */
async function getFunctionUrl(name, location=DEFAULT_REGION) {
  let uri = await getDispatchFunction({functionName: name});
  if (uri) {
    return uri;
  }
  if (!auth) {
    auth = new GoogleAuth({
      scopes: "https://www.googleapis.com/auth/cloud-platform",
    });
  }
  const projectId = await auth.getProjectId();
  const url = "https://cloudfunctions.googleapis.com/v2/" +
    `projects/${projectId}/locations/${location}/functions/${name}`;

  const client = await auth.getClient();
  // This is the slow request.
  const res = await client.request({url});
  uri = res.data?.serviceConfig?.uri;
  logger.debug(`getFunctionUrl: ${name} uri: ${uri}`);
  if (!uri) {
    throw new Error(`Unable to retreive uri for function at ${url}`);
  }
  await storeDispatchFunction({functionName: name, uri});
  return uri;
}

/**
 * Converts the data from a request object to a body format.
 *
 * @param {Object} req - The request object containing data.
 * @return {Object} An object with a 'body' property containing the request data.
 */
function dataToBody(req) {
  return {body: req.data};
}

/**
 * @return {Object} An object with a 'body' property containing the request data.
 * @param {Object} options - Configuration options
 * @param {number} options.maxConcurrentDispatches - The maximum number of concurrent dispatches (default: 1)
 * @param {number} options.concurrency - The number of concurrent requests per instance (optional)
 */
function largeDispatchInstance({maxConcurrentDispatches = 1, concurrency} = {}) {
  const config = {
    retryConfig: {
      maxAttempts: 1,
      minBackoffSeconds: 1,
    },
    rateLimits: {
      maxConcurrentDispatches: maxConcurrentDispatches,
    },
    region: DEFAULT_REGION,
    memory: "32GiB",
    timeoutSeconds: 3600,
    secrets: firebaseFnConfig.secrets,
  };

  // Only add concurrency if it's explicitly defined
  if (concurrency !== undefined) {
    config.concurrency = concurrency;
  }

  return config;
}

/**
 * @return {Object} An object with a 'body' property containing the request data.
 * @param {Object} options - Configuration options
 * @param {number} options.maxConcurrentDispatches - The maximum number of concurrent dispatches (default: 1)
 * @param {number} options.concurrency - The number of concurrent requests per instance (optional)
 */
function microDispatchInstance({maxConcurrentDispatches = 1, concurrency} = {}) {
  const config = {
    retryConfig: {
      maxAttempts: 1,
      minBackoffSeconds: 1,
    },
    rateLimits: {
      maxConcurrentDispatches: maxConcurrentDispatches,
    },
    region: DEFAULT_REGION,
    // memory: "128MiB",
    timeoutSeconds: 3600,
    secrets: firebaseFnConfig.secrets,
  };

  // Only add concurrency if it's explicitly defined
  if (concurrency !== undefined) {
    config.concurrency = concurrency;
  }

  return config;
}

/**
 * @return {Object} An object with a 'body' property containing the request data.
 * @param {Object} options - Configuration options
 * @param {number} options.maxConcurrentDispatches - The maximum number of concurrent dispatches (default: 1)
 * @param {number} options.concurrency - The number of concurrent requests per instance (default: 1)
 */
function mediumDispatchInstance({maxConcurrentDispatches = 1, concurrency = 1} = {}) {
  return {
    retryConfig: {
      maxAttempts: 1,
      minBackoffSeconds: 1,
    },
    rateLimits: {
      maxConcurrentDispatches: maxConcurrentDispatches,
    },
    concurrency: concurrency,
    region: DEFAULT_REGION,
    memory: "4GiB",
    timeoutSeconds: 3600,
    secrets: firebaseFnConfig.secrets,
  };
}

/**
 * @param {string} functionName
 * @param {Object} data
 * @param {number} deadline
 * @param {number} scheduleDelaySeconds
 * @param {string} location
 */
async function dispatchTask({functionName, data, deadline=60 * 5, scheduleDelaySeconds=0, location=DEFAULT_REGION}) {
  try {
    // let stepTime = Date.now();
    /*
        The function name can be either:
        1) A fully qualified function resource name:
        projects/{project}/locations/{location}/functions/{functionName}
        2) A partial resource name with location and function name, in which case the runtime project ID is used:
        locations/{location}/functions/{functionName}
        3) A partial function name, in which case the runtime project ID and the default location, us-central1, is used:
        {functionName}
    */
    if (ENVIRONMENT.value() === "development") {
      logger.debug(`Not dispatching task ${functionName} in dev.`);
      return;
    } else {
      const queue = getFunctions().taskQueue(`locations/${location}/functions/${functionName}`);
      await queue.enqueue(data, {
        scheduleDelaySeconds: scheduleDelaySeconds,
        dispatchDeadlineSeconds: deadline,
        // uri: targetUri, // TaskOptionsExperimental.uri - Turns out this is useless and super slow.
      });
      logger.debug(`Dispatched task ${functionName}`);
      return;
    }
  } catch (error) {
    if (ENVIRONMENT.value() === "development") {
      logger.debug(`Error dispatching task ${functionName}: ${error}`);
    } else {
      logger.error(`Error dispatching task ${functionName}: ${error}`);
    }
    return;
  }
}

export {
  getFunctionUrl,
  dataToBody,
  largeDispatchInstance,
  microDispatchInstance,
  mediumDispatchInstance,
  dispatchTask,
};
