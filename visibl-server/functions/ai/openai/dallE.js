/* eslint-disable require-jsdoc */
import logger from "../../util/logger.js";
import OpenAI from "openai";
import {OPENAI_API_KEY, MOCK_IMAGES} from "../../config/config.js";
import {downloadImage} from "../../storage/storage.js";
import {
  queueGetEntries,
  queueSetItemsToProcessing,
  queueSetItemsToComplete,
} from "../../storage/firestore/queue.js";

import {
  saveImageResultsMultipleScenes,
  outpaintWithQueue,
} from "../imageGen.js";

import {
  storeGraphCharacterImagesRtdb,
  storeGraphLocationImagesRtdb,
} from "../../storage/realtimeDb/graph.js";

import {geminiRequest} from "../gemini/gemini.js";
import {
  queueAddEntries,
  dalleQueueToUnique,
} from "../../storage/firestore/queue.js";
import globalPrompts from "../prompts/globalPrompts.js";

const OPENAI_DALLE_3_IMAGES_PER_MINUTE = 175;

// Generate the seed images for scenes using Dall-E-3.
// Images are square, so they need to be outpainted to tall late
// Makes a batch request to singleGeneration
// Returns an array of image results.
// Alternate function for generating images for graph nodes.
async function dalle3(request) {
  try {
    const {
      scenes, sceneIds, retries = [],
    } = request;
    if (scenes.length > OPENAI_DALLE_3_IMAGES_PER_MINUTE) {
      throw new Error(`Maximum ${OPENAI_DALLE_3_IMAGES_PER_MINUTE} scenes per request`);
    }
    if (sceneIds === undefined) {
      throw new Error("dalle3: sceneId is required");
    }
    logger.debug("scenes.length = " + scenes.length);
    logger.info("scenes = " + JSON.stringify(scenes).substring(0, 100));
    if (!scenes) {
      throw new Error("No scenes found - use interpretChapter first.");
    }
    // Now we save the scenes to the chapter.
    logger.info("===Starting DALL-E-3 image generation===");

    const openai = new OpenAI(OPENAI_API_KEY.value());
    logger.debug(`scenes length = ${scenes.length}`);
    const promises = scenes.map(async (scene, i) => singleGeneration({
      scene, sceneId: sceneIds[i], retry: retries[i] || true, openai,
    }));
    const images = await Promise.all(promises);
    logger.info("===ENDING DALL-E-3 image generation===");
    return images;
  } catch (error) {
    logger.error(error);
    throw error;
  }
}

async function dalle3GraphNode(request) {
  const {graphId, nodeType, nodeName, retry} = request;
  const openai = new OpenAI(OPENAI_API_KEY.value());

  const imageResponse = await generateNodeImage({graphId, nodeType, nodeName, retry, openai});
  logger.debug(`dalle3GraphNode: ${JSON.stringify(imageResponse)}`);
  if (nodeType === "character") {
    logger.debug(`storing character image for ${nodeName} in graph ${graphId}`);
    await storeGraphCharacterImagesRtdb({graphId, characterImages: {[nodeName]: imageResponse.imageUrl}});
  } else if (nodeType === "location") {
    logger.debug(`storing location image for ${nodeName} in graph ${graphId}`);
    await storeGraphLocationImagesRtdb({graphId, locationImages: {[nodeName]: imageResponse.imageUrl}});
  }
}

