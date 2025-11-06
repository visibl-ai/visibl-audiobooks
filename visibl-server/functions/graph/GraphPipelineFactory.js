/* eslint-disable camelcase */
/* eslint-disable require-jsdoc */
import GraphPipelineV0 from "./v0/GraphPipelineV0.js";
import GraphPipelineV0_1 from "./v0.1/GraphPipelineV0_1.js";
import logger from "../util/logger.js";

/**
 * Factory class for creating graph pipeline instances based on version
 */
export default class GraphPipelineFactory {
  constructor() {
    // Static class, should not be instantiated
  }

  /**
   * Get a graph pipeline instance for the specified version
   * @param {string} version - The version of the pipeline to create (default: "v0.1")
   * @return {GraphPipelineBase} The pipeline instance
   */
  static getPipeline(version = "v0.1") {
    // Use singleton pattern to avoid creating multiple instances
    if (!GraphPipelineFactory.pipelineInstances) {
      GraphPipelineFactory.pipelineInstances = {};
    }
    if (!GraphPipelineFactory.pipelineInstances[version]) {
      switch (version) {
        case "v0":
          GraphPipelineFactory.pipelineInstances[version] = new GraphPipelineV0();
          break;
        case "v0.1":
          GraphPipelineFactory.pipelineInstances[version] = new GraphPipelineV0_1();
          break;
        // Future versions can be added here
        // case "v1":
        //   this.pipelineInstances[version] = new GraphPipelineV1();
        //   break;
        default:
          logger.warn(`Unknown graph pipeline version: ${version}, defaulting to v0.1`);
          GraphPipelineFactory.pipelineInstances[version] = new GraphPipelineV0_1();
      }
    }

    return GraphPipelineFactory.pipelineInstances[version];
  }

  /**
   * Get the appropriate pipeline for a graph item
   * @param {Object} graphItem - The graph item containing version information
   * @return {GraphPipelineBase} The pipeline instance
   */
  static getPipelineForGraph(graphItem) {
    const version = graphItem?.version || "v0.1";
    return this.getPipeline(version);
  }

  /**
   * Get list of available pipeline versions
   * @return {string[]} Array of available version strings
   */
  static getAvailableVersions() {
    return ["v0", "v0.1"]; // Add more versions as they become available
  }

  /**
   * Compose scene images for specific scenes
   * @param {string} version - The pipeline version to use (e.g., "v0.1")
   * @param {Object} params - Parameters for scene image composition
   * @param {string} params.graphId - The graph ID
   * @param {string} params.defaultSceneId - The scene ID for RTDB cache access
   * @param {Array<{chapter: number, scene: number}>} params.scenes - Array of scene identifiers, each object containing:
   *   - chapter: The chapter number (e.g., 0, 1, 2)
   *   - scene: The scene number within that chapter (e.g., 1, 2, 3)
   *   Example: [{chapter: 0, scene: 1}, {chapter: 0, scene: 2}, {chapter: 1, scene: 1}]
   * @param {string} params.sku - The SKU of the catalogue item
   * @return {Promise<Object>} Result of scene image composition
   */
  static async composeSceneImages(version, {graphId, defaultSceneId, scenes, sku}) {
    const pipeline = this.getPipeline(version);
    return await pipeline.composeSceneImages({graphId, defaultSceneId, scenes, sku});
  }
}
