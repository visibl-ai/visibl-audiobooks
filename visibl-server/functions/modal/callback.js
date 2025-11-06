import logger from "../util/logger.js";
import {queueGetEntries, queueSetItemsToComplete} from "../storage/firestore/queue.js";
import {saveImageResultsMultipleScenes} from "../ai/imageGen.js";
import {makeFilePublic} from "../storage/storage.js";
import {MODAL_CALLBACK_TOKEN} from "../config/config.js";
import {dispatchTask} from "../util/dispatch.js";

/**
 * Handle the Modal callback and dispatch the task to process the callback
 * @param {Object} req - The request object
 * @param {Object} res - The response object
 * @return {Promise<void>}
 */
async function handleModalCallback(req, res) {
  // Check for authentication token
  const authHeader = req.headers["authorization"];

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    logger.error("Invalid or missing Authorization header");
    res.status(401).send({success: false, message: "Unauthorized"});
    return;
  }

  // Verify the token
  const authToken = authHeader.split(" ")[1];
  if (authToken !== MODAL_CALLBACK_TOKEN.value()) {
    logger.error("Invalid authentication token");
    res.status(401).send({success: false, message: "Unauthorized"});
    return;
  }

  logger.info("Raw Body:", JSON.stringify(req.body, null, 2));

  const results = req.body.results;
  if (!results) {
    logger.error("No results found in body");
    res.status(400).send({success: false, message: "No results found in body"});
    return;
  }

  // Dispatch and return response to Modal immediately
  await dispatchTask({
    functionName: "v1ProcessModalCallback",
    data: {results},
  });

  res.status(200).send({success: true, message: "Callback received"});
  return;
}

/**
 * Process the Modal callback
 * @param {Object} params - The request object
 * @return {Promise<void>}
 */
async function processModalCallback({results}) {
  try {
    // Process the results
    const errors = [];
    const successQueue = [];
    const transformedResults = [];

    for (const result of results) {
      const resultKey = Object.keys(result)[0];
      const queueItem = await queueGetEntries({id: resultKey});
      if (!queueItem) {
        const error = `No queue item found for result key: ${resultKey}`;
        errors.push(error);
        logger.error(error);
        continue;
      }
      successQueue.push(queueItem[0]);

      // Transform the result into the format expected by saveImageResultsMultipleScenes
      const queueParams = queueItem[0].params;
      const imagePath = `${queueParams.outputPathWithoutExtension}.9.16.webp`;

      // Make image and public and decode the URL
      const publicUrl = await makeFilePublic({path: imagePath});
      const decodedUrl = decodeURIComponent(publicUrl);

      transformedResults.push({
        result: true,
        sceneId: queueParams.sceneId,
        chapter: queueParams.chapter,
        scene_number: queueParams.scene_number,
        tall: decodedUrl,
        tallBucketPath: imagePath,
        description: queueParams.prompt || "",
      });
      logger.log("transformedResults", transformedResults);
    }

    if (successQueue.length > 0) {
      // Store the images and mark the queue items as complete
      await saveImageResultsMultipleScenes({results: transformedResults});
      await queueSetItemsToComplete({queue: successQueue});
    }

    if (errors.length > 0) {
      logger.error("Errors:", errors);
      return;
    }
  } catch (error) {
    logger.error("Error processing Modal callback:", error);
  }
}

export {processModalCallback, handleModalCallback};