// Generate a single image for a scene using Dall-E-3.
// Returns the image URL.
// Retrys a single time if there is an error on the first try.
async function singleGeneration(request) {
  const {
    scene, sceneId, retry, openai,
  } = request;
  let imageGenResult = false;
  const dallE3Config = {
    model: "dall-e-3",
    quality: "hd",
    size: "1024x1024",
    style: "vivid",
    n: 1,
    response_format: "url",
  };
  const sceneDescription = {
    "description": scene.description,
    "characters": scene.characters,
    "locations": scene.locations,
    "viewpoint": scene.viewpoint,
    // "aspect_ratio": "Vertical Aspect Ratio",
  };
  dallE3Config.prompt = JSON.stringify(sceneDescription);
  const descriptionLength = dallE3Config.prompt.length;
  logger.debug("image description = " + dallE3Config.prompt.substring(0, 250));
  let gcpURL = "";
  let squareImagePath;
  let outpaintResult;
  let imageResponse;
  let description = "";
  logger.debug(`sceneDescription is ${descriptionLength} chars`);
  try {
    if (descriptionLength > 4000) {
      logger.debug(`Scene description too long (${descriptionLength} chars), summarizing...`);
      const summarizedScene = await summarizeScene({sceneDescription, chars: descriptionLength});
      dallE3Config.prompt = JSON.stringify(summarizedScene);
      logger.debug(dallE3Config.prompt);
      logger.debug(`Summarized to ${dallE3Config.prompt.length} chars`);
      if (dallE3Config.prompt.length > 4000) {
        throw new Error(`sceneId: ${sceneId}, scene number: ${scene.scene_number}, chapter: ${scene.chapter}, scene description still too long after summarizing`);
      }
    }
    if (MOCK_IMAGES.value() === true) {
      imageResponse = {
        data: [{
          url: "https://visibl-public.s3.eu-west-2.amazonaws.com/dalle3-mock.png",
          revised_prompt: "This is a mock DALL-E revised prompt",
        }],
      };
    } else {
      imageResponse = await openai.images.generate(dallE3Config);
    }
    const imageUrl = imageResponse.data[0].url;
    logger.debug("imageUrl = " + imageUrl);// .substring(0, 100));
    // logger.debug(`imageResponse = ${JSON.stringify(imageResponse.data[0], null, 2)}`)
    description = imageResponse.data[0].revised_prompt;
    logger.debug(`revised prompt = ${description.substring(0, 150)}${description.length > 150 ? "..." : ""}`);
    // const imagePath = `${imageDir}/${i + 1}.jpg`;
    const timestamp = Date.now();
    const imagePath = `Scenes/${sceneId}/${scene.chapter}_scene${scene.scene_number}_${timestamp}`;
    squareImagePath = `${imagePath}.4.3.png`;
    // logger.debug("imageName = " + imageName);
    gcpURL = await downloadImage(imageUrl, squareImagePath);
    imageGenResult = true;
    // logger.debug(`Outpainting ${squareImagePath} with Stability.`);
    // outpaintResult = await outpaintTall({
    //   inputPath: squareImagePath,
    //   outputPathWithoutExtension: imagePath,
    // });
  } catch (error) {
    logger.error(`Error generating image: ${scene.scene_number} ${scene.chapter} ${sceneId} ${JSON.stringify(sceneDescription)} ${error.toString()}`);
    await handleDalle3Error({scene, sceneId, retry, error});
  }
  return {
    type: "image",
    result: imageGenResult,
    url: outpaintResult,
    square: gcpURL,
    squareBucketPath: squareImagePath,
    // tall: outpaintResult,
    description: description,
    scene_number: scene.scene_number,
    chapter: scene.chapter,
    sceneId: sceneId,
  };
}

async function handleDalle3Error(params) {
  let {scene, sceneId, retry, error} = params;
  if (retry) {
    retry = false;
    logger.warn(`Going to retry image generation for scene ${scene.scene_number} in chapter ${scene.chapter} for scene ${sceneId}`);
    logger.warn(`Error error: ${JSON.stringify(error)}`);
    if (error.message.includes("safety") || error.message.includes("filter") || error.type === "image_generation_user_error") {
      logger.warn(`Scene ${sceneId}Safety error, moderating scene description once.`);
      scene = await moderateSceneDescription({scene, sceneId});
      logger.warn(`Scene ${sceneId} moderated, adding item to dall-e queue`);
    } else {
      logger.warn(`Scene ${sceneId}Unkown error, lets retry once.`);
    }
    await addSceneToQueue({scene, sceneId, retry});
  } else {
    logger.warn(`Not retrying image generation for scene ${scene.scene_number} in chapter ${scene.chapter} for scene ${sceneId}, returning default object.`);
  }
}

