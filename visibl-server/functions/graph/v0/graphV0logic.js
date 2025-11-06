/* eslint-disable camelcase */
/* eslint-disable require-jsdoc */

import {
  getTranscriptions,
  getGraph,
  storeGraph,
} from "../../storage/storage.js";

import {
  storeGraphCharactersRtdb,
  storeGraphLocationsRtdb,
} from "../../storage/realtimeDb/graph.js";

import {
  geminiRequest,
  geminiBatchRequestMultiPrompt,
  batchRequestMultiPromptGeminiQueue,
} from "../../ai/gemini/gemini.js";
import {dispatchGeminiRequest} from "../../ai/queue/dispatcher.js";
import {batchRequestMultiPromptOpenaiQueue} from "../../ai/openai/openaiLLM.js";
import tokenHelper from "../../ai/openai/tokens.js";
import {fixChapterContinuity} from "../../util/sceneHelpers.js";

import logger from "../../util/logger.js";
import novel from "../../ai/openai/novel.js";
import nerFunctions from "../../ai/openai/ner.js";
import {OPENAI_TOKENS_PER_MINUTE} from "../../ai/openai/openaiLimits.js";
import {
  ENVIRONMENT,
  USE_AIQUEUE,
} from "../../config/config.js";
import csv from "../../ai/csv.js";
import _ from "lodash";

// const WAIT_TIME = 15;
const MIN_LOCATIONS = 20;

function consolidateTranscriptions(params) {
  const {transcriptions, chapter} = params;
  let consolidatedText = "";
  // Return just one chapter.
  if (chapter !== undefined) { // chapter can be 0.
    logger.debug(`consolidateTranscriptions: Consolidating chapter ${chapter}`);
    const transcriptionArray = transcriptions[chapter];
    transcriptionArray.forEach((item) => {
      consolidatedText += item.text + " ";
    });
    // Return full text.
  } else {
    logger.debug(`consolidateTranscriptions: Consolidating all chapters`);
    for (const key in transcriptions) {
      if (Object.prototype.hasOwnProperty.call(transcriptions, key)) {
        const transcriptionArray = transcriptions[key];
        transcriptionArray.forEach((item) => {
          consolidatedText += item.text + " ";
        });
      }
    }
  }
  return consolidatedText.trim();
}

// eslint-disable-next-line no-unused-vars
function lowerCaseObjectKeys(params) {
  const {object} = params;
  return Object.fromEntries(
      Object.entries(object).map(([key, value]) => [
        key.toLowerCase(),
      typeof value === "object" ? lowerCaseObjectKeys({object: value}) : value,
      ]),
  );
}

function lowercaseCharacters(characterList) {
  return characterList.map((character) => {
    const lowercasedCharacter = {
      name: character.name.toLowerCase(),
    };
    if (character.aliases && character.aliases.length > 0) {
      lowercasedCharacter.aliases = character.aliases.map((alias) => alias.toLowerCase());
    }
    return lowercasedCharacter;
  });
}

async function graphCharacters(params) {
  const {uid, sku, visibility, graphId} = params;
  // 1. load transcriptions.
  const transcriptions = await getTranscriptions({uid, sku, visibility});
  // 2. consolidate transcriptions into single string.
  const fullText = consolidateTranscriptions({transcriptions});
  // 3. send to gemini.
  const llmRequestFn = USE_AIQUEUE.value() ? dispatchGeminiRequest : geminiRequest;
  const geminiResult = await llmRequestFn({
    "model": "gemini-1.5-flash",
    "prompt": "getCharacters",
    "message": fullText,
    "type": "json",
  });
  const characterList = geminiResult.result;
  // 4. store graph.
  characterList.characters = lowercaseCharacters(characterList.characters);
  await storeGraph({uid, sku, visibility, data: characterList, type: "characters", graphId});

  return characterList;
}

