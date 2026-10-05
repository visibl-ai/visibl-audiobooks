/**
 * @fileoverview Provider-agnostic post-processing for generated images.
 * Dispatches to the RTDB hooks by queue entry type so every image provider
 * (Wavespeed webhook, FAL synchronous queue) records results the same way.
 */

import handleSceneImagePostProcessing from "../../storage/realtimeDb/hooks/handleSceneImagePostProcessing.js";
import handleCharacterImagePostProcessing from "../../storage/realtimeDb/hooks/handleCharacterImagePostProcessing.js";
import handleLocationImagePostProcessing from "../../storage/realtimeDb/hooks/handleLocationImagePostProcessing.js";
import handleCoverArtPostProcessing from "../../storage/realtimeDb/hooks/handleCoverArtPostProcessing.js";

/**
 * Run the RTDB post-processing hook that matches the entry's image type.
 * Entries without a recognised type are left alone.
 * @param {Object} params - The parameters object
 * @param {Object} params.entry - Queue entry (params.type selects the hook)
 * @param {Object} params.result - Generation result: {gcpUrl, cdnUrl} or {resultGcsPath}
 * @return {Promise<void>}
 */
async function runImagePostProcessing({entry, result}) {
  const resultObj = {result};
  switch (entry.params?.type) {
    case "sceneImage":
      return handleSceneImagePostProcessing(entry, resultObj);
    case "character":
    case "character-profile":
      return handleCharacterImagePostProcessing(entry, resultObj);
    case "location":
      return handleLocationImagePostProcessing(entry, resultObj);
    case "coverArt":
      return handleCoverArtPostProcessing(entry, resultObj);
    default:
      return undefined;
  }
}

export {runImagePostProcessing};
