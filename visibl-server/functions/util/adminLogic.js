import {catalogueUpdateRtdbProperty} from "../storage/realtimeDb/catalogue.js";
import {initGraphGeneration} from "../graph/graphPipeline.js";
import logger from "./logger.js";

/**
 * Reset catalogue item for graph generation and initiate the process
 * This function cleans up existing graph-related fields and sets initial state
 * before starting graph generation.
 *
 * @param {Object} params - Parameters for resetting and initiating graph generation
 * @param {string} params.sku - The SKU of the catalogue item
 * @param {string} params.uid - User ID initiating the generation
 * @param {boolean} params.replace - Whether to replace existing graph
 * @return {Promise<void>}
 */
async function resetCatalogueItemForGraphGeneration({sku, uid, replace = true}) {
  logger.info(`Resetting catalogue item ${sku} for graph generation`);

  // Reset catalogue graph fields
  await catalogueUpdateRtdbProperty({sku, property: "graphProgress", value: null});
  await catalogueUpdateRtdbProperty({sku, property: "defaultGraphId", value: null});
  await catalogueUpdateRtdbProperty({sku, property: "defaultSceneId", value: null});
  await catalogueUpdateRtdbProperty({sku, property: "styles", value: null});
  await catalogueUpdateRtdbProperty({sku, property: "graphAvailable", value: false});

  logger.info(`Catalogue item ${sku} reset complete. Initiating graph generation.`);

  // Initiate graph generation
  await initGraphGeneration({sku, uid, replace});
}

export {
  resetCatalogueItemForGraphGeneration,
};