async function graphCharacterDescriptions(params) {
  const {uid, sku, visibility, graphId} = params;
  const transcriptions = await getTranscriptions({uid, sku, visibility});
  const fullText = consolidateTranscriptions({transcriptions});
  let characters = await getGraph({uid, sku, visibility, type: "characters", graphId});
  let characterDescriptions = {};
  if (!characters.characters || !Array.isArray(characters.characters)) {
    if (Array.isArray(characters)) {
      characters = {
        characters: characters,
      };
    } else {
      logger.error(`No characters found for ${uid} ${sku} ${visibility}`);
      return {};
    }
  }
  let end = characters.characters.length; // for debugging.
  if (ENVIRONMENT.value() === "development") {
    end = 10;
  }
  const replacements = [];
  const responseKeys = [];

  for (let i = 0; i < end; i++) {
    const character = characters.characters[i];
    const characterName = character.name;
    const aliasString = aliasesString({characterName, aliases: character.aliases});
    logger.debug(`Getting character description for ${characterName}`);
    responseKeys.push(characterName);
    replacements.push([
      {
        key: "CHARACTER",
        value: characterName,
      },
      {
        key: "ALIASES_PHRASE",
        value: aliasString,
      },
    ]);
  }
  const batchRequestFn = USE_AIQUEUE.value() ? batchRequestMultiPromptGeminiQueue : geminiBatchRequestMultiPrompt;
  characterDescriptions = await batchRequestFn(
      {
        prompt: "getCharacterDescription",
        paramsList: replacements,
        text: fullText,
        responseKeys,
      });

  // For backwards compatibility. LLM Queue already returns a flattened object.
  if (Array.isArray(characterDescriptions)) {
    characterDescriptions = characterDescriptions.reduce((acc, {responseKey, result}) => {
      acc[responseKey] = result;
      return acc;
    }, {});
  }
  await storeGraph({uid, sku, visibility, data: characterDescriptions, type: "characterDescriptions", graphId});

  return characterDescriptions;
}

// async function geminiDelay(startTime) {
//   const elapsedTime = (Date.now() - startTime) / 1000; // Convert to seconds
//   if (elapsedTime < WAIT_TIME) {
//     const remainingTime = WAIT_TIME - elapsedTime;
//     logger.debug(`Request took ${elapsedTime.toFixed(1)}s, waiting additional ${remainingTime.toFixed(1)}s`);
//     await new Promise((resolve) => setTimeout(resolve, remainingTime * 1000));
//   } else {
//     logger.debug(`Request took ${elapsedTime.toFixed(1)}s, no additional wait needed`);
//   }
// }

function flattenLocations(data) {
  const flattened = [];

  function traverse(location, path = []) {
    const currentPath = [...path, location.name.toLowerCase()];
    flattened.push({
      name: location.name.toLowerCase(),
      type: location.type.toLowerCase(),
      path: currentPath.join(" > "),
    });

    if (location.SubLocations) {
      location.SubLocations.forEach((subLocation) => traverse(subLocation, currentPath));
    }

    if (location.MinorLocations) {
      location.MinorLocations.forEach((minorLocation) => traverse(minorLocation, currentPath));
    }

    if (location.MicroLocations) {
      location.MicroLocations.forEach((microLocation) => traverse(microLocation, currentPath));
    }
  }

  data.MainLocations.forEach((mainLocation) => traverse(mainLocation));
  return flattened;
}

async function graphLocations(params) {
  const {uid, sku, visibility, retry = true, graphId} = params;
  // 1. load transcriptions.
  const transcriptions = await getTranscriptions({uid, sku, visibility});
  // 2. consolidate transcriptions into single string.
  const fullText = consolidateTranscriptions({transcriptions});
  // 3. send to gemini.
  const geminiResult = await geminiRequest({
    "prompt": "getLocations",
    "message": fullText,
    "type": "json",
  });
  const locationList = geminiResult.result;
  // locationList.locations = lowerCaseArrayStrings({array: locationList.locations});
  const flatLocations = {locations: flattenLocations(locationList)};
  if (flatLocations.locations.length < MIN_LOCATIONS && retry) {
    logger.warn(`Locations too short! Retrying`);
    return graphLocations({uid, sku, visibility, retry: false, graphId});
  }
  // 4. store graph.
  await storeGraph({uid, sku, visibility, data: flatLocations, type: "locations", graphId});

  return locationList;
}

