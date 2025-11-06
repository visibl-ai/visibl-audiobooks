/* eslint-disable require-jsdoc */
import logger from "../../util/logger.js";
import {getGraph} from "../../storage/storage.js";
import {
  getGraphCharactersRtdb,
  getGraphLocationsRtdb,
  storeGraphCharacterImagesRtdb,
  storeGraphLocationImagesRtdb,
} from "../../storage/realtimeDb/graph.js";
import {queueAddEntries, dalleQueueToUnique} from "../../storage/firestore/queue.js";
import {dispatchTask} from "../../util/dispatch.js";

/**
 * Generate images for graph nodes (characters or locations) using a queue system
 * @param {Object} params - Parameters object
 * @param {string} params.graphId - The graph ID
 * @param {string} params.nodeType - Type of node ('character' or 'location')
 * @param {string} [params.uid] - User ID (optional, for filtering locations by scenes)
 * @param {string} [params.sku] - SKU (optional, for filtering locations by scenes)
 * @param {string} [params.visibility] - Visibility (optional, for filtering locations by scenes)
 * @return {Promise<Object>} Results of node image generation
 */
async function generateGraphNodeImagesWithQueue({graphId, nodeType, uid, sku, visibility}) {
  if (!graphId) {
    throw new Error("graphId is required");
  }
  if (!["character", "location"].includes(nodeType)) {
    throw new Error(`Invalid node type: ${nodeType}. Must be either "character" or "location"`);
  }

  logger.debug(`Generating ${nodeType} images for graph ${graphId}`);

  // Get nodes from RTDB
  const getRtdbFn = nodeType === "character" ? getGraphCharactersRtdb : getGraphLocationsRtdb;
  const nodes = await getRtdbFn({graphId});

  if (!nodes) {
    throw new Error(`No ${nodeType}s found for graph ${graphId}`);
  }

  // For locations, try to get scenes to filter locations that actually appear in scenes
  let nodesInScenes = new Set();
  let skippedNodes = 0;
  if (nodeType === "location" && uid && sku && visibility) {
    try {
      const scenes = await getGraph({uid, sku, visibility, type: "scenes", graphId});

      // Extract all unique locations from all scenes
      for (const chapterScenes of Object.values(scenes)) {
        for (const scene of chapterScenes) {
          if (scene.locations) {
            if (Array.isArray(scene.locations)) {
              scene.locations.forEach((location) => nodesInScenes.add(location.toLowerCase()));
            } else if (typeof scene.locations === "object") {
              Object.keys(scene.locations).forEach((location) => nodesInScenes.add(location.toLowerCase()));
            }
          }
        }
      }
      logger.debug(`Found ${nodesInScenes.size} unique locations in scenes: ${Array.from(nodesInScenes).join(", ")}`);
    } catch (error) {
      logger.warn(`Could not get scenes for filtering locations: ${error.message}. Generating images for all locations.`);
      nodesInScenes = new Set(); // Reset to empty to skip filtering
    }
  }

  const results = [];
  const nodeImages = {};

  // Generate images for each node
  for (const [nodeName, nodeData] of Object.entries(nodes)) {
    // For locations, skip if not in scenes (when we have scene data)
    if (nodeType === "location" && nodesInScenes.size > 0 && !nodesInScenes.has(nodeName.toLowerCase())) {
      logger.debug(`Skipping image generation for location "${nodeName}" - not found in any scenes`);
      skippedNodes++;
      continue;
    }

    // Skip if node already has an image
    if (nodeData.image) {
      logger.debug(`${nodeType} ${nodeName} already has an image, skipping`);
      nodeImages[nodeName] = nodeData.image;
      continue;
    }

    // Skip if node has no description
    if (!nodeData.description) {
      logger.warn(`${nodeType} ${nodeName} has no description, skipping image generation`);
      continue;
    }

    // Queue the image generation request
    const types = ["dalle"];
    const entryTypes = ["dalle3"];
    const entryParams = [{
      graphId,
      nodeType,
      nodeName,
      description: nodeData.description,
    }];
    const uniques = [dalleQueueToUnique({
      type: "dalle",
      entryType: "dalle3",
      graphId,
      nodeType,
      nodeName,
      retry: true,
    })];

    await queueAddEntries({
      types,
      entryTypes,
      entryParams,
      uniques,
    });

    await dispatchTask({
      functionName: "launchDalleQueue",
      data: {},
    });
  }

  // Store the images in RTDB
  if (Object.keys(nodeImages).length > 0) {
    const storeRtdbFn = nodeType === "character" ? storeGraphCharacterImagesRtdb : storeGraphLocationImagesRtdb;
    await storeRtdbFn({
      graphId,
      [nodeType === "character" ? "characterImages" : "locationImages"]: nodeImages,
    });
  }

  const logMessage = nodeType === "location" ?
    `Generated ${Object.keys(nodeImages).length} location images for graph ${graphId}. Skipped ${skippedNodes} locations not found in scenes.` :
    `Generated ${Object.keys(nodeImages).length} character images for graph ${graphId}`;
  logger.debug(logMessage);

  return {
    graphId,
    type: `${nodeType}s`,
    [`total${nodeType.charAt(0).toUpperCase() + nodeType.slice(1)}s`]: Object.keys(nodes).length,
    ...(nodeType === "location" ? {
      locationsInScenes: nodesInScenes.size,
      skippedNodes,
    } : {}),
    successfulImages: Object.keys(nodeImages).length,
    results,
    [`${nodeType}Images`]: nodeImages,
  };
}

/**
 * Generate images for both characters and locations in a graph
 * @param {Object} params - Parameters object
 * @param {string} params.graphId - The graph ID
 * @param {string} params.uid - User ID (optional, for filtering locations by scenes)
 * @param {string} params.sku - SKU (optional, for filtering locations by scenes)
 * @param {string} params.visibility - Visibility (optional, for filtering locations by scenes)
 * @return {Promise<Object>} Results of all image generation
 */
async function generateGraphNodeImages({graphId, uid, sku, visibility}) {
  if (!graphId) {
    throw new Error("graphId is required");
  }

  logger.debug(`Generating all node images for graph ${graphId}`);

  await generateGraphNodeImagesWithQueue({graphId, nodeType: "character"});
  await generateGraphNodeImagesWithQueue({graphId, nodeType: "location", uid, sku, visibility});
}

export {
  generateGraphNodeImages,
};
