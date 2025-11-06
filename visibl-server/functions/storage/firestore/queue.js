/* eslint-disable camelcase */
/* eslint-disable require-jsdoc */
import {
  getFirestore} from "firebase-admin/firestore";
import {removeUndefinedProperties} from "../firestore.js";

import logger from "../../util/logger.js";

async function queueNuke() {
  const db = getFirestore();
  const queueRef = db.collection("Queue");
  const snapshot = await queueRef.get();

  const batch = db.batch();
  snapshot.docs.forEach((doc) => {
    batch.delete(doc.ref);
  });

  await batch.commit();

  logger.debug(`Nuked ${snapshot.size} entries from the queue`);
  return {success: true, deletedCount: snapshot.size};
}

function stabilityQueueToUnique(params) {
  const {type, entryType, sceneId, chapter, scene_number, retry = false} = params;
  // Check if any of the required parameters are undefined
  if (type === undefined || entryType === undefined || sceneId === undefined ||
      chapter === undefined || scene_number === undefined) {
    throw new Error("All parameters (type, entryType, sceneId, chapter, scene_number) must be defined");
  }

  // If all parameters are defined, return a unique identifier
  const retryString = retry ? "_retry" : "";
  return `${type}_${entryType}_${sceneId}_${chapter}_${scene_number}${retryString}`;
}

// For now, we use the same unique identifier for modal and stability
const modalQueueToUnique = stabilityQueueToUnique;

function dalleQueueToUnique(params) {
  const {type, entryType, sceneId, chapter, scene_number, retry = false, graphId, nodeType, nodeName} = params;

  // Handle scene-based entries
  if (sceneId !== undefined && chapter !== undefined && scene_number !== undefined) {
    // Check if any of the required parameters are undefined
    if (type === undefined || entryType === undefined) {
      throw new Error("All parameters (type, entryType) must be defined for scene entries");
    }

    // If all parameters are defined, return a unique identifier for scene
    const retryString = retry ? "_retry" : "";
    return `${type}_${entryType}_${sceneId}_${chapter}_${scene_number}${retryString}`;
  }

  // Handle graph node entries
  if (graphId !== undefined && nodeType !== undefined && nodeName !== undefined) {
    // Check if any of the required parameters are undefined
    if (type === undefined || entryType === undefined) {
      throw new Error("All parameters (type, entryType) must be defined for graph node entries");
    }

    // If all parameters are defined, return a unique identifier for graph node
    const retryString = retry ? "_retry" : "";
    return `${type}_${entryType}_${graphId}_${nodeType}_${nodeName.toLowerCase().replace(/\s+/g, "_")}${retryString}`;
  }

  throw new Error("Invalid parameters for unique identifier generation");
}

function transcriptionQueueToUnique(params) {
  const {entryType, taskParams, retry = false} = params;
  const {uid, sku, chapter, unique} = taskParams;
  if (entryType === undefined || uid === undefined || sku === undefined || chapter === undefined) {
    throw new Error("All parameters (entryType, uid, sku, chapter) must be defined");
  }

  // Generate datetime string in YYYYMMDDHHMM format if no unique is provided
  const uniqueId = unique || (() => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    const hour = String(now.getHours()).padStart(2, "0");
    const minute = String(now.getMinutes()).padStart(2, "0");
    return `${year}${month}${day}${hour}${minute}`;
  })();

  return `${entryType}_${uid}_${sku}_${chapter}_${uniqueId}${retry ? "_retry" : ""}`;
}

/**
 * Generate a unique identifier for an ai queue entry
 * @param {Object} options - The parameters object
 * @param {string} options.type - The queue type
 * @param {string} options.model - The model name
 * @param {string} options.entryType - The entry type
 * @param {Object} options.taskParams - The task parameters
 * @param {string} options.referenceKey - The reference key
 * @param {boolean} options.retry - Whether this is a retry
 * @return {string} Unique identifier string
 */