async function graphLocationDescriptions(params) {
  const {uid, sku, visibility, graphId} = params;
  const transcriptions = await getTranscriptions({uid, sku, visibility});
  const fullText = consolidateTranscriptions({transcriptions});
  let locations = await getGraph({uid, sku, visibility, type: "locations", graphId});
  let locationDescriptions = {};
  if (!locations.locations || !Array.isArray(locations.locations)) {
    if (Array.isArray(locations)) {
      locations = {
        locations: locations,
      };
    } else {
      logger.error(`No locations found for ${uid} ${sku} ${visibility}`);
      return {};
    }
  }
  let end = locations.locations.length; // for debugging.
  if (ENVIRONMENT.value() === "development") {
    end = 10;
  }
  const replacements = [];
  const responseKeys = [];
  for (let i = 0; i < end; i++) {
    const location = locations.locations[i];
    const name = location.name;
    // for (const location of locations.locations) {
    //   const name = location.name;
    logger.debug(`Getting location description for ${name}`);
    replacements.push(locationsParams({location}));
    responseKeys.push(name);
    // logger.debug(`With replacements ${JSON.stringify(locationsParams({location}))}`);
  }
  locationDescriptions = await geminiBatchRequestMultiPrompt(
      {
        prompt: "getLocationDescription",
        paramsList: replacements,
        text: fullText,
        responseKeys,
      });
  locationDescriptions = locationDescriptions.reduce((acc, {responseKey, result}) => {
    acc[responseKey] = result;
    return acc;
  }, {});
  await storeGraph({uid, sku, visibility, data: locationDescriptions, type: "locationDescriptions", graphId});

  return locationDescriptions;
}

async function graphSummarizeDescriptions(params) {
  const {uid, sku, visibility, graphId} = params;
  const characterDescriptions = await getGraph({uid, sku, visibility, type: "characterDescriptions", graphId});
  const characterSummaries = await novel.entityImageSummarize(
      "character_image_summarize_prompt",
      characterDescriptions,
      OPENAI_TOKENS_PER_MINUTE,
  );
  await storeGraph({uid, sku, visibility, data: characterSummaries, type: "characterSummaries", graphId});

  await storeGraphCharactersRtdb({graphId, characterSummaries});

  const locationDescriptions = await getGraph({uid, sku, visibility, type: "locationDescriptions", graphId});
  const locationSummaries = await novel.entityImageSummarize(
      "location_image_summarize_prompt",
      locationDescriptions,
      OPENAI_TOKENS_PER_MINUTE,
  );
  await storeGraph({uid, sku, visibility, data: locationSummaries, type: "locationSummaries", graphId});

  // Store locations in RTDB for real-time access
  await storeGraphLocationsRtdb({graphId, locationSummaries});

  return {characterSummaries, locationSummaries};
}