async function moderateSceneDescription(params) {
  const {scene, sceneId} = params;
  const geminiResponse = await geminiRequest({
    prompt: "moderateScene",
    message: JSON.stringify(scene),
    replacements: [],
  });
  if (geminiResponse.result && geminiResponse.result.scene) {
    const moderatedScene = {
      ...scene,
      ...geminiResponse.result.scene,
    };
    return moderatedScene;
  } else {
    logger.error(`Failed to moderate scene description for scene ${scene.scene_number} in chapter ${scene.chapter} for scene ${sceneId}`);
    return scene;
  }
}

async function summarizeScene(params) {
  const {sceneDescription, chars} = params;
  const geminiResponse = await geminiRequest({
    prompt: "summarizeScene",
    message: JSON.stringify(sceneDescription),
    replacements: [
      {
        key: "SCENE_CHARS",
        value: chars,
      },
    ],
  });
  if (geminiResponse.result && geminiResponse.result.scene) {
    const summarizedScene = {
      ...sceneDescription,
      ...geminiResponse.result.scene,
    };
    return summarizedScene;
  } else {
    logger.error(`Failed to summarize scene.`);
    return sceneDescription;
  }
}

async function addSceneToQueue(params) {
  const {scene, sceneId, retry} = params;
  const types = ["dalle"];
  const entryTypes = ["dalle3"];
  const entryParams = [{scene, sceneId, retry}];
  const uniques = [dalleQueueToUnique({
    type: "dalle",
    entryType: "dalle3",
    sceneId,
    chapter: scene.chapter,
    scene_number: scene.scene_number,
    retry,
  })];
  await queueAddEntries({
    types,
    entryTypes,
    entryParams,
    uniques,
  });
}


function validateQueueEntry(queueEntry) {
  const missingEntries = [];
  if (queueEntry.nodeType) {
    if (!queueEntry.graphId) missingEntries.push("graphId");
    if (!queueEntry.nodeType) missingEntries.push("nodeType");
    if (!queueEntry.nodeName) missingEntries.push("nodeName");
  } else {
    if (!queueEntry.scene || !queueEntry.sceneId) {
      if (!queueEntry.scene) missingEntries.push("scene");
      if (!queueEntry.sceneId) missingEntries.push("sceneId");
    }
  }

  if (missingEntries.length > 0) {
    logger.warn(`dalleQueue: Missing mandatory params for queue item: ${missingEntries.join(", ")}`);
    return false;
  }
  return true;
}

// This function is the main entry point for the dalle queue.
// It will get the pending items from the queue, process them, and then update the queue.
// It will also handle the case where there are more items in the queue than can be processed in a single call.
// It will recursively call itself until all items are processed.
const dalleQueue = async () => {
  // 1. get pending items from the queue.
  let queue = await queueGetEntries({type: "dalle", status: "pending", limit: OPENAI_DALLE_3_IMAGES_PER_MINUTE});
  logger.debug(`dalleQueue: ${queue.length} items in the queue`);
  if (queue.length === 0) {
    logger.debug("dalleQueue: No items in the queue");
    return;
  }
  // 2. set those items to processing.
  await queueSetItemsToProcessing({queue});
  // 3. process the items.
  const scenes = [];
  const sceneIds = [];
  const retries = [];

  // Segregate the queue items into scenes and graph nodes.
  const scenesQueue = queue.filter((item) => !item.params.nodeType);
  const graphNodesQueue = queue.filter((item) => item.params.nodeType);
  logger.debug(`dalleQueue: ${scenesQueue.length} scenes, ${graphNodesQueue.length} graph nodes`);

  const startTime = Date.now();
  let endTime;
  // Process the scenes.
  if (scenesQueue.length > 0) {
    for (let i = 0; i < scenesQueue.length; i++) {
      if (!validateQueueEntry(scenesQueue[i].params)) {
        continue;
      }

      scenes.push(scenesQueue[i].params.scene);
      sceneIds.push(scenesQueue[i].params.sceneId);
      retries.push(scenesQueue[i].params.retry);
    }
    const results = await dalle3({scenes, sceneIds, retries});
    logger.debug(`dalleQueue results: ${JSON.stringify(results)}`);
    endTime = Date.now();
    // 4. save results as required
    await saveImageResultsMultipleScenes({results});

    await outpaintWithQueue({results, waitForCallback: true});
  }

  // Process the graph nodes.
  if (graphNodesQueue.length > 0) {
    for (let i = 0; i < graphNodesQueue.length; i++) {
      if (!validateQueueEntry(graphNodesQueue[i].params)) {
        continue;
      }

      await dalle3GraphNode(graphNodesQueue[i].params);
      endTime = Date.now();
    }
  }

  // 5. update items to completed.
  await queueSetItemsToComplete({queue});
  // 6. if there remaining items in the queue, initiate the next batch.
  queue = await queueGetEntries({type: "dalle", status: "pending", limit: OPENAI_DALLE_3_IMAGES_PER_MINUTE});
  if (queue.length > 0) {
    // Wait the apropriate amount of time due to the rate limit.
    let waitTime = 60000 - (endTime - startTime);
    // Don't slow down development.
    if (process.env.ENVIRONMENT === "development") {
      waitTime = 0;
    }
    logger.debug(`DALL E: Waiting ${waitTime}ms due to rate limit`);
    await new Promise((resolve) => setTimeout(resolve, waitTime));
    await dalleQueue();
  }
};

