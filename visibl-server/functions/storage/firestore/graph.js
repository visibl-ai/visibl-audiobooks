/* eslint-disable camelcase */
/* eslint-disable require-jsdoc */
import {
  getFirestore,
  FieldValue,
} from "firebase-admin/firestore";
// import {removeUndefinedProperties} from "../firestore.js";
import logger from "../../util/logger.js";
import {catalogueGetRtdb, catalogueUpdateRtdb} from "../realtimeDb/catalogue.js";


// A graph will have a unique id.
// It will reference a specific  SKU
// It will be created by a createdBy: uid
// It will then have a path in storage /Graphs/${graphId}/specificGraph.json
// The final output of the graph is the scenes.json file.
// And the final step of graph creation is to make the default scene
// With all the images from that default scene. All styles are a derivative of that scene

function generateGraphId({sku, graphVersion}) {
  const now = new Date();
  const dateText = now.toISOString()
      .replace(/[-:T.]/g, "")
      .slice(0, 12); // YYYYMMDDHHMM
  // Replace dots in version with underscores for RTDB compatibility
  const sanitizedVersion = graphVersion.replace(/\./g, "_");
  const graphId = `${sku}-${sanitizedVersion}-${dateText}`;
  return graphId;
}

async function createGraph({uid, sku, numChapters, visibility, fullTextTokens, version = "v0.2", startStep, isCatalogueDefault = false}) {
  if (!uid || !sku) {
    throw new Error("createGraph: Missing parameters");
  }
  logger.debug(`createGraph: Creating graph for uid: ${uid}, sku: ${sku}, numChapters: ${numChapters}, visibility: ${visibility}, version: ${version}, isCatalogueDefault: ${isCatalogueDefault}`);
  const db = getFirestore();

  // Generate the custom graph ID
  const graphId = generateGraphId({sku, graphVersion: version});

  const newGraph = {
    uid,
    sku,
    createdAt: new Date(),
    updatedAt: new Date(),
    visibility,
    numChapters,
    fullTextTokens,
    version,
    processingChapters: [],
    seed: Math.floor(Math.random() * 2 ** 32), // Initialize seed for consistent image generation
  };
  if (startStep) {
    newGraph.startStep = startStep;
  }

  // Use the generated ID when creating the document
  const docRef = db.collection("Graphs").doc(graphId);
  await docRef.set(newGraph);
  const graphData = {
    id: graphId,
    ...newGraph,
  };

  // If this should be the default graph for the catalogue, update the RTDB
  if (isCatalogueDefault) {
    logger.debug(`Setting graph ${graphData.id} as default for catalogue ${sku}`);
    const catalogueItem = await catalogueGetRtdb({id: sku});
    if (catalogueItem) {
      catalogueItem.defaultGraphId = graphData.id;
      await catalogueUpdateRtdb({id: sku, body: catalogueItem});
      logger.debug(`Updated catalogue ${sku} with defaultGraphId: ${graphData.id}`);
    } else {
      logger.warn(`Catalogue item ${sku} not found in RTDB, cannot set defaultGraphId`);
    }
  }

  return graphData;
}

async function deleteGraph() {
  // const db = getFirestore();
}

async function getGraphFirestore({graphId, sku}) {
  if (!sku && !graphId) {
    throw new Error("sku or graphId is required");
  }
  const db = getFirestore();
  if (graphId) {
    const graphRef = db.collection("Graphs").doc(graphId);
    const graph = await graphRef.get();
    return {
      id: graph.id,
      ...graph.data(),
    };
  } else if (sku) {
    const graphs = await db.collection("Graphs")
        .where("sku", "==", sku)
        .get();
    return graphs.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));
  }
}

function updateGraphStatus({graphItem, statusName, statusValue, nextGraphStep}) {
  if (!graphItem) {
    throw new Error("Graph does not exist");
  }
  if (!graphItem.progress) {
    graphItem.progress = {};
  }
  graphItem.progress[statusName] = statusValue;
  graphItem.nextGraphStep = nextGraphStep;
  return graphItem;
}

async function updateGraph({graphData}) {
  const db = getFirestore();
  const graphRef = db.collection("Graphs").doc(graphData.id);
  await graphRef.update(graphData);
}

/**
 * Normalize a chapter identifier to a number. HTTP request bodies (e.g. v1continueGraph) may carry
 * chapters as strings (e.g. "5"), while the pipeline works with numbers.
 * @param {number|string} chapter - Chapter index
 * @return {number} Numeric chapter index
 */
function normalizeChapter(chapter) {
  return Number(chapter);
}

function graphDocRef({graphId}) {
  return getFirestore().collection("Graphs").doc(graphId);
}