async function graphScenes(params) {
  let {uid, sku, visibility, chapter, graphId} = params;
  if (!chapter) {
    chapter = 0;
  }
  const locations = await getGraph({uid, sku, visibility, type: "locations", graphId});
  const locationsCsv = csv(locations.locations);
  const characters = await getGraph({uid, sku, visibility, type: "characters", graphId});
  const charactersCsv = csv(characters.characters);
  const transcriptions = await getTranscriptions({uid, sku, visibility});
  const chapterJson = transcriptions[chapter];
  chapterJson.forEach((item) => {
    if (typeof item.startTime === "number") {
      item.startTime = item.startTime.toFixed(1);
    }
  });
  let charactersDescription = await getGraph({uid, sku, visibility, type: "characterSummaries", graphId});
  charactersDescription = Object.fromEntries(
      Object.entries(charactersDescription).map(([key, value]) => [key.toLowerCase(), value]),
  );
  let locationDescription = await getGraph({uid, sku, visibility, type: "locationSummaries", graphId});
  locationDescription = Object.fromEntries(
      Object.entries(locationDescription).map(([key, value]) => [key.toLowerCase(), value]),
  );

  const prompt = "transcribeFilmDirectorPrompt";
  const tokensPerMinute = OPENAI_TOKENS_PER_MINUTE;

  const SLICE_SIZE = 15;
  const paramsList = [];
  const textList = [];
  const responseKey = [];

  // Prepare chunks for processing
  for (let i = 0; i < chapterJson.length; i += SLICE_SIZE) {
    const chapterChunkCSV = csv(chapterJson, i, i + SLICE_SIZE);
    textList.push(chapterChunkCSV);
    paramsList.push([
      {name: "CHARACTER_LIST", value: charactersCsv},
      {name: "LOCATIONS_LIST", value: locationsCsv},
    ]);
    responseKey.push(i);
  }

  const batchRequestFn = USE_AIQUEUE.value() ? batchRequestMultiPromptOpenaiQueue : nerFunctions.globalBatchRequestMultiPrompt;
  let scenes_result = await batchRequestFn({
    responseKey,
    prompt,
    paramsList,
    textList,
    tokensPerMinute,
  });

  // Flatten the results
  const flattened_scenes_result = [];
  let scene_number = 0;
  for (const key in scenes_result) {
    if (Object.prototype.hasOwnProperty.call(scenes_result, key)) {
      const scenes = scenes_result[key].scenes;
      if (!Array.isArray(scenes)) {
        // Not sure why this happens?!
        logger.warn(`Unexpected scenes format for key ${key}: ${JSON.stringify(scenes)}`);
      } else {
        for (const scene of scenes) {
          // object is scenes = {scenes: [] }
          scene.scene_number = scene_number++;
          flattened_scenes_result.push(scene);
        }
      }
    }
  }
  scenes_result = flattened_scenes_result;
  // Log the keys of locationDescription and charactersDescription
  logger.debug(`locationDescription keys: ${JSON.stringify(Object.keys(locationDescription))}`);
  logger.debug(`charactersDescription keys: ${JSON.stringify(Object.keys(charactersDescription))}`);
  const descriptive_scenes = descriptiveScenes({scenes_result, charactersDescription, locationDescription});

  // Set the start time of the first scene to when the chapter starts.
  if (descriptive_scenes.length > 0) {
    descriptive_scenes[0].startTime = Number(parseFloat(chapterJson[0].startTime).toFixed(2));
  }
  descriptive_scenes.forEach((scene, i) => {
    if (i < (descriptive_scenes.length - 1)) {
      scene.endTime = Number(parseFloat(descriptive_scenes[i + 1].startTime).toFixed(2));
    } else {
      scene.endTime = Number(parseFloat(chapterJson[chapterJson.length - 1].startTime).toFixed(2));
    }
  });
  let scenes;
  try {
    scenes = await getGraph({uid, sku, visibility, type: "scenes", graphId});
    scenes[chapter] = descriptive_scenes;
    // check if the time of the preceiding chatper's last scene equals our start time.
    // If it does not match our start time, change the end time of the preceiding chapter's last scene to match our start time.
  } catch (e) {
    logger.warn(`Error storing scenes: ${e}`);
    scenes = {};
    scenes[chapter] = descriptive_scenes;
  }

  // Fix chapter continuity.
  scenes = fixChapterContinuity(scenes);

  await storeGraph({uid, sku, visibility, data: scenes, type: "scenes", graphId});
  logger.debug(`Generated a total of ${descriptive_scenes.length} scenes for chapter ${chapter}`);
  return descriptive_scenes;
}

function descriptiveScenes({scenes_result, charactersDescription, locationDescription}) {
  const descriptive_scenes = scenes_result.map((scene) => {
    const newCharacters = {};
    for (const character of scene.characters) {
      if (charactersDescription[character.toLowerCase()]) {
        newCharacters[character.toLowerCase()] =
            charactersDescription[character.toLowerCase()];
      } else {
        logger.warn(
            `AI referenced non-existent character ${character.toLowerCase()}`,
        );
        newCharacters[character.toLowerCase()] = character.toLowerCase();
      }
    }
    scene.characters = newCharacters;
    const newLocations = {};
    for (const location of scene.locations) {
      if (locationDescription[location.toLowerCase()]) {
        newLocations[location.toLowerCase()] =
            locationDescription[location.toLowerCase()];
      } else {
        logger.warn(
            `AI referenced non-existent location ${location.toLowerCase()}`,
        );
        newLocations[location.toLowerCase()] = location.toLowerCase();
      }
    }
    scene.locations = newLocations;
    return scene;
  });
  return descriptive_scenes;
}

async function graphScenes16k(params) {
  const {uid, sku, visibility, chapter, graphId} = params;
  const locations = await getGraph({uid, sku, visibility, type: "locations", graphId});
  const locationsList = locations.locations.map((location) => location.name);
  logger.debug(`locationsList: ${JSON.stringify(locationsList)}`);
  const characters = await getGraph({uid, sku, visibility, type: "characters", graphId});
  const charactersList = characters.characters.map((character) => character.name);
  logger.debug(`charactersList: ${JSON.stringify(charactersList)}`);
  const transcriptions = await getTranscriptions({uid, sku, visibility});
  const chapterJson = transcriptions[chapter];
  chapterJson.forEach((item) => {
    if (typeof item.startTime === "number") {
      item.startTime = item.startTime.toFixed(1);
    }
  });
  const csvText = csv(chapterJson);
  // logger.debug(`csvText: ${csvText}`);
  const numScenes = 180;
  const scenes = await nerFunctions.filmDirector16k({
    charactersList,
    locationsList,
    csvText: JSON.stringify(csvText),
    numScenes,
  });
  await storeGraph({uid, sku, visibility, data: scenes, type: "scenes16k", graphId});
  return scenes;
}