function aiQueueToUnique(options) {
  const {
    type,
    model,
    entryType,
    taskParams,
    referenceKey = `${Date.now()}_${Math.random().toString(36).substring(2, 15)}`,
    retry = false,
  } = options;
  // Check if any of the required parameters are undefined
  if (type === undefined || model === undefined || entryType === undefined || taskParams === undefined) {
    throw new Error(`All parameters (type, model, entryType, taskParams) must be defined. Got: type=${type}, model=${model}, entryType=${entryType}, taskParams=${taskParams === undefined ? "undefined" : "defined"}`);
  }

  // Replace forward slashes with underscores in model name to ensure valid document path
  const safeModel = model.replace(/\//g, "_");

  // Return unique identifier with timestamp and random component
  return `${type}_${safeModel}_${entryType}_${referenceKey}${retry ? "_retry" : ""}`;
}

function graphQueueToUnique(params) {
  const {type, entryType, graphId, chapter} = params;
  // Check if any of the required parameters are undefined
  if (type === undefined || entryType === undefined || graphId === undefined ) {
    throw new Error("All parameters (type, entryType, graphId) must be defined");
  }

  // If all parameters are defined, return a unique identifier
  const chapterString = chapter ? `_${chapter}` : "";
  return `${type}_${entryType}_${graphId}${chapterString}`;
}

function deduplicateEntries(params) {
  const {types, entryTypes, entryParams, uniques, statuses = [], traces = []} = params;
  // Ensure that types, entryTypes, entryParams and unique are not null
  if (!types || !entryTypes || !entryParams || !uniques) {
    throw new Error("types, entryTypes, entryParams, and unique must not be null");
  }
  // Check for duplicates in uniques and remove them along with corresponding entries
  const uniqueSet = new Set();
  const indicesToRemove = [];

  for (let i = uniques.length - 1; i >= 0; i--) {
    if (uniqueSet.has(uniques[i])) {
      indicesToRemove.push(i);
    } else {
      uniqueSet.add(uniques[i]);
    }
  }

  for (const index of indicesToRemove) {
    types.splice(index, 1);
    entryTypes.splice(index, 1);
    entryParams.splice(index, 1);
    uniques.splice(index, 1);
    if (statuses.length > 0) statuses.splice(index, 1);
    if (traces.length > 0) traces.splice(index, 1);
  }

  if (indicesToRemove.length > 0) {
    logger.debug(`Removed ${indicesToRemove.length} duplicate entries`);
  }
  return {types, entryTypes, entryParams, uniques, statuses, traces};
}

async function queueAddEntries(params) {
  const {types, entryTypes, entryParams, uniques, statuses = [], traces = []} = deduplicateEntries(params);
  const db = getFirestore();
  const queueRef = db.collection("Queue");
  const batch = db.batch();
  const entriesAdded = [];
  const addedTypes = [];
  for (let i = 0; i < types.length; i++) {
    const now = Date.now();
    const entry = {
      type: types[i],
      entryType: entryTypes[i],
      params: entryParams[i],
      status: statuses[i] || "pending",
      trace: traces[i] || `Added to queue at ${now.toString()}`,
      timeRequested: now,
      timeUpdated: now,
    };
    const docRef = queueRef.doc(uniques[i]);
    const docSnapshot = await docRef.get();
    if (!docSnapshot.exists) {
      try {
        batch.create(docRef, entry);
        entriesAdded.push(entry);
        if (!addedTypes.includes(types[i])) {
          addedTypes.push(types[i]);
        }
      } catch (error) {
        logger.error(`Failed to add entry ${uniques[i]} to queue: ${error.message} ${JSON.stringify(entry)}`);
      }
    } else {
      logger.debug(`Entry ${uniques[i]} already exists in the queue, not re-adding.`);
    }
  }

  // If no entries were added, return early with success
  if (entriesAdded.length === 0) {
    logger.debug(`No new entries to add to queue (all may already exist or failed to create)`);
    return {success: true, ids: []};
  }

  try {
    await batch.commit();
    logger.debug(`Added ${entriesAdded.length} entries to the ${addedTypes.join(", ")} queue`);
    return {success: true, ids: entriesAdded.map((entry) => uniques[entriesAdded.indexOf(entry)])};
  } catch (error) {
    logger.error(`Failed to commit batch: ${error.message}`);
    logger.error(`Batch size: ${entriesAdded.length}, First unique ID: ${uniques[0]}`);
    logger.error(`Error stack: ${error.stack}`);
    return {success: false, error: error.message};
  }
}


async function queueGetEntries(params) {
  const {type, status, limit = 10, id, query, timeRequestedAfter, batchId} = params;
  logger.debug(`Getting entries from the queue with id: ${id}, query: ${JSON.stringify(query)}, type: ${type}, status: ${status}, batchId: ${batchId}, limit: ${limit}, timeRequestedAfter: ${timeRequestedAfter}`);
  const db = getFirestore();
  const queueRef = db.collection("Queue");

  // Priority 1: If ID is provided, get by exact document ID
  if (id) {
    const docRef = queueRef.doc(id);
    const docSnapshot = await docRef.get();
    if (docSnapshot.exists) {
      return [{
        id: docSnapshot.id,
        ...docSnapshot.data(),
      }];
    }
    // If ID provided but doesn't exist, return empty array
    return [];
  }

  // Priority 2: If batchId is provided, query by batchId
  if (batchId) {
    let batchQuery = queueRef
        .where("params.batchId", "==", batchId)
        .limit(limit);

    // Add status filter if provided
    if (status) {
      batchQuery = batchQuery.where("status", "==", status);
    }

    const snapshot = await batchQuery.get();
    const entries = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    // Sort results by timeRequested so we don't need a composite index
    entries.sort((a, b) => (a.timeRequested || 0) - (b.timeRequested || 0));

    logger.debug(`Got ${entries.length} entries from the queue for batchId: ${batchId}, status: ${status}`);
    return entries;
  }

  // Priority 3: If query object is provided (single key/value pair), query by params field
  if (query && typeof query === "object" && query.key && query.value !== undefined) {
    // Note: We don't use orderBy here to avoid requiring a composite index
    // The results will be returned in the default order (by document ID)
    const paramsQuery = queueRef
        .where(`params.${query.key}`, "==", query.value)
        .limit(limit);

    const snapshot = await paramsQuery.get();
    const entries = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    // Sort results by timeRequested on the server side after fetching
    entries.sort((a, b) => (a.timeRequested || 0) - (b.timeRequested || 0));

    logger.debug(`Got ${entries.length} entries from params query: params.${query.key} == ${query.value}`);
    return entries;
  }

  // Priority 4: Query by type and status (only if no ID, batchId, or query provided)
  if (!type) {
    logger.debug("No ID, batchId, query, or type provided - returning empty array");
    return [];
  }

  let typeQuery = queueRef
      .where("type", "==", type)
      .orderBy("timeRequested", "asc")
      .limit(limit);

  if (status) {
    typeQuery = typeQuery.where("status", "==", status);
  }

  if (timeRequestedAfter) {
    typeQuery = typeQuery.where("timeRequested", ">=", timeRequestedAfter);
  }

  const snapshot = await typeQuery.get();
  const entries = snapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  }));

  logger.debug(`Got ${entries.length} entries from the queue for type: ${type}, status: ${status}, limit: ${limit}`);
  return entries;
}