/**
 * Atomically add a chapter to the graph's processingChapters.
 * @param {Object} params
 * @param {string} params.graphId - Graph ID
 * @param {number|string} params.chapter - Chapter index
 * @return {Promise<void>}
 */
async function graphMarkChapterProcessing({graphId, chapter}) {
  const chapterNumber = normalizeChapter(chapter);
  await graphDocRef({graphId}).update({
    processingChapters: FieldValue.arrayUnion(chapterNumber),
  });
}

/**
 * Atomically mark a chapter complete: add it to completedChapters, remove it (numeric and string
 * forms) from processingChapters, and clear any failedChapters entry for it.
 * @param {Object} params
 * @param {string} params.graphId - Graph ID
 * @param {number|string} params.chapter - Chapter index
 * @return {Promise<void>}
 */
async function graphMarkChapterComplete({graphId, chapter}) {
  const chapterNumber = normalizeChapter(chapter);
  await graphDocRef({graphId}).update({
    completedChapters: FieldValue.arrayUnion(chapterNumber),
    processingChapters: FieldValue.arrayRemove(chapterNumber, String(chapterNumber)),
    [`failedChapters.${chapterNumber}`]: FieldValue.delete(),
  });
}

/**
 * Release a terminally failed chapter in one atomic update: remove it (numeric and string forms)
 * from processingChapters and record the failure under failedChapters.<n>, incrementing attempts.
 * @param {Object} params
 * @param {string} params.graphId - Graph ID
 * @param {number|string} params.chapter - Chapter index
 * @param {string} params.step - Pipeline step that failed
 * @param {string} params.error - Error message
 * @param {string|null} params.queueId - Queue entry ID of the failed step, if any
 * @param {number|null} params.retryCount - Queue retry count at failure, if any
 * @param {string} params.releasedBy - Who released the chapter (graphQueue, graphCheckup, admin)
 * @return {Promise<{attempts: number}|null>} Failure attempts after release, or null if the graph
 *   doc does not exist
 */
async function graphReleaseChapter({graphId, chapter, step, error, queueId = null, retryCount = null, releasedBy}) {
  const chapterNumber = normalizeChapter(chapter);
  const ref = graphDocRef({graphId});
  const snapshot = await ref.get();
  if (!snapshot.exists) {
    return null;
  }
  const failurePath = `failedChapters.${chapterNumber}`;
  await ref.update({
    "processingChapters": FieldValue.arrayRemove(chapterNumber, String(chapterNumber)),
    [`${failurePath}.chapter`]: chapterNumber,
    [`${failurePath}.step`]: step ?? null,
    [`${failurePath}.error`]: error ?? null,
    [`${failurePath}.queueId`]: queueId ?? null,
    [`${failurePath}.retryCount`]: retryCount ?? null,
    [`${failurePath}.failedAt`]: Date.now(),
    [`${failurePath}.releasedBy`]: releasedBy ?? null,
    [`${failurePath}.attempts`]: FieldValue.increment(1),
  });
  const updated = await ref.get();
  const attempts = updated.data()?.failedChapters?.[chapterNumber]?.attempts || 0;
  return {attempts};
}

/**
 * Reset the failure attempt counter of a chapter (used by manual retries). No-op if the graph or
 * the chapter's failedChapters entry does not exist.
 * @param {Object} params
 * @param {string} params.graphId - Graph ID
 * @param {number|string} params.chapter - Chapter index
 * @return {Promise<boolean>} True when an existing entry was reset
 */
async function graphResetChapterFailureAttempts({graphId, chapter}) {
  const chapterNumber = normalizeChapter(chapter);
  const ref = graphDocRef({graphId});
  const snapshot = await ref.get();
  if (!snapshot.exists || !snapshot.data()?.failedChapters?.[chapterNumber]) {
    return false;
  }
  await ref.update({[`failedChapters.${chapterNumber}.attempts`]: 0});
  return true;
}

/**
 * Get all graphs, projected to the given fields to keep reads small.
 * @param {Object} params
 * @param {Array<string>} params.fields - Fields to return (the doc id is always included as id)
 * @return {Promise<Array<Object>>} Graphs as {id, ...fields}
 */
async function getAllGraphsFirestore({fields = []} = {}) {
  const snapshot = await getFirestore().collection("Graphs").select(...fields).get();
  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  }));
}

export {
  normalizeChapter,
  graphMarkChapterProcessing,
  graphMarkChapterComplete,
  graphReleaseChapter,
  graphResetChapterFailureAttempts,
  getAllGraphsFirestore,
  createGraph,
  deleteGraph,
  getGraphFirestore,
  updateGraphStatus,
  updateGraph,
};
