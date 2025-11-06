/* eslint-disable require-jsdoc */
import GraphPipelineBase from "../GraphPipelineBase.js";

import {
  catalogueUpdateRtdbProperty,
} from "../../storage/realtimeDb/catalogue.js";
import CatalogueProgressTracker from "../../storage/realtimeDb/CatalogueProgressTracker.js";

import {
  graphCharacters,
  graphLocations,
  graphCharacterDescriptionsOAI,
  graphCharacterDescriptions,
  graphLocationDescriptionsOAI,
  graphLocationDescriptions,
  graphSummarizeDescriptions,
  graphScenes,
  augmentScenesOAI,
} from "./graphV0logic.js";

import {
  generateGraphNodeImages,
} from "./graphImages.js";

import logger from "../../util/logger.js";

import {
  scenesCreateDefaultCatalogue,
} from "../../util/graphHelper.js";

const MAX_FULL_TEXT_TOKENS_FOR_OAI = 115000;

/**
 * Version 0 implementation of the graph pipeline
 * This is the original pipeline implementation
 */
export default class GraphPipelineV0 extends GraphPipelineBase {
  constructor() {
    super();
    this.pipelineSteps = {
      CHARACTERS: "characters",
      LOCATIONS: "locations",
      CHARACTER_DESCRIPTIONS: "characterDescriptions",
      LOCATION_DESCRIPTIONS: "locationDescriptions",
      SUMMARIZE_DESCRIPTIONS: "summarizeDescriptions",
      GENERATE_SCENES: "generateScenes",
      AUGMENT_SCENES_OAI: "augmentScenesOai",
      CREATE_DEFAULT_SCENE: "createDefaultScene",
      GENERATE_NODE_IMAGES: "generateNodeImages",
      GENERATE_IMAGES: "generateImages",
      NOTIFY: "notify",
    };
    Object.freeze(this.pipelineSteps);
  }

  getVersion() {
    return "v0";
  }

  getPipelineSteps() {
    return this.pipelineSteps;
  }

  getFirstStep() {
    return this.pipelineSteps.CHARACTERS;
  }

  getNextStep(currentStep) {
    const steps = this.pipelineSteps;
    const stepSequence = [
      steps.CHARACTERS,
      steps.LOCATIONS,
      steps.CHARACTER_DESCRIPTIONS,
      steps.LOCATION_DESCRIPTIONS,
      steps.SUMMARIZE_DESCRIPTIONS,
      steps.GENERATE_SCENES,
      steps.AUGMENT_SCENES_OAI,
      steps.CREATE_DEFAULT_SCENE,
      steps.GENERATE_NODE_IMAGES,
      steps.GENERATE_IMAGES,
      steps.NOTIFY,
    ];

    const currentIndex = stepSequence.indexOf(currentStep);
    if (currentIndex === -1 || currentIndex === stepSequence.length - 1) {
      return null;
    }
    return stepSequence[currentIndex + 1];
  }