async function queueUpdateEntries(params) {
  const {ids, statuses, traces = [], results = [], retryCounts = [], timeRequestedValues = []} = params;
  if (!statuses) {
    logger.error(`queueUpdateEntries:statuses parameter is required for queueUpdateEntries: ${JSON.stringify(params)}`);
  }
  const db = getFirestore();
  const queueRef = db.collection("Queue");
  const batch = db.batch();

  for (let i = 0; i < ids.length; i++) {
    const docRef = queueRef.doc(ids[i]);
    const updateData = {
      status: statuses[i],
      timeUpdated: Date.now(),
    };
    if (traces[i]) {
      updateData.trace = traces[i];
    }
    if (results[i]) {
      updateData.result = removeUndefinedProperties(results[i]);
    }
    if (retryCounts[i] !== undefined) {
      updateData.retryCount = retryCounts[i];
    }
    // Update timeRequested to delay retry processing
    if (timeRequestedValues[i] !== undefined) {
      updateData.timeRequested = timeRequestedValues[i];
    }
    batch.update(docRef, updateData);
  }
  await batch.commit();
  logger.debug(`Updated ${ids.length} entries in the queue`);
  return {success: true};
}

async function queueDeleteEntries(params) {
  const {ids} = params;
  const db = getFirestore();
  const queueRef = db.collection("Queue");
  const batch = db.batch();
  for (const id of ids) {
    const docRef = queueRef.doc(id);
    batch.delete(docRef);
  }
  await batch.commit();
  logger.debug(`Deleted ${ids.length} entries from the queue`);
  return {success: true};
}

