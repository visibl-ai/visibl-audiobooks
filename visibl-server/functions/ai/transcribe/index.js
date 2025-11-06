// Export all transcription functionality
export {
  prepareAudioStreams,
  outputStreamsFromM4b,
  cleanupAudioFiles,
  MAX_SIZE_FOR_TRANSCRIBE,
} from "./audioProcessor.js";

export {
  transcribeChapters,
  validateTranscriptions,
} from "./transcriptionProcessor.js";

export {
  sendTranscriptionToLlm,
  transcriptionQueue,
  validateAndSetupTranscriptionParams,
  createMessageChunks,
  processChunksWithLLM,
  validateAndCombineResults,
  verifyTranscriptionIntegrity,
  storeChapterTranscription,
} from "./transcriptionCorrector.js";

export {
  getTranscriptionsPath,
  saveUncorrectedTranscriptions,
  loadTranscriptions,
  transcriptionsExist,
} from "./transcriptionStorage.js";

export {
  generateTranscriptions,
  processPrivateM4B,
  sendTranscriptionToLlmWithQueue,
} from "./transcriber.js";