async function getCharactersList(params) {
  const {uid, sku, visibility, graphId} = params;
  let characters = await getGraph({uid, sku, visibility, type: "characters", graphId});
  if (!characters.characters || !Array.isArray(characters.characters)) {
    if (Array.isArray(characters)) {
      characters = {
        characters: characters,
      };
    } else {
      logger.error(`No characters found for ${uid} ${sku} ${visibility}`);
      return {};
    }
  }
  return characters;
}

function aliasesString({characterName, aliases}) {
  let aliasString = "";
  if (aliases && aliases.length > 0) {
    aliasString = `${characterName} is occasionally referred to as `;
    for (const alias of aliases) {
      aliasString = `${aliasString}${alias}, `;
    }
    aliasString = aliasString.substring(0, aliasString.length - 2); // remove trailing comma and space
  }
  return aliasString;
}

async function graphCharacterDescriptionsOAI(params) {
  const {uid, sku, visibility, graphId} = params;
  const transcriptions = await getTranscriptions({uid, sku, visibility});
  const fullText = consolidateTranscriptions({transcriptions});
  const characters = await getCharactersList({uid, sku, visibility, graphId});
  const prompt = "getCharacterDescription";
  const tokensPerMinute = OPENAI_TOKENS_PER_MINUTE;
  // eslint-disable-next-line prefer-const
  let paramsList = [];
  // eslint-disable-next-line prefer-const
  let textList = [];
  const responseKey = [];
  for (const character of characters.characters) {
    const characterName = character.name;
    textList.push(fullText);
    responseKey.push(characterName);
    const aliasString = aliasesString({characterName, aliases: character.aliases});
    paramsList.push([{name: "CHARACTER", value: characterName}, {name: "ALIASES_PHRASE", value: aliasString}]);
  }
  logger.debug(`textList: ${JSON.stringify(textList).substring(0, 150)}...`);
  logger.debug(`paramsList: ${JSON.stringify(paramsList).substring(0, 150)}...`);
  const characterDescriptions = await nerFunctions.globalBatchRequestMultiPrompt({
    responseKey,
    prompt,
    paramsList,
    textList,
    tokensPerMinute,
  });
  await storeGraph({uid, sku, visibility, data: characterDescriptions, type: "characterDescriptions", graphId});

  return characterDescriptions;
}

// This funciton results in graph collapse.
// Delete later after the sting is gone.
//
// async function graphCharacterDescriptionsByChapter(params) {
//   const {uid, sku, visibility, graphId, currentChapter, numChapters, title} = params;
//   const {characterDescriptions} = params;
//   const transcriptions = await getTranscriptions({uid, sku, visibility});
//   const fullText = consolidateTranscriptions({transcriptions, chapter: currentChapter});
//   logger.debug(`fullText start: ${fullText.substring(0, 25)}... end: ${fullText.substring(fullText.length - 25)}`);
//   const characters = await getCharactersList({uid, sku, visibility, graphId});
//   const prompt = "getCharacterDescriptionByChapter";
//   const tokensPerMinute = OPENAI_TOKENS_PER_MINUTE;
//   // eslint-disable-next-line prefer-const
//   let paramsList = [];
//   // eslint-disable-next-line prefer-const
//   let textList = [];
//   const responseKey = [];
//   for (const character of characters.characters) {
//     const characterName = character.name;
//     textList.push(fullText);
//     responseKey.push(characterName);
//     const aliasString = aliasesString({characterName, aliases: character.aliases});
//     let priorDescription = "";
//     if (characterDescriptions[characterName]) {
//       priorDescription = characterDescriptions[characterName];
//     }
//     paramsList.push([
//       {name: "CHARACTER", value: characterName},
//       {name: "ALIASES_PHRASE", value: aliasString},
//       {name: "CHAPTER_NUMBER", value: currentChapter},
//       {name: "NOVEL_TITLE", value: title},
//       {name: "PRIOR_DESCRIPTION", value: priorDescription},
//     ]);
//   }
//   // Trim textList and paramsList to 2 items
//   // textList = textList.slice(0, 4);
//   // paramsList = paramsList.slice(0, 4);
//   // logger.debug(`graphCharacterDescriptionsByChapter: ${JSON.stringify(params)}`);
//   logger.debug(`textList: ${JSON.stringify(textList).substring(0, 150)}...`);
//   logger.debug(`paramsList: ${JSON.stringify(paramsList).substring(0, 150)}...`);
//   const characterChapterDescriptions = await nerFunctions.globalBatchRequestMultiPrompt({
//     responseKey,
//     prompt,
//     paramsList,
//     textList,
//     tokensPerMinute,
//   });
//   logger.debug(`characterChapterDescriptions: ${JSON.stringify(Object.keys(characterChapterDescriptions))} ${graphId}`);
//   // logger.debug(`characterDescriptions: ${JSON.stringify(characterChapterDescriptions)}`);
//   // Now we have the results of each character. We need to recurse until we're done all the chapters.
//   for (const character of characters.characters) {
//     const characterName = character.name;
//     if (characterChapterDescriptions[characterName]) {
//       if (characterChapterDescriptions[characterName].descriptionUpdated === true) {
//         logger.debug(`${characterName} updated in chapter ${currentChapter} - new description!`);
//         characterDescriptions[characterName] = characterChapterDescriptions[characterName].updatedDescription;
//       } else {
//         logger.debug(`${characterName} not updated in chapter ${currentChapter}.`);
//       }
//     }
//   }
//   if (currentChapter < numChapters) {
//     return await graphCharacterDescriptionsByChapter({
//       uid,
//       sku,
//       visibility,
//       graphId,
//       currentChapter: currentChapter + 1,
//       numChapters,
//       title,
//       characterDescriptions});
//   } else {
//     logger.debug(`Chapters complete - Storing characterDescriptions for ${uid} ${sku} ${visibility} ${graphId}`);
//     await storeGraph({uid, sku, visibility, data: characterDescriptions, type: "characterDescriptions", graphId});
//     return characterDescriptions;
//   }
// }