/**
 * Generate a single graph node (character/location) image using DALL-E 3
 * @param {Object} params - Parameters object
 * @param {string} params.nodeType - Type of node ('character' or 'location')
 * @param {string} params.nodeName - Name of the character or location
 * @param {string} params.description - Node description for image generation
 * @param {string} params.graphId - Graph ID for storage path
 * @param {OpenAI} params.openai - OpenAI client instance
 * @return {Promise<Object>} Image generation result
 */
async function generateNodeImage({nodeType, nodeName, description, graphId, openai}) {
  if (!["character", "location"].includes(nodeType)) {
    throw new Error(`Invalid node type: ${nodeType}. Must be either "character" or "location"`);
  }

  // Get configuration from global prompts
  const promptConfig = globalPrompts[`generate${nodeType.charAt(0).toUpperCase() + nodeType.slice(1)}Image`];
  const dallE3Config = {...promptConfig.dalleConfig};

  // Create a focused prompt using global prompt template
  const prompt = promptConfig.systemInstruction
      .replace(nodeType === "character" ? "%DESCRIPTION%" : "%LOCATION_NAME%", nodeType === "character" ? description : nodeName)
      .replace(nodeType === "location" ? "%DESCRIPTION%" : "", nodeType === "location" ? description : "");

  dallE3Config.prompt = prompt;

  logger.debug(`Generating image for ${nodeType}: ${nodeName}`);
  logger.debug(`Prompt: ${prompt.substring(0, 200)}...`);

  try {
    let imageResponse;

    if (MOCK_IMAGES.value() === true) {
      imageResponse = {
        data: [{
          url: "https://visibl-public.s3.eu-west-2.amazonaws.com/dalle3-mock.png",
          revised_prompt: `Mock DALL-E revised prompt for ${nodeType} ${nodeName}`,
        }],
      };
    } else {
      imageResponse = await openai.images.generate(dallE3Config);
    }

    const imageUrl = imageResponse.data[0].url;
    const revisedPrompt = imageResponse.data[0].revised_prompt;

    // Create storage path for the image
    const timestamp = Date.now();
    const imagePath = `Graphs/${graphId}/${nodeType}s/${nodeName.toLowerCase().replace(/\s+/g, "_")}_${timestamp}.png`;

    // Download and store the image
    const gcpURL = await downloadImage(imageUrl, imagePath);

    logger.debug(`${nodeType} image generated and stored: ${nodeName} -> ${gcpURL}`);

    return {
      nodeType,
      nodeName,
      imageUrl: gcpURL,
      bucketPath: imagePath,
      originalUrl: imageUrl,
      revisedPrompt,
      success: true,
    };
  } catch (error) {
    logger.error(`Error generating image for ${nodeType} ${nodeName}: ${error.message}`);
    return {
      nodeType,
      nodeName,
      success: false,
      error: error.message,
    };
  }
}

export {
  dalle3,
  dalle3GraphNode,
  dalleQueue,
  singleGeneration,
  generateNodeImage,
};