  async executePipelineStep(entryType, graphItem) {
    const steps = this.pipelineSteps;
    let defaultScene;

    switch (entryType) {
      case steps.CHARACTERS:
        logger.debug(`graphQueue: Generating Characters for ${JSON.stringify(graphItem)}`);
        await graphCharacters({
          uid: graphItem.uid,
          sku: graphItem.sku,
          visibility: graphItem.visibility,
          graphId: graphItem.id,
        });
        await this.updateGraphAndQueueNext({
          graphItem,
          currentStep: steps.CHARACTERS,
          nextStep: steps.LOCATIONS,
        });
        break;

      case steps.LOCATIONS:
        logger.debug(`graphQueue: Generating Locations for ${JSON.stringify(graphItem)}`);
        await graphLocations({
          uid: graphItem.uid,
          sku: graphItem.sku,
          visibility: graphItem.visibility,
          graphId: graphItem.id,
        });
        await this.updateGraphAndQueueNext({
          graphItem,
          currentStep: steps.LOCATIONS,
          nextStep: steps.CHARACTER_DESCRIPTIONS,
        });
        break;

      case steps.CHARACTER_DESCRIPTIONS:
        logger.debug(`graphQueue: Generating Character Descriptions for ${JSON.stringify(graphItem)}`);
        if (graphItem.fullTextTokens > MAX_FULL_TEXT_TOKENS_FOR_OAI) {
          logger.debug(`graphQueue: Character Descriptions - full text has ${graphItem.fullTextTokens} tokens. Using Gemini.`);
          await graphCharacterDescriptions({
            uid: graphItem.uid,
            sku: graphItem.sku,
            visibility: graphItem.visibility,
            graphId: graphItem.id,
          });
        } else {
          logger.debug(`graphQueue: Character Descriptions - full text has ${graphItem.fullTextTokens} tokens. Using OAI.`);
          await graphCharacterDescriptionsOAI({
            uid: graphItem.uid,
            sku: graphItem.sku,
            visibility: graphItem.visibility,
            graphId: graphItem.id,
          });
        }
        await this.updateGraphAndQueueNext({
          graphItem,
          currentStep: steps.CHARACTER_DESCRIPTIONS,
          nextStep: steps.LOCATION_DESCRIPTIONS,
        });
        break;

      case steps.LOCATION_DESCRIPTIONS:
        logger.debug(`graphQueue: Generating Location Descriptions for ${JSON.stringify(graphItem)}`);
        if (graphItem.fullTextTokens > MAX_FULL_TEXT_TOKENS_FOR_OAI) {
          logger.debug(`graphQueue: Location Descriptions - full text has ${graphItem.fullTextTokens} tokens. Using Gemini.`);
          await graphLocationDescriptions({
            uid: graphItem.uid,
            sku: graphItem.sku,
            visibility: graphItem.visibility,
            graphId: graphItem.id,
          });
        } else {
          logger.debug(`graphQueue: Location Descriptions - full text has ${graphItem.fullTextTokens} tokens. Using OAI.`);
          await graphLocationDescriptionsOAI({
            uid: graphItem.uid,
            sku: graphItem.sku,
            visibility: graphItem.visibility,
            graphId: graphItem.id,
          });
        }
        await this.updateGraphAndQueueNext({
          graphItem,
          currentStep: steps.LOCATION_DESCRIPTIONS,
          nextStep: steps.SUMMARIZE_DESCRIPTIONS,
        });
        break;

      case steps.SUMMARIZE_DESCRIPTIONS:
        logger.debug(`graphQueue: Summarizing Descriptions for ${JSON.stringify(graphItem)}`);
        await graphSummarizeDescriptions({
          uid: graphItem.uid,
          sku: graphItem.sku,
          visibility: graphItem.visibility,
          graphId: graphItem.id,
        });
        graphItem.chapter = 0;
        await this.updateGraphAndQueueNext({
          graphItem,
          currentStep: steps.SUMMARIZE_DESCRIPTIONS,
          nextStep: steps.GENERATE_SCENES,
        });
        break;

      case steps.GENERATE_SCENES:
        logger.debug(`graphQueue: Generating Scenes for ${JSON.stringify(graphItem)}`);
        await graphScenes({
          uid: graphItem.uid,
          sku: graphItem.sku,
          visibility: graphItem.visibility,
          graphId: graphItem.id,
          chapter: graphItem.chapter,
        });
        if (graphItem.chapter < graphItem.numChapters) {
          graphItem.chapter = graphItem.chapter + 1;
          await this.updateGraphAndQueueNext({
            graphItem,
            currentStep: steps.GENERATE_SCENES,
            nextStep: steps.GENERATE_SCENES,
            statusValue: "pending",
          });
        } else {
          graphItem.chapter = 0;
          await this.updateGraphAndQueueNext({
            graphItem,
            currentStep: steps.GENERATE_SCENES,
            nextStep: steps.AUGMENT_SCENES_OAI,
          });
        }
        break;

      case steps.AUGMENT_SCENES_OAI:
        logger.debug(`graphQueue: Augmenting Scenes for ${JSON.stringify(graphItem)}`);
        await augmentScenesOAI({
          uid: graphItem.uid,
          sku: graphItem.sku,
          visibility: graphItem.visibility,
          graphId: graphItem.id,
          chapter: graphItem.chapter,
        });
        if (graphItem.chapter < graphItem.numChapters) {
          graphItem.chapter = graphItem.chapter + 1;
          await this.updateGraphAndQueueNext({
            graphItem,
            currentStep: steps.AUGMENT_SCENES_OAI,
            nextStep: steps.AUGMENT_SCENES_OAI,
            statusValue: "pending",
          });
        } else {
          await this.updateGraphAndQueueNext({
            graphItem,
            currentStep: steps.AUGMENT_SCENES_OAI,
            nextStep: steps.CREATE_DEFAULT_SCENE,
          });
        }
        break;

      case steps.CREATE_DEFAULT_SCENE:
        logger.debug(`graphQueue: Creating Default Scene for ${JSON.stringify(graphItem)}`);
        defaultScene = await scenesCreateDefaultCatalogue({
          id: graphItem.id,
          uid: graphItem.uid,
          sku: graphItem.sku,
          visibility: graphItem.visibility,
          graphId: graphItem.id,
        });
        graphItem.defaultSceneId = defaultScene.id;
        graphItem.chapter = 0;
        await catalogueUpdateRtdbProperty({
          sku: graphItem.sku,
          property: "defaultSceneId",
          value: defaultScene.id,
        });
        await this.updateGraphAndQueueNext({
          graphItem,
          currentStep: steps.CREATE_DEFAULT_SCENE,
          nextStep: steps.GENERATE_NODE_IMAGES,
        });
        break;

      case steps.GENERATE_NODE_IMAGES:
        logger.debug(`graphQueue: Generating Node Images for ${JSON.stringify(graphItem)}`);
        await generateGraphNodeImages({
          graphId: graphItem.id,
          uid: graphItem.uid,
          sku: graphItem.sku,
          visibility: graphItem.visibility,
        });
        await this.updateGraphAndQueueNext({
          graphItem,
          currentStep: steps.GENERATE_NODE_IMAGES,
          nextStep: steps.GENERATE_IMAGES,
        });
        break;

      case steps.GENERATE_IMAGES:
        logger.debug(`graphQueue: Generating Images for ${JSON.stringify(graphItem)}`);
        // TODO: Image Gen should really be in the queue system?
        for (let chapter = 0; chapter <= graphItem.numChapters; chapter++) {
          logger.debug(`Queuing up imageGenChapterRecursive for chapter ${chapter} of ${graphItem.numChapters}`);
          // We generate the first CHAPTER_SCENES_TO_INIT scenes of each chapter to get things started.
          // TODO: Removed imageGenChapterRecursive, so you need to update to imageGenCurrentTime.
        }
        await this.updateGraphAndQueueNext({
          graphItem,
          currentStep: steps.GENERATE_IMAGES,
          nextStep: steps.NOTIFY,
        });
        break;

      case steps.NOTIFY:
        // update the catalogue to reflect the graph is complete.
        logger.debug(`graphQueue: Pipeline complete for ${graphItem.id}, updating catalogue graphAvailable.`);
        await catalogueUpdateRtdbProperty({
          sku: graphItem.sku,
          property: "graphAvailable",
          value: true,
        });
        await CatalogueProgressTracker.updateProgress(graphItem.sku, {graphId: graphItem.id});
        logger.debug(`graphQueue: Pipeline complete for ${graphItem.id}, notifying users.`);
        await this.notifyUsersOfCompletion({graphItem});
        // Mark the graph as complete
        await this.updateGraphAndQueueNext({
          graphItem,
          currentStep: steps.NOTIFY,
          nextStep: "complete",
        });
        break;

      default:
        logger.error(`graphQueue: Unknown step: ${entryType}`);
        throw new Error(`Unknown pipeline step: ${entryType}`);
    }
  }

  /**
   * Compose scene images for specific scenes
   * V0 is deprecated and does not support this functionality
   * @param {Object} params - Parameters for scene image composition
   * @return {Promise<Object>} Result of scene image composition
   */
  async composeSceneImages(params) {
    throw new Error("GraphPipelineV0 is deprecated and does not support scene image composition. Please use v0.1 or later.");
  }
}