function locationsParams({location}) {
  const params = [{
    key: "LOCATION_NAME", // TODO: Oh god I used different variables for OAI and Gemini...
    name: "LOCATION_NAME",
    value: location.name,
  }, {
    key: "LOCATION_OBJECT",
    name: "LOCATION_OBJECT",
    value: `
name: ${location.name}
type: ${location.type}
path: ${location.path}
    }`,
  }];
  if (location.path.includes(" > ")) {
    const locationPath = location.path.split(" > ").slice(0, -1).join(" > ");
    params.push({
      key: "LOCATION_LIST",
      name: "LOCATION_LIST",
      value: `   - Remember that this location is part of a hierarchy: ${location.path}. Only describe ${location.name}, as descriptions ${locationPath} already exist.`,
    });
  }
  return params;
}

async function graphLocationDescriptionsOAI(params) {
  const {uid, sku, visibility, graphId} = params;
  const transcriptions = await getTranscriptions({uid, sku, visibility});
  const fullText = consolidateTranscriptions({transcriptions});
  const locations = await getGraph({uid, sku, visibility, type: "locations", graphId});
  const prompt = "getLocationDescription";
  const tokensPerMinute = OPENAI_TOKENS_PER_MINUTE;
  // eslint-disable-next-line prefer-const
  let paramsList = [];
  const responseKey = [];
  for (const location of locations.locations) {
    const name = location.name;
    paramsList.push(locationsParams({location}));
    responseKey.push(name);
  }
  logger.debug(`paramsList: ${JSON.stringify(paramsList).substring(0, 150)}...`);
  // Trim paramsList to 2 items
  // paramsList = paramsList.slice(0, 4);
  const locationDescriptions = await nerFunctions.batchRequestStaticText({
    responseKey,
    prompt,
    paramsList,
    staticText: fullText,
    tokensPerMinute,
  });
  await storeGraph({uid, sku, visibility, data: locationDescriptions, type: "locationDescriptions", graphId});

  return locationDescriptions;
}

function filterScenes(scenes) {
  return scenes.map((scene) => {
    return {
      scene_number: scene.scene_number,
      startTime: scene.startTime,
      description: scene.description,
      characters: scene.characters,
      locations: scene.locations,
      viewpoint: scene.viewpoint,
      endTime: scene.endTime,
    };
  });
}

