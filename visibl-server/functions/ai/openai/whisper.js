/* eslint-disable require-jsdoc */
// Import the OpenAI library
import OpenAI from "openai";
import fs from "fs";
import logger from "../../util/logger.js";
import {OPENAI_API_KEY} from "../../config/config.js";

// Initialize the OpenAI client with the API key from environment variables


async function whisperTranscribe({stream, offset, prompt, chapter, retry = 3}) {
  let map = [];
  const openai = new OpenAI(OPENAI_API_KEY.value());
  try {
    const transcription = await openai.audio.transcriptions.create({
      file: stream,
      model: "whisper-1",
      language: "en",
      response_format: "verbose_json",
    });
    map = transcription.segments.map((segment) => {
      return {
        id: segment.id,
        startTime: segment.start + offset,
        text: segment.text,
      };
    });
  } catch (err) {
    logger.warn(`Error transcribing stream: ${err}, ${chapter}, retry is: ${retry}`);
    // Retry x times.
    if (retry > 0) {
      logger.warn(`Retrying transcription for ${chapter}`);
      const newStream = fs.createReadStream(chapter);
      return whisperTranscribe({stream: newStream, offset, prompt, chapter, retry: retry - 1});
    } else {
      logger.error(`Failed to transcribe ${chapter}`);
      map = {};
      map.error = err;
    }
  }
  return map;
}

async function whisperConsolidate(file, offset) {
  const data = await fs.promises.readFile(file);
  const json = JSON.parse(data);
  const combinedJson = [];
  let temp = {id: json[0].id, startTime: json[0].startTime, text: json[0].text};

  for (let i = 1; i < json.length; i++) {
    if (json[i].startTime - temp.startTime >= offset) {
      combinedJson.push(temp);
      temp = {id: json[i].id, startTime: json[i].startTime, text: json[i].text};
    } else {
      temp.text += " " + json[i].text;
    }
  }
  combinedJson.push(temp);
  const newFileName = file.replace(".json", `-${offset}s.json`);
  await fs.promises.writeFile(newFileName, JSON.stringify(combinedJson, null, 2));
}

function whisperConsolidateObject(json, offset) {
  const combinedJson = [];
  let temp = {id: json[0].id, startTime: json[0].startTime, text: json[0].text};

  for (let i = 1; i < json.length; i++) {
    if (json[i].startTime - temp.startTime >= offset) {
      combinedJson.push(temp);
      temp = {id: json[i].id, startTime: json[i].startTime, text: json[i].text};
    } else {
      temp.text += " " + json[i].text;
    }
  }
  combinedJson.push(temp);
  return combinedJson;
}

const whisper = {
  whisperTranscribe: whisperTranscribe,
  consolidate: whisperConsolidate,
  consolidateJson: whisperConsolidateObject,
};

export default whisper;
