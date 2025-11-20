/* eslint-disable require-jsdoc */
import Groq from "groq-sdk";
import fs from "fs";
import logger from "../../util/logger.js";
import {GROQ_API_KEY, MOCK_TRANSCRIPTIONS} from "../../config/config.js";
import openaiWhisper from "../openai/whisper.js";
import {captureEvent} from "../../analytics/index.js";
const GROQ_TIMEOUT = 30 * 1000; // 15 seconds timeout

// Groq Whisper pricing per minute of audio (as of 2025)
const GROQ_WHISPER_COST_PER_MINUTE = 0.0005; // $0.0005 per minute

async function whisperTranscribe({stream, offset, prompt, chapter, retry = 3, distinctId, traceId, posthogGroups = {}, sku = null, uid = null}) {
  let map = [];
  const mockValue = MOCK_TRANSCRIPTIONS.value().toString().trim().toLowerCase();
  const isMockMode = ["true", "1", "yes", "y"].includes(mockValue);
  // Use mock Groq client if MOCK_TRANSCRIPTIONS is enabled
  const groq = isMockMode === true ?
    new MockGroq() :
    new Groq({apiKey: GROQ_API_KEY.value(), timeout: GROQ_TIMEOUT});

  // Track request start time for latency measurement
  const startTime = Date.now();
  let audioDurationSeconds = 0;
  let totalCost = 0;
  let totalTokens = 0;
  let success = false;
  let errorMessage = null;

  try {
    const transcription = await groq.audio.transcriptions.create({
      file: stream,
      model: "whisper-large-v3-turbo",
      language: "en",
      response_format: "verbose_json",
      temperature: 0,
      prompt: prompt,
    });

    // Calculate audio duration and costs
    if (transcription.duration) {
      audioDurationSeconds = transcription.duration;
    } else if (transcription.segments && transcription.segments.length > 0) {
      // Estimate duration from last segment end time if duration not provided
      const lastSegment = transcription.segments[transcription.segments.length - 1];
      audioDurationSeconds = (lastSegment.end || lastSegment.start || 0);
    }

    const audioDurationMinutes = audioDurationSeconds / 60;
    totalCost = audioDurationMinutes * GROQ_WHISPER_COST_PER_MINUTE;

    // Calculate approximate tokens (rough estimate: ~1.5 tokens per word)
    const fullText = transcription.segments.map((s) => s.text).join(" ");
    const wordCount = fullText.split(/\s+/).filter((w) => w.length > 0).length;
    totalTokens = Math.round(wordCount * 1.5);

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

    success = true;
  } catch (err) {
    errorMessage = err.message || err.toString();
    logger.warn(`Error transcribing stream: ${err}, ${chapter}, retry is: ${retry}`);
    // Retry x times.
    if (retry > 0) {
      logger.warn(`Retrying transcription for ${chapter}`);
      const newStream = fs.createReadStream(chapter);
      return whisperTranscribe({stream: newStream, offset, prompt, chapter, retry: retry - 1, distinctId, traceId, posthogGroups, sku, uid});
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
      provider: "groq",
      model: "whisper-large-v3-turbo",
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

    logger.debug(`Groq Whisper transcription analytics captured - duration: ${audioDurationSeconds}s, cost: $${totalCost.toFixed(6)}, tokens: ${totalTokens}`);
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