async function augmentScenes(params) {
  const {uid, sku, visibility, chapter, graphId} = params;
  const currentScenes = await getGraph({uid, sku, visibility, type: "scenes", graphId});
  const chapterScenes = currentScenes[chapter];
  const transcriptions = await getTranscriptions({uid, sku, visibility});
  const chapterJson = transcriptions[chapter];
  chapterJson.forEach((item) => {
    if (typeof item.startTime === "number") {
      item.startTime = item.startTime.toFixed(1);
    }
  });
  const csvText = csv(chapterJson);
  const BATCH_SIZE = 10;
  const augmentedScenes = [];
  const scenesLength = 30;// chapterScenes.length;
  logger.debug(`scenesLength: ${scenesLength}`);
  const sceneToStart = 0;
  for (let i = sceneToStart; i < scenesLength; i += BATCH_SIZE) {
    const endIndex = Math.min(i + BATCH_SIZE, scenesLength);
    logger.debug(`Augmenting scenes ${i} to ${endIndex}`);
    let batch = chapterScenes.slice(i, endIndex);
    // Filter each item in the batch to keep only specified keys
    batch = filterScenes(batch);
    // Process the batch
    const geminiResult = await geminiRequest({
      prompt: "augmentScenes",
      message: csvText,
      replacements: [
        {
          key: "SCENES_JSON",
          value: JSON.stringify(batch),
        },
      ],
    });
    const processedBatch = geminiResult.result;
    if (processedBatch.scenes.length !== batch.length) {
      logger.error(`Processed batch length ${processedBatch.scenes.length} !== batch length ${batch.length}`);
    }
    // logger.debug(`processedBatch: ${JSON.stringify(processedBatch)}`);
    augmentedScenes.push(...processedBatch.scenes);

    // If this was the last batch, break the loop
    if (endIndex === scenesLength) {
      break;
    }
  }

  // Update the scenes in the graph
  currentScenes[chapter] = augmentedScenes;
  await storeGraph({uid, sku, visibility, data: currentScenes, type: "augmentedScenes", graphId});

  return augmentedScenes;
}

// This is a pretty chaotic function.
// It takes the scenes from a chapter and augments them with AI.
// It does this with a fixed schema model for the LLM. Its the first time
// I've tried to do this.
async function augmentScenesOAI(params) {
  const {uid, sku, visibility, chapter, graphId} = params;
  let currentScenes;
  try {
    currentScenes = await getGraph({uid, sku, visibility, type: "augmentedScenes", graphId});
  } catch (e) {
    logger.info(`No augmented scenes found, using default scenes to start with`);
    currentScenes = await getGraph({uid, sku, visibility, type: "scenes", graphId});
  }
  const chapterScenes = currentScenes[chapter];
  const transcriptions = await getTranscriptions({uid, sku, visibility});
  const locations = await getGraph({uid, sku, visibility, type: "locations", graphId});
  const locationsCsv = csv(locations.locations);
  const characters = await getGraph({uid, sku, visibility, type: "characters", graphId});
  const charactersCsv = csv(characters.characters);
  const chapterJson = transcriptions[chapter];
  chapterJson.forEach((item) => {
    if (typeof item.startTime === "number") {
      item.startTime = item.startTime.toFixed(1);
    }
  });
  const csvText = csv(chapterJson);
  const BATCH_SIZE = 5;
  const scenesLength = chapterScenes.length;
  const responseKey = [];
  const prompt = "augmentScenes";
  const tokensPerMinute = OPENAI_TOKENS_PER_MINUTE;
  const paramsList = [];
  const customSchemas = [];
  const batches = {};
  const sceneToStart = 0;
  for (let i = sceneToStart; i < scenesLength; i += BATCH_SIZE) {
    const endIndex = Math.min(i + BATCH_SIZE, scenesLength);
    logger.debug(`Augmenting scenes ${i} to ${endIndex}`);
    let batch = chapterScenes.slice(i, endIndex);
    const customSchema = _.cloneDeep(customSchemaTemplate);
    for (const scene of batch) {
      customSchema.properties.scenes.properties[`scene_${scene.scene_number}`] = {...augmentSceneTemplate};
      customSchema.properties.scenes.required.push(`scene_${scene.scene_number}`);
    }
    customSchemas.push(customSchema);
    // Filter each item in the batch to keep only specified keys
    batches[i] = batch;
    batch = JSON.stringify(filterScenes(batch));
    paramsList.push([{
      name: "SCENES_JSON",
      value: batch,
    }, {
      name: "CHARACTERS_CSV",
      value: charactersCsv,
    }, {
      name: "LOCATIONS_CSV",
      value: locationsCsv,
    }]);
    responseKey.push(i);
    // If this was the last batch, break the loop
    if (endIndex === scenesLength) {
      break;
    }
  }
  const augmentedScenes = await nerFunctions.batchRequestStaticText({
    responseKey,
    prompt,
    paramsList,
    staticText: csvText,
    tokensPerMinute,
    customSchemas,
  });
  const flattened_scenes_result = [];
  for (const key in augmentedScenes) {
    if (Object.prototype.hasOwnProperty.call(augmentedScenes, key)) {
      const scenes = augmentedScenes[key].scenes;
      if (Object.keys(scenes).length !== batches[key].length) {
        logger.error(`Processed batch ${key} length ${Object.keys(scenes).length} !== batch length ${batches[key].length}`);
      }
      for (const scene of Object.values(scenes)) {
        flattened_scenes_result.push(scene);
      }
    }
  }
  logger.debug(`Augmented Scenes. Started with ${scenesLength} scenes, ended with ${flattened_scenes_result.length} scenes.`);
  let charactersDescription = await getGraph({uid, sku, visibility, type: "characterSummaries", graphId});
  charactersDescription = Object.fromEntries(
      Object.entries(charactersDescription).map(([key, value]) => [key.toLowerCase(), value]),
  );
  let locationDescription = await getGraph({uid, sku, visibility, type: "locationSummaries", graphId});
  locationDescription = Object.fromEntries(
      Object.entries(locationDescription).map(([key, value]) => [key.toLowerCase(), value]),
  );
  const descriptive_scenes = descriptiveScenes({scenes_result: flattened_scenes_result, charactersDescription, locationDescription});
  // Update the scenes in the graph
  currentScenes[chapter] = descriptive_scenes;
  await storeGraph({uid, sku, visibility, data: currentScenes, type: "augmentedScenes", graphId});

  return augmentedScenes;
}

