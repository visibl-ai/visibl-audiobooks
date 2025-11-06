/* eslint-disable require-jsdoc */
import Groq from "groq-sdk";
import fs from "fs";
import logger from "../../util/logger.js";
import {GROQ_API_KEY, MOCK_TRANSCRIPTIONS} from "../../config/config.js";
import openaiWhisper from "../openai/whisper.js";
const GROQ_TIMEOUT = 30 * 1000; // 15 seconds timeout

async function whisperTranscribe({stream, offset, prompt, chapter, retry = 3}) {
  let map = [];
  const mockValue = MOCK_TRANSCRIPTIONS.value().toString().trim().toLowerCase();
  const isMockMode = ["true", "1", "yes", "y"].includes(mockValue);
  // Use mock Groq client if MOCK_TRANSCRIPTIONS is enabled
  const groq = isMockMode === true ?
    new MockGroq() :
    new Groq({apiKey: GROQ_API_KEY.value(), timeout: GROQ_TIMEOUT});

  try {
    const transcription = await groq.audio.transcriptions.create({
      file: stream,
      model: "whisper-large-v3-turbo",
      language: "en",
      response_format: "verbose_json",
      temperature: 0,
      prompt: prompt,
    });

    // Transform Groq response format to match Whisper format
    // Groq returns: {segments: [{id, start, text, ...}]}
    // We need: [{id, startTime, text}]
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

// Mock Groq client for testing
class MockGroq {
  constructor() {
    this.audio = {
      transcriptions: {
        create: async (params) => {
          logger.info(`MOCK: Groq transcription API called`);

          // Generate mock segments
          const segmentCount = 5;
          const segmentDuration = 2;
          const segments = [];

          for (let i = 0; i < segmentCount; i++) {
            segments.push({
              id: i,
              start: i * segmentDuration,
              text: `Mock transcription segment ${i + 1}. This is test content that simulates real transcription output.`,
            });
          }

          logger.debug(`MOCK: Generated ${segments.length} segments`);

          // Simulate async delay
          await new Promise((resolve) => setTimeout(resolve, 100));

          return {segments};
        },
      },
    };
  }
}

const whisper = {
  whisperTranscribe: whisperTranscribe,
  consolidate: openaiWhisper.consolidate,
  consolidateJson: openaiWhisper.consolidateJson,
};

export default whisper;