async function queueSetItemStatuses(params) {
  const {queue, status, trace} = params;
  const updateParams = {
    ids: queue.map((entry) => entry.id),
    statuses: Array(queue.length).fill(status),
  };
  if (trace) {
    updateParams.traces = Array(queue.length).fill(trace);
  }
  await queueUpdateEntries(updateParams);
}

async function queueSetItemsToProcessing(params) {
  params.status = "processing";
  await queueSetItemStatuses(params);
}

async function queueSetItemsToComplete(params) {
  params.status = "complete";
  await queueSetItemStatuses(params);
}

async function queueSetItemsToError(params) {
  params.status = "error";
  params.trace = params.error || "Unknown error";
  await queueSetItemStatuses(params);
}

/**
 * Atomically claims pending queue items by updating their status to processing
 * This prevents race conditions when multiple instances try to process the same items
 * @param {Object} params - The parameters object
 * @param {string} params.type - Queue type to process
 * @param {string} params.status - Status to filter by (default: "pending")
 * @param {number} params.limit - Maximum number of items to claim (default: 10)
 * @param {number} params.timeRequestedAfter - Optional timestamp filter
 * @return {Promise<Array>} Array of claimed queue entries with their data
 */
async function queueClaimPendingItems(params) {
  const {type, status = "pending", limit = 10, timeRequestedAfter} = params;
  logger.debug(`Attempting to claim up to ${limit} ${status} items from ${type} queue`);

  const db = getFirestore();
  const queueRef = db.collection("Queue");
  const claimedItems = [];

  try {
    await db.runTransaction(async (transaction) => {
      // Build the query
      let query = queueRef
          .where("type", "==", type)
          .where("status", "==", status)
          .orderBy("timeRequested", "asc")
          .limit(limit);

      if (timeRequestedAfter) {
        query = query.where("timeRequested", ">=", timeRequestedAfter);
      }

      // Read all matching documents within the transaction
      const snapshot = await transaction.get(query);

      if (snapshot.empty) {
        logger.debug(`No ${status} items found in ${type} queue`);
        return;
      }

      // Update each document's status to processing atomically
      const now = Date.now();
      snapshot.docs.forEach((doc) => {
        transaction.update(doc.ref, {
          status: "processing",
          timeUpdated: now,
          processingStarted: now,
        });

        // Collect the claimed items
        claimedItems.push({
          id: doc.id,
          ...doc.data(),
        });
      });

      logger.debug(`Successfully claimed ${snapshot.docs.length} items from ${type} queue`);
    });
  } catch (error) {
    logger.error(`Transaction failed while claiming items from ${type} queue: ${error.message}`);
    throw error;
  }

  return claimedItems;
}

/**
 * Creates a batch record in Firestore
 * @param {Object} params - Batch parameters
 * @param {string} params.batchId - Unique batch identifier
 * @param {string} params.queueName - Name of the queue
 * @param {number} params.totalItems - Total number of items in batch
 * @param {string} params.webhookUrl - Optional webhook URL for completion notification
 * @param {Object} params.metadata - Optional metadata for the batch
 * @return {Promise<Object>} Created batch record
 */
async function batchCreate(params) {
  const {batchId, queueName, totalItems, webhookUrl = null, metadata = {}} = params;

  const db = getFirestore();
  const batchRef = db.collection("QueueBatches").doc(batchId);

  const batchData = {
    batchId,
    queueName,
    totalItems,
    completedItems: 0,
    failedItems: 0,
    processingItems: 0,
    status: "pending",
    webhookUrl,
    metadata,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    completedAt: null,
  };

  await batchRef.set(batchData);
  logger.debug(`Created batch ${batchId} with ${totalItems} items for ${queueName}`);
  return batchData;
}

/**
 * Gets the status of a batch
 * @param {string} batchId - Batch identifier
 * @return {Promise<Object|null>} Batch data or null if not found
 */
async function batchGetStatus(batchId) {
  const db = getFirestore();
  const batchRef = db.collection("QueueBatches").doc(batchId);
  const doc = await batchRef.get();

  if (!doc.exists) {
    return null;
  }

  return doc.data();
}

/**
 * Updates batch status with bulk counts using a transaction
 * @param {Object} params - Update parameters
 * @param {string} params.batchId - Batch identifier
 * @param {number} params.completedDelta - Number of completed items to add
 * @param {number} params.errorDelta - Number of error items to add
 * @param {number} params.processingDelta - Number of processing items to add
 * @param {number} params.retryAttempt - Current retry attempt (internal use)
 * @param {number} params.maxRetries - Maximum number of retries for transaction locks
 * @return {Promise<Object>} Updated batch data
 */
