/**
 * @fileoverview User Book Import Module
 * Handles extraction of metadata, moderation, and cover generation for user-uploaded audiobooks
 */

// Metadata extraction and moderation
export {
  extractTitleAndAuthorFromTranscription,
  moderateMetadata,
} from "./metadataProcessor.js";

// Cover generation
export {
  generateBookCover,
  generateBookCoverFromMetadata,
} from "./coverGenerator.js";

// Audio fingerprinting and SKU generation
export {
  generateAudiobookFingerprint,
  generateFingerprintFromMetadata,
  generateSkuFromFingerprint,
} from "./audioFingerprint.js";

// Main processing function
export {processCustomM4B} from "./customM4BProcessor.js";
