/* eslint-disable no-unused-vars */
/* eslint-disable require-jsdoc */
import GraphPipelineBase from "../GraphPipelineBase.js";

import {
  graphCharactersByChapter,
  graphCharacterPropertiesByChapter,
  generateCharacterImagePrompts,
  generateCharacterImages,
  generateCharacterProfileImages,
  graphLocationsByChapter,
  graphLocationPropertiesByChapter,
  generateLocationImagePrompts,
  generateLocationImages,
  summarizeCharacterImagePrompts,
  summarizeLocationImagePrompts,
  updateSceneCache,
  getFirstChapterOver5Minutes,
  correctTranscriptionsByChapter,
} from "./graphV0_1logic.js";

import {
  composeSceneImages,
} from "./logic/composeSceneImages.js";

import {
  augmentScenePrompts,
} from "./logic/augmentScenePrompts.js";

import {
  graphEntityContinuityByChapter,
} from "./logic/entityContinuity.js";

import {
  graphConsolidatePropertiesByChapter,
} from "./logic/propertyConsolidation.js";

import {
  graphScenes,
} from "./logic/graphScenes.js";

import logger from "../../util/logger.js";
import {getTranscriptions} from "../../storage/storage.js";
import {catalogueUpdateRtdbProperty} from "../../storage/realtimeDb/catalogue.js";
import {catalogueGetRtdb} from "../../storage/realtimeDb/catalogue.js";

/**
 * Version 0.1 implementation of the graph pipeline
 * This is the v0.1 pipeline implementation
 */
// eslint-disable-next-line camelcase
export default class GraphPipelineV0_1 extends GraphPipelineBase {
  constructor() {
    super();
    this.pipelineSteps = {
      CORRECT_TRANSCRIPTIONS: "correctTranscriptions",
      // Parallel entity processing steps
      ENTITIES_BY_CHAPTER: "entitiesByChapter",
      ENTITY_PROPERTIES: "entityProperties",
      ENTITY_CONTINUITY: "entityContinuity",
      CONSOLIDATE_ENTITY_PROPERTIES: "consolidateEntityProperties",
      GENERATE_ENTITY_IMAGE_PROMPTS: "generateEntityImagePrompts",
      SUMMARIZE_ENTITY_IMAGE_PROMPTS: "summarizeEntityImagePrompts",
      // Scene generation
      GENERATE_SCENES: "generateScenes",
      AUGMENT_SCENE_PROMPTS: "augmentScenePrompts",
      UPDATE_SCENE_CACHE: "updateSceneCache",
      // Image generation steps (sequential)
      GENERATE_CHARACTER_IMAGES: "generateCharacterImages",
      GENERATE_CHARACTER_PROFILE_IMAGES: "generateCharacterProfileImages",
      GENERATE_LOCATION_IMAGES: "generateLocationImages",
      // Generate origin Scene and load into RTDB
      // generate images for first X scenes in origin...
    };
    Object.freeze(this.pipelineSteps);
  }

  getVersion() {
    return "v0.1";
  }

  getPipelineSteps() {
    return this.pipelineSteps;
  }

  getFirstStep() {
    return this.pipelineSteps.CORRECT_TRANSCRIPTIONS;
  }

  getNextStep(currentStep) {
    const steps = this.pipelineSteps;
    const stepSequence = [
      steps.CORRECT_TRANSCRIPTIONS,
      steps.ENTITIES_BY_CHAPTER,
      steps.ENTITY_PROPERTIES,
      steps.ENTITY_CONTINUITY,
      steps.CONSOLIDATE_ENTITY_PROPERTIES,
      steps.GENERATE_ENTITY_IMAGE_PROMPTS,
      steps.SUMMARIZE_ENTITY_IMAGE_PROMPTS,
      steps.GENERATE_SCENES,
      steps.AUGMENT_SCENE_PROMPTS,
      steps.UPDATE_SCENE_CACHE,
      steps.GENERATE_CHARACTER_IMAGES,
      steps.GENERATE_CHARACTER_PROFILE_IMAGES,
      steps.GENERATE_LOCATION_IMAGES,
    ];

    const currentIndex = stepSequence.indexOf(currentStep);
    if (currentIndex === -1 || currentIndex === stepSequence.length - 1) {
      return null;
    }
    return stepSequence[currentIndex + 1];
  }

