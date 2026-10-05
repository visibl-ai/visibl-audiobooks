/* eslint-disable require-jsdoc */
import OpenAI from "openai";
import fs from "fs";
import logger from "../../util/logger.js";
import {ALLMODELS_API_KEY, MOCK_TRANSCRIPTIONS} from "../../config/config.js";
import openaiWhisper from "../openai/whisper.js";
import {captureEvent} from "../../analytics/index.js";
const ALLMODELS_BASE_URL = "https://api.allmodels.io/oai";
const ALLMODELS_TIMEOUT = 30 * 1000; // 30 seconds timeout
const DEFAULT_MODEL = "groq/whisper-large-v3-turbo";

// AllModels pricing for groq/whisper-large-v3-turbo per minute of audio
const ALLMODELS_WHISPER_COST_PER_MINUTE = 0.000703333;

async function whisperTranscribe({stream, offset, prompt, chapter, model = DEFAULT_MODEL, retry = 3, distinctId, traceId, posthogGroups = {}, sku = null, uid = null}) {
  let map = [];
  const mockValue = MOCK_TRANSCRIPTIONS.value().toString().trim().toLowerCase();
  const isMockMode = ["true", "1", "yes", "y"].includes(mockValue);
  // Use mock AllModels client if MOCK_TRANSCRIPTIONS is enabled.
  // Retries are handled by the caller, so the SDK's own retries are disabled.
  const allmodels = isMockMode === true ?
    new MockAllModels() :
    new OpenAI({apiKey: ALLMODELS_API_KEY.value(), baseURL: ALLMODELS_BASE_URL, timeout: ALLMODELS_TIMEOUT, maxRetries: 0});

  // Track request start time for latency measurement
  const startTime = Date.now();
  let audioDurationSeconds = 0;
  let totalCost = 0;
  let totalTokens = 0;
  let success = false;
  let errorMessage = null;

  try {
    const transcription = await allmodels.audio.transcriptions.create({
      file: stream,
      model: model,
      language: "en",
      response_format: "verbose_json",
      temperature: 0,
      prompt: prompt,
    });

    // AllModels normalizes verbose_json to word timestamps, so build segments from words
    // when the response doesn't include them
    const segments = transcription.segments || segmentsFromWords(transcription.words || []);

    // Calculate audio duration and costs
    if (transcription.duration) {
      audioDurationSeconds = transcription.duration;
    } else if (segments.length > 0) {
      // Estimate duration from last segment end time if duration not provided
      const lastSegment = segments[segments.length - 1];
      audioDurationSeconds = (lastSegment.end || lastSegment.start || 0);
    }

    const audioDurationMinutes = audioDurationSeconds / 60;
    totalCost = audioDurationMinutes * ALLMODELS_WHISPER_COST_PER_MINUTE;

    // Calculate approximate tokens (rough estimate: ~1.5 tokens per word)
    const fullText = segments.map((s) => s.text).join(" ");
    const wordCount = fullText.split(/\s+/).filter((w) => w.length > 0).length;
    totalTokens = Math.round(wordCount * 1.5);

    // Transform segments to match Whisper format
    // Segments: [{id, start, text, ...}]
    // We need: [{id, startTime, text}]
    map = segments.map((segment) => {
      return {
        id: segment.id,
        startTime: segment.start + offset,
        text: segment.text,
      };
    });

    success = true;
  } catch (err) {
    errorMessage = err.message || err.toString();
    logger.warn(`Error transcribing stream: ${err}, ${chapter}, retry is: ${retry}`);
    // Retry x times.
    if (retry > 0) {
      logger.warn(`Retrying transcription for ${chapter}`);
      const newStream = fs.createReadStream(chapter);
      return whisperTranscribe({stream: newStream, offset, prompt, chapter, model, retry: retry - 1, distinctId, traceId, posthogGroups, sku, uid});
    } else {
      logger.error(`Failed to transcribe ${chapter}`);
      map = {};
      map.error = err;
    }
  } finally {
    // Calculate latency
    const latencyMs = Date.now() - startTime;

    // Simple analytics event - PostHog provider will handle the mapping
    const eventProperties = {
      provider: "allmodels",
      model: model,
      traceId: traceId,
      input: prompt || "",
      output: success ? `Transcribed ${map.length || 0} segments (${audioDurationSeconds}s audio)` : undefined,
      latency: latencyMs,
      success: success,
      error: errorMessage,
      tokens: totalTokens,
      cost: totalCost,
      // Custom whisper properties
      audio_duration_seconds: audioDurationSeconds,
      segment_count: map.length || 0,
      chapter: chapter,
      offset: offset,
      retry_count: 3 - retry,
      sku: sku,
      uid: uid,
      groups: posthogGroups,
    };

    // Send event using generic event name
    await captureEvent("audio_transcription", eventProperties, distinctId || "system");

    logger.debug(`AllModels Whisper transcription analytics captured - duration: ${audioDurationSeconds}s, cost: $${totalCost.toFixed(6)}, tokens: ${totalTokens}`);
  }

  return map;
}

// Group word timestamps into sentence segments: [{id, start, end, text}]
// Text keeps Whisper's leading space so output matches previous transcriptions
function segmentsFromWords(words) {
  const segments = [];
  let current = [];
  for (const word of words) {
    current.push(word);
    if (/[.!?]["')\]]*$/.test(word.word.trim())) {
      segments.push(current);
      current = [];
    }
  }
  if (current.length > 0) segments.push(current);

  return segments.map((segmentWords, id) => ({
    id,
    start: segmentWords[0].start,
    end: segmentWords[segmentWords.length - 1].end,
    text: " " + segmentWords.map((w) => w.word.trim()).join(" "),
  }));
}

// Mock AllModels client for testing
class MockAllModels {
  constructor() {
    this.audio = {
      transcriptions: {
        create: async (params) => {
          logger.info(`MOCK: AllModels transcription API called`);

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

          const totalDuration = segmentCount * segmentDuration;
          logger.debug(`MOCK: Generated ${segments.length} segments with ${totalDuration}s total duration`);

          // Simulate async delay
          await new Promise((resolve) => setTimeout(resolve, 100));

          return {
            segments,
            duration: totalDuration,
          };
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
