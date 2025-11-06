/* eslint-disable max-len */
import logger from "../util/logger.js";
import {saveUser, getUser} from "../storage/realtimeDb/users.js";
import {createUserFolder} from "../storage/storage.js";
import {ADMIN_API_KEY} from "../config/config.js";
import {getAuth} from "firebase-admin/auth";
import {libraryGetAllRtdb, libraryUpdateItemRtdb} from "../storage/realtimeDb/library.js";
/**
 * This function is triggered when a new user is created.
 * It handles the creation of a new user
 * in the Firestore database and sets up a personal
 * storage bucket for the user's files.
 * @param {Object} event - The event object from firebase
 *
 * Event looks like:
 *
 {
  locale: 'und',
  ipAddress: '18.xxx.125',
  userAgent: 'FirebaseAuth.iOS/10.26.0 com.xxxx/5.2.8 iPhone/17.5 hw/sim,gzip(gfe),gzip(gfe)',
  eventId: '7******Q',
  eventType: 'providers/cloud.auth/eventTypes/user.beforeCreate:password',
  authType: 'USER',
  resource: {
    service: 'identitytoolkit.googleapis.com',
    name: 'projects/visibl-dev-ali'
  },
  timestamp: 'Wed, 22 May 2024 14:53:22 GMT',
  additionalUserInfo: {
    providerId: 'password',
    profile: undefined,
    username: undefined,
    isNewUser: true,
    recaptchaScore: undefined
  },
  credential: null,
  params: {},
  data: {
    uid: 'W****2',
    email: 'xxxxxx@xxxxxx.com',
    emailVerified: false,
    displayName: undefined,
    photoURL: undefined,
    phoneNumber: undefined,
    disabled: false,
    metadata: {
      creationTime: 'Wed, 22 May 2024 14:53:22 GMT',
      lastSignInTime: 'Wed, 22 May 2024 14:53:22 GMT'
    },
    providerData: [ [Object] ],
    passwordHash: ,
    passwordSalt: ,
    customClaims: ,
    tenantId: ,
    tokensValidAfterTime: null,
    multiFactor: null
  }
}
 */
async function newUser(event) {
  logger.debug(`FUNCTION: new user creation.`);
  const user = {
    uid: event.data.uid,
    createdAt: event.data.metadata.creationTime,
  };
  const bucketPath = await createUserFolder({uid: user.uid});
  user.bucketPath = bucketPath;
  await saveUser({uid: user.uid, user});
  return;
}

/**
 * Validates the authentication context for an on-call function.
 * Ensures that the user making the request is authenticated.
 *
 * @param {object} context - The context object provided by Firebase Functions.
 * @return {Promise<object>} A promise that resolves with the user's UID and data if authenticated.
 * @throws {Error} If the user is not authenticated.
 */
async function validateOnCallAuth(context) {
  if (!context.auth || !context.auth.uid) {
    logger.error("User not authenticated");
    logger.error(context);
    throw new Error("User not authenticated");
  } else {
    return {uid: context.auth.uid, data: context.data};
  }
}
/**
 * Validates the authentication for an admin request using an API key.
 * Ensures that the request header contains a valid API key matching ADMIN_API_KEY.
 *
 * @param {object} req - The request object from Express.
 * @throws {Error} If the API key is missing or invalid.
 */
async function validateOnRequestAdmin(req) {
  const apiKey = req.get("API-KEY");
  if (!apiKey) {
    logger.error("API key is missing");
    throw new Error("API key is required");
  }

  if (apiKey !== ADMIN_API_KEY.value()) {
    logger.error("Invalid API key");
    throw new Error("Invalid API key");
  }
  return true;
}


// eslint-disable-next-line require-jsdoc
async function getAllUsers({pageSize = 1000, nextPageToken}) {
  logger.debug(`FUNCTION: getAllUsers. pageSize: ${pageSize}, nextPageToken: ${nextPageToken}`);
  const listUsersResult = await getAuth().listUsers(parseInt(pageSize || 1000), nextPageToken || undefined);
  return {
    users: listUsersResult.users,
    pageToken: listUsersResult.pageToken, // Token for getting next page, null if no more pages
  };
}

/**
 * Checks if a user account exists by email address.
 *
 * @param {object} params - The function parameters
 * @param {string} params.email - The email address to check
 * @return {Promise<object>} Object containing user info if found
 * @throws {Error} If email is invalid or other errors occur
 */
async function checkAccountExists({email}) {
  if (!email) {
    throw new Error("Email is required");
  }

  // Basic email format validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    throw new Error("Invalid email format");
  }

  try {
    const auth = getAuth();
    const userRecord = await auth.getUserByEmail(email);
    return {
      uid: userRecord.uid,
      email: userRecord.email,
      exists: true,
    };
  } catch (error) {
    if (error.code === "auth/user-not-found") {
      return {
        email: email,
        message: "User not found",
        exists: false,
      };
    }
    logger.error(`Error checking account existence: ${error.message}`);
    throw error;
  }
}

/**
 * Merges an anonymous user's data with an authenticated user's data.
 * The anonymous user is marked as deleted after the merge.
 *
 * @param {object} params - The function parameters
 * @param {string} params.uid - The authenticated user's ID
 * @param {string} params.anonymousUid - The anonymous user's ID to merge from
 * @return {Promise<object>} The updated user data after merging
 * @throws {Error} If anonymous user is not found or is not anonymous
 */
async function mergeAnonymousUser({uid, anonymousUid}) {
  if (!anonymousUid) {
    throw new Error("Anonymous user ID is required");
  }

  // Get anonymous user data
  const auth = getAuth();
  try {
    const anonymousUser = await auth.getUser(anonymousUid);

    // Check if user is anonymous using Firebase Auth
    if (anonymousUser.providerData && anonymousUser.providerData.length > 0) {
      throw new Error("Specified user is not anonymous");
    }

    const anonymousLibrary = await libraryGetAllRtdb({uid: anonymousUid}) || {};

    // Update each anonymous library item individually
    for (const [sku, item] of Object.entries(anonymousLibrary)) {
      const updatedItem = {
        ...item,
        uid: uid, // Update the uid to the authenticated user
      };

      // Use libraryUpdateItemRtdb instead of deep cloning
      await libraryUpdateItemRtdb({
        uid,
        sku,
        data: updatedItem,
      });
    }

    // Soft delete anonymous user by marking it as deleted
    const softDeletedAnonymousUser = {
      uid: anonymousUser.uid,
      displayName: anonymousUser.displayName || null,
      isDeleted: true,
      deletedAt: new Date().toISOString(),
      mergedIntoUid: uid,
    };
    await saveUser({uid: anonymousUid, user: softDeletedAnonymousUser});

    // Return the updated user data
    return await getUser({uid});
  } catch (error) {
    if (error.code === "auth/user-not-found") {
      throw new Error("Anonymous user not found");
    }
    throw error;
  }
}

export {
  newUser,
  validateOnCallAuth,
  validateOnRequestAdmin,
  getAllUsers,
  checkAccountExists,
  mergeAnonymousUser,
};

