/* eslint-disable camelcase */
/* eslint-disable require-jsdoc */
import {
  getFirestore} from "firebase-admin/firestore";
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

async function createGraph({uid, sku, numChapters, visibility, fullTextTokens, version = "v0.1", startStep, isCatalogueDefault = false}) {
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

export {
  createGraph,
  deleteGraph,
  getGraphFirestore,
  updateGraphStatus,
  updateGraph,
};
