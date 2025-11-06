/* eslint-disable require-jsdoc */

import {
  getFirestore} from "firebase-admin/firestore";
import logger from "../util/logger.js";
import {
  dispatchTask,
  // dataToBody,
} from "../util/dispatch.js";

/**
 * Retrieves a pipeline from the Firestore database based on the provided UID and pipeline data.
 *
 * @param {string} uid - The unique identifier of the user.
 * @param {object} data - The data containing the pipeline ID to be retrieved.
 * @return {Promise<object>} A promise that resolves to the pipeline data if found, otherwise null.
 */
async function getPipelineFirestore(uid, data) {
  const id = data.id;
  const snapshot = await getFirestore().collection("Pipelines").doc(id).get();
  const pipelineData = snapshot.data();
  if (pipelineData && pipelineData.uid === uid) {
    pipelineData.id = snapshot.id; // Add the document ID to the data
    return pipelineData; // Return the full document data with ID
  } else {
    return {error: "Pipeline not found"}; // Return error if there is no match
  }
}

/**
 * Removes undefined properties from an object.
 *
 * This function iterates over all properties of the given object and deletes any property
 * that has a value of undefined. This is useful for cleaning up objects before saving them
 * to a database where undefined values may not be allowed.
 *
 * @param {object} data - The object from which to remove undefined properties.
 * @return {object} The cleaned object with all undefined properties removed.
 */
function removeUndefinedProperties(data) {
  // Remove any undefined properties from data
  Object.keys(data).forEach((key) => {
    if (data[key] === undefined) {
      delete data[key];
    }
  });
  return data;
}


async function dispatchCarouselGeneration({carouselList, currentTime, sku}) {
  // carouselList is an array of sceneId's ["sceneId1", "sceneId2", "sceneId3"]
  logger.debug(`dispatchCarouselGeneration: Dispatching generateSceneImagesCurrentTime for ${carouselList.join(", ")} at ${currentTime}, sku: ${sku}`);
  await Promise.all(carouselList.map((sceneId) =>
    dispatchTask({
      functionName: "generateSceneImagesCurrentTime",
      data: {styleId: sceneId, currentTime, sku},
    }),
  ));
  return;
}

export {
  getPipelineFirestore,
  removeUndefinedProperties,
  dispatchCarouselGeneration,
};