  async executePipelineStep(entryType, graphItem) {
    const steps = this.pipelineSteps;
    // let defaultScene;

    // Set endChapter to first chapter > 5 minutes if not already set
    if (graphItem.endChapter === undefined) {
      // Load transcriptions to calculate chapter lengths
      const transcriptions = await getTranscriptions({
        uid: graphItem.uid,
        sku: graphItem.sku,
        visibility: graphItem.visibility,
      });

      const firstLongChapter = getFirstChapterOver5Minutes(transcriptions);

      // Use the first chapter > 5 minutes, or fall back to numChapters
      graphItem.endChapter = firstLongChapter !== null ? firstLongChapter : graphItem.numChapters;

      logger.info(`${graphItem.id} Set endChapter to ${graphItem.endChapter} for graph ${graphItem.sku}`);
    }

    switch (entryType) {
      case steps.CORRECT_TRANSCRIPTIONS: {
        logger.debug(`${graphItem.id} Correcting Transcriptions for ${JSON.stringify(graphItem)}`);
        if (graphItem.chapter === undefined) {
          // first run.
          graphItem.chapter = 0;
        }
        await correctTranscriptionsByChapter({
          uid: graphItem.uid,
          sku: graphItem.sku,
          chapter: graphItem.chapter,
        });
        await this.updateGraphAndQueueNext({
          graphItem,
          currentStep: steps.CORRECT_TRANSCRIPTIONS,
          nextStep: steps.ENTITIES_BY_CHAPTER,
        });
        break;
      }
      case steps.ENTITIES_BY_CHAPTER: {
        logger.debug(`${graphItem.id} Generating Entities (Characters & Locations) by Chapter for ${graphItem.sku} chapter ${graphItem.chapter}`);
        // Run both character and location extraction in parallel
        await Promise.all([
          graphCharactersByChapter({
            uid: graphItem.uid,
            sku: graphItem.sku,
            visibility: graphItem.visibility,
            graphId: graphItem.id,
            chapter: graphItem.chapter,
          }),
          graphLocationsByChapter({
            uid: graphItem.uid,
            sku: graphItem.sku,
            visibility: graphItem.visibility,
            graphId: graphItem.id,
            chapter: graphItem.chapter,
          }),
        ]);
        await this.updateGraphAndQueueNext({
          graphItem,
          currentStep: steps.ENTITIES_BY_CHAPTER,
          nextStep: steps.ENTITY_PROPERTIES,
        });
        break;
      }

      case steps.ENTITY_PROPERTIES:
        logger.debug(`${graphItem.id} Extracting Entity Properties (Characters & Locations) for chapter ${graphItem.chapter} of ${graphItem.sku}`);
        if (graphItem.chapter === undefined) {
          // first run.
          graphItem.chapter = 0;
        }
        // Run both property extraction in parallel
        await Promise.all([
          graphCharacterPropertiesByChapter({
            uid: graphItem.uid,
            sku: graphItem.sku,
            visibility: graphItem.visibility,
            graphId: graphItem.id,
            chapter: graphItem.chapter,
          }),
          graphLocationPropertiesByChapter({
            uid: graphItem.uid,
            sku: graphItem.sku,
            visibility: graphItem.visibility,
            graphId: graphItem.id,
            chapter: graphItem.chapter,
          }),
        ]);
        // can we kill the other thread when one of them throws?
        await this.updateGraphAndQueueNext({
          graphItem,
          currentStep: steps.ENTITY_PROPERTIES,
          nextStep: steps.ENTITY_CONTINUITY,
        });
        break;

      case steps.ENTITY_CONTINUITY:
        logger.debug(`${graphItem.id} Processing Entity Continuity for chapter ${graphItem.chapter} of ${graphItem.sku}`);
        if (graphItem.chapter === undefined) {
          // first run.
          graphItem.chapter = 0;
        }
        await graphEntityContinuityByChapter({
          uid: graphItem.uid,
          sku: graphItem.sku,
          visibility: graphItem.visibility,
          graphId: graphItem.id,
          chapter: graphItem.chapter,
        });
        await this.updateGraphAndQueueNext({
          graphItem,
          currentStep: steps.ENTITY_CONTINUITY,
          nextStep: steps.CONSOLIDATE_ENTITY_PROPERTIES,
        });
        break;

      case steps.CONSOLIDATE_ENTITY_PROPERTIES:
        logger.debug(`${graphItem.id} Consolidating Entity Properties for chapter ${graphItem.chapter} of ${graphItem.sku}`);
        if (graphItem.chapter === undefined) {
          // first run.
          graphItem.chapter = 0;
        }
        await graphConsolidatePropertiesByChapter({
          uid: graphItem.uid,
          sku: graphItem.sku,
          visibility: graphItem.visibility,
          graphId: graphItem.id,
          chapter: graphItem.chapter,
        });
        await this.updateGraphAndQueueNext({
          graphItem,
          currentStep: steps.CONSOLIDATE_ENTITY_PROPERTIES,
          nextStep: steps.GENERATE_ENTITY_IMAGE_PROMPTS,
        });
        break;

      case steps.GENERATE_ENTITY_IMAGE_PROMPTS:
        logger.debug(`${graphItem.id} Generating Entity Image Prompts (Characters & Locations) for chapter ${graphItem.chapter} of ${graphItem.sku}`);
        if (graphItem.chapter === undefined) {
          // first run.
          graphItem.chapter = 0;
        }
        // Run both image prompt generation in parallel
        await Promise.all([
          generateCharacterImagePrompts({
            uid: graphItem.uid,
            sku: graphItem.sku,
            visibility: graphItem.visibility,
            graphId: graphItem.id,
            chapter: graphItem.chapter,
          }),
          generateLocationImagePrompts({
            uid: graphItem.uid,
            sku: graphItem.sku,
            visibility: graphItem.visibility,
            graphId: graphItem.id,
            chapter: graphItem.chapter,
          }),
        ]);
        await this.updateGraphAndQueueNext({
          graphItem,
          currentStep: steps.GENERATE_ENTITY_IMAGE_PROMPTS,
          nextStep: steps.SUMMARIZE_ENTITY_IMAGE_PROMPTS,
        });
        break;

      case steps.SUMMARIZE_ENTITY_IMAGE_PROMPTS:
        logger.debug(`${graphItem.id} Summarizing Entity Image Prompts (Characters & Locations) for chapter ${graphItem.chapter} of ${graphItem.sku}`);
        if (graphItem.chapter === undefined) {
          // first run.
          graphItem.chapter = 0;
        }
        // Run both summarization in parallel
        await Promise.all([
          summarizeCharacterImagePrompts({
            uid: graphItem.uid,
            sku: graphItem.sku,
            visibility: graphItem.visibility,
            graphId: graphItem.id,
            chapter: graphItem.chapter,
          }),
          summarizeLocationImagePrompts({
            uid: graphItem.uid,
            sku: graphItem.sku,
            visibility: graphItem.visibility,
            graphId: graphItem.id,
            chapter: graphItem.chapter,
          }),
        ]);
        await this.updateGraphAndQueueNext({
          graphItem,
          currentStep: steps.SUMMARIZE_ENTITY_IMAGE_PROMPTS,
          nextStep: steps.GENERATE_SCENES,
        });
        break;

      case steps.GENERATE_SCENES:
        logger.debug(`${graphItem.id} Generating Scenes for chapter ${graphItem.chapter} of ${graphItem.sku}`);
        if (graphItem.chapter === undefined) {
          // first run.
          graphItem.chapter = 0;
        }
        await graphScenes({
          uid: graphItem.uid,
          sku: graphItem.sku,
          visibility: graphItem.visibility,
          graphId: graphItem.id,
          chapter: graphItem.chapter,
        });
        await this.updateGraphAndQueueNext({
          graphItem,
          currentStep: steps.GENERATE_SCENES,
          nextStep: steps.AUGMENT_SCENE_PROMPTS,
        });
        break;

      case steps.AUGMENT_SCENE_PROMPTS:
        logger.debug(`${graphItem.id} Augmenting Scene Prompts for chapter ${graphItem.chapter} of ${graphItem.sku}`);
        if (graphItem.chapter === undefined) {
          // first run.
          graphItem.chapter = 0;
        }
        await augmentScenePrompts({
          uid: graphItem.uid,
          sku: graphItem.sku,
          visibility: graphItem.visibility,
          graphId: graphItem.id,
          chapter: graphItem.chapter,
        });
        await this.updateGraphAndQueueNext({
          graphItem,
          currentStep: steps.AUGMENT_SCENE_PROMPTS,
          nextStep: steps.UPDATE_SCENE_CACHE,
        });
        break;

      case steps.UPDATE_SCENE_CACHE: {
        // Initialize chapter if not set (e.g., in retry scenarios)
        if (graphItem.chapter === undefined) {
          graphItem.chapter = 0;
        }

        logger.debug(`${graphItem.id} Updating Scene Cache for chapter ${graphItem.chapter} of ${graphItem.sku}`);

        const result = await updateSceneCache({
          uid: graphItem.uid,
          sku: graphItem.sku,
          visibility: graphItem.visibility,
          graphId: graphItem.id,
          chapter: graphItem.chapter,
          defaultSceneId: graphItem.defaultSceneId,
        });

        if (!graphItem.defaultSceneId) {
          graphItem.defaultSceneId = result.defaultSceneId;
        }

        // Set graphAvailable to true after scene cache is updated so client can start playing
        // Notify users of completion
        // Only when we are at the endChapter (first chapter over 5 minutes)
        if (graphItem.chapter === graphItem.endChapter) {
          const catalogueItem = await catalogueGetRtdb({sku: graphItem.sku});
          if (!catalogueItem.graphAvailable) {
            logger.debug(`${graphItem.id} Pipeline setting graphAvailable to true for ${graphItem.sku}`);
            await catalogueUpdateRtdbProperty({
              sku: graphItem.sku,
              property: "graphAvailable",
              value: true,
            });
            await this.notifyUsersOfCompletion({graphItem});
          }
        }

        await this.updateGraphAndQueueNext({
          graphItem,
          currentStep: steps.UPDATE_SCENE_CACHE,
          nextStep: steps.GENERATE_CHARACTER_IMAGES,
        });
        break;
      }

      case steps.GENERATE_CHARACTER_IMAGES: {
        logger.debug(`${graphItem.id} Generating Character Images for chapter ${graphItem.chapter} of ${graphItem.sku}`);
        if (graphItem.chapter === undefined) {
          // first run.
          graphItem.chapter = 0;
        }
        await generateCharacterImages({
          uid: graphItem.uid,
          sku: graphItem.sku,
          visibility: graphItem.visibility,
          graphId: graphItem.id,
          chapter: graphItem.chapter,
        });

        await this.updateGraphAndQueueNext({
          graphItem,
          currentStep: steps.GENERATE_CHARACTER_IMAGES,
          nextStep: steps.GENERATE_CHARACTER_PROFILE_IMAGES,
        });
        break;
      }

      case steps.GENERATE_CHARACTER_PROFILE_IMAGES: {
        logger.debug(`${graphItem.id} Generating Character Profile Images for chapter ${graphItem.chapter} of ${graphItem.sku}`);
        if (graphItem.chapter === undefined) {
          // first run.
          graphItem.chapter = 0;
        }
        await generateCharacterProfileImages({
          uid: graphItem.uid,
          sku: graphItem.sku,
          visibility: graphItem.visibility,
          graphId: graphItem.id,
          chapter: graphItem.chapter,
        });

        await this.updateGraphAndQueueNext({
          graphItem,
          currentStep: steps.GENERATE_CHARACTER_PROFILE_IMAGES,
          nextStep: steps.GENERATE_LOCATION_IMAGES,
        });
        break;
      }

      case steps.GENERATE_LOCATION_IMAGES: {
        logger.debug(`${graphItem.id} Generating Location Images for chapter ${graphItem.chapter} of ${graphItem.sku}`);
        if (graphItem.chapter === undefined) {
          // first run.
          graphItem.chapter = 0;
        }
        await generateLocationImages({
          uid: graphItem.uid,
          sku: graphItem.sku,
          visibility: graphItem.visibility,
          graphId: graphItem.id,
          chapter: graphItem.chapter,
        });

        // Mark current chapter as completed
        const completedChapter = graphItem.chapter;
        if (!graphItem.completedChapters) {
          graphItem.completedChapters = [];
        }
        if (!graphItem.completedChapters.includes(completedChapter)) {
          graphItem.completedChapters.push(completedChapter);
          logger.info(`${graphItem.id} Marked chapter ${completedChapter} as completed for graph ${graphItem.sku}`);
        }

        // Remove from processing chapters
        if (graphItem.processingChapters) {
          const index = graphItem.processingChapters.indexOf(completedChapter);
          if (index > -1) {
            graphItem.processingChapters.splice(index, 1);
            logger.info(`${graphItem.id} Removed chapter ${completedChapter} from processing list for graph ${graphItem.sku}`);
          }
        }

        // This is the last step - decide whether to loop back or complete
        // Use endChapter which is now guaranteed to be set
        if (graphItem.chapter < graphItem.endChapter) {
          graphItem.chapter = graphItem.chapter + 1;

          await this.updateGraphAndQueueNext({
            graphItem,
            currentStep: steps.GENERATE_LOCATION_IMAGES,
            nextStep: this.getFirstStep(),
            statusValue: "pending",
          });
        } else {
          graphItem.chapter = 0;
          await this.updateGraphAndQueueNext({
            graphItem,
            currentStep: steps.GENERATE_LOCATION_IMAGES,
            nextStep: "complete",
          });
        }
        break;
      }


      case "complete": {
        // Pipeline is complete, nothing more to process
        logger.info(`${graphItem.id} Graph pipeline complete for graph ${graphItem.sku}`);
        // The base class will handle completion notifications
        break;
      }

      default:
        logger.error(`${graphItem.id} Unknown step: ${entryType}`);
        throw new Error(`${graphItem.id} Unknown pipeline step: ${entryType}`);
    }
  }

  /**
   * Compose scene images for specific scenes
   * @param {Object} params - Parameters for scene image composition
   * @param {string} params.graphId - The graph ID
   * @param {string} params.defaultSceneId - The scene ID for RTDB cache access
   * @param {Array<{chapter: number, scene: number}>} params.scenes - Array of scene identifiers, each object containing:
   *   - chapter: The chapter number (e.g., 0, 1, 2)
   *   - scene: The scene number within that chapter (e.g., 1, 2, 3)
   *   Example: [{chapter: 0, scene: 1}, {chapter: 0, scene: 2}, {chapter: 1, scene: 1}]
   * @return {Promise<Object>} Result of scene image composition
   */
  async composeSceneImages({graphId, defaultSceneId, scenes}) {
    return await composeSceneImages({graphId, defaultSceneId, scenes});
  }
}