const customSchemaTemplate = {
  "type": "object",
  "properties": {
    "scenes": {
      "type": "object",
      "properties": {},
      "additionalProperties": false,
      "required": [],
    },
  },
  "additionalProperties": false,
  "required": ["scenes"],
};

const augmentSceneTemplate = {
  "type": "object",
  "properties": {
    "description": {
      "type": "string",
    },
    "characters": {
      "type": "array",
      "items": {
        "type": "string",
        // "properties": {
        //   "name": {
        //     "type": "string",
        //   },
        // "description": {
        //   "type": "string",
        // },
        // },
        // "additionalProperties": false,
        // "required": [
        //   "name",
        //   // "description",
        // ],
      },
    },
    "locations": {
      "type": "array",
      "items": {
        "type": "string",
        // "properties": {
        //   "name": {
        //     "type": "string",
        //   },
        // "description": {
        //   "type": "string",
        // },
        // },
        // "additionalProperties": false,
        // "required": [
        //   "name",
        //   // "description",
        // ],
      },
    },
    "startTime": {
      "type": "number",
    },
    "viewpoint": {
      "type": "object",
      "properties": {
        "setting": {
          "type": "string",
        },
        "placement": {
          "type": "string",
        },
        "shot type": {
          "type": "string",
        },
        "mood": {
          "type": "string",
        },
        "technical": {
          "type": "string",
        },
      },
      "additionalProperties": false,
      "required": [
        "setting",
        "placement",
        "shot type",
        "mood",
        "technical",
      ],
    },
    "endTime": {
      "type": "number",
    },
    "scene_number": {
      "type": "integer",
    },
  },
  "additionalProperties": false,
  "required": [
    "description",
    "characters",
    "locations",
    "startTime",
    "viewpoint",
    "endTime",
    "scene_number",
  ],
};

const getFullTextTokens = async ({uid, sku, visibility}) => {
  const transcriptions = await getTranscriptions({uid, sku, visibility});
  // 2. consolidate transcriptions into single string.
  const fullText = consolidateTranscriptions({transcriptions});
  const fullTextTokens = await tokenHelper.countTokens(fullText);
  return fullTextTokens;
};


export {
  graphCharacters,
  graphLocations,
  graphCharacterDescriptions,
  graphLocationDescriptions,
  graphSummarizeDescriptions,
  graphScenes,
  graphScenes16k,
  graphCharacterDescriptionsOAI,
  // graphCharacterDescriptionsByChapter,
  graphLocationDescriptionsOAI,
  augmentScenes,
  augmentScenesOAI,
  getFullTextTokens,
};