async function batchUpdateStatusBulk(params) {
  const {
    batchId,
    completedDelta = 0,
    errorDelta = 0,
    processingDelta = 0,
    retryAttempt = 0,
    maxRetries = 5,
  } = params;

  if (completedDelta === 0 && errorDelta === 0 && processingDelta === 0) {
    // No updates needed
    return null;
  }

  const db = getFirestore();
  const batchRef = db.collection("QueueBatches").doc(batchId);

  let updatedBatch = null;
  let shouldTriggerWebhook = false;

  try {
    await db.runTransaction(async (transaction) => {
      const doc = await transaction.get(batchRef);

      if (!doc.exists) {
        logger.error(`Batch ${batchId} not found`);
        return;
      }

      const currentData = doc.data();
      const updateData = {
        updatedAt: Date.now(),
      };

      // Update counters with bulk deltas
      if (processingDelta > 0) {
        // Increase processing items for new items entering processing
        updateData.processingItems = currentData.processingItems + processingDelta;
      }

      if (completedDelta > 0) {
        updateData.completedItems = currentData.completedItems + completedDelta;
        // Decrease processing items by the same amount
        if (currentData.processingItems > 0) {
          updateData.processingItems = Math.max(0, (updateData.processingItems ?? currentData.processingItems) - completedDelta);
        }
      }

      if (errorDelta > 0) {
        updateData.failedItems = currentData.failedItems + errorDelta;
        // Decrease processing items by the same amount
        if (currentData.processingItems > 0) {
          updateData.processingItems = Math.max(0, (updateData.processingItems ?? currentData.processingItems) - errorDelta);
        }
      }

      // Check if batch is complete
      const totalProcessed = (updateData.completedItems ?? currentData.completedItems) +
                            (updateData.failedItems ?? currentData.failedItems);
      const isComplete = totalProcessed >= currentData.totalItems;

      if (isComplete && currentData.status !== "complete") {
        updateData.status = "complete";
        updateData.completedAt = Date.now();
        shouldTriggerWebhook = true;
      } else if (currentData.status === "pending") {
        updateData.status = "processing";
      }

      transaction.update(batchRef, updateData);

      updatedBatch = {
        ...currentData,
        ...updateData,
      };
    });

    return {
      updatedBatch,
      shouldTriggerWebhook,
      webhookUrl: updatedBatch?.webhookUrl,
    };
  } catch (error) {
    // Check if it's a transaction lock error (contention)
    const errorMessage = (error.message || error.toString() || "").toLowerCase();
    const isTransactionLock =
      errorMessage.includes("lock") ||
      errorMessage.includes("contention") ||
      errorMessage.includes("aborted") ||
      error.code === 10 || // Firestore ABORTED error code
      error.code === "ABORTED";

    if (isTransactionLock && retryAttempt < maxRetries) {
      // Calculate exponential backoff with jitter
      const baseDelay = 50;
      const maxDelay = 2000;
      const exponentialDelay = Math.min(baseDelay * Math.pow(2, retryAttempt), maxDelay);
      const jitter = exponentialDelay * Math.random() * 0.5;
      const totalDelay = Math.round(exponentialDelay + jitter);

      logger.warn(`Transaction lock detected for batch ${batchId} bulk update, retrying in ${totalDelay}ms (attempt ${retryAttempt + 1}/${maxRetries})`);

      // Wait before retrying to reduce contention
      await new Promise((resolve) => setTimeout(resolve, totalDelay));

      return batchUpdateStatusBulk({
        ...params,
        retryAttempt: retryAttempt + 1,
      });
    }

    logger.error(`Failed to bulk update batch ${batchId} status: ${error.message}`);
    throw error;
  }
}


export {
  queueAddEntries,
  queueGetEntries,
  queueUpdateEntries,
  queueDeleteEntries,
  queueNuke,
  queueSetItemsToProcessing,
  queueSetItemsToComplete,
  queueSetItemsToError,
  queueClaimPendingItems,
  stabilityQueueToUnique,
  dalleQueueToUnique,
  graphQueueToUnique,
  aiQueueToUnique,
  modalQueueToUnique,
  transcriptionQueueToUnique,
  batchCreate,
  batchGetStatus,
  batchUpdateStatusBulk,
};
