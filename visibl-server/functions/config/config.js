/* eslint-disable no-unused-vars */
import {defineString, defineBoolean, defineSecret} from "firebase-functions/params";

// ============================================================================
// SECRETS - API Keys and Sensitive Tokens
// These are stored securely in Firebase Secret Manager (in production)
// or read from .env files (in local development)
// ============================================================================

// Check if we're running in the emulator
// FUNCTIONS_EMULATOR is set by Firebase when running in emulator
const isEmulator = process.env.FUNCTIONS_EMULATOR === "true";

// Helper function: use defineString for emulator, defineSecret for production
const defineSecretOrString = (name) => {
  return isEmulator ? defineString(name) : defineSecret(name);
};

const OPENAI_API_KEY = defineSecretOrString("OPENAI_API_KEY");
const ADMIN_API_KEY = defineSecretOrString("ADMIN_API_KEY");
const AUDIBLE_OPDS_API_KEY = defineSecretOrString("AUDIBLE_OPDS_API_KEY");
const GEMINI_API_KEY = defineSecretOrString("GEMINI_API_KEY");
const MODAL_API_KEY = defineSecretOrString("MODAL_API_KEY");
const MODAL_CALLBACK_TOKEN = defineSecretOrString("MODAL_CALLBACK_TOKEN");
const OPENROUTER_API_KEY = defineSecretOrString("OPENROUTER_API_KEY");
const IMAGEROUTER_API_KEY = defineSecretOrString("IMAGEROUTER_API_KEY");
const FAL_API_KEY = defineSecretOrString("FAL_API_KEY");
const WAVESPEED_API_KEY = defineSecretOrString("WAVESPEED_API_KEY");
const GROQ_API_KEY = defineSecretOrString("GROQ_API_KEY");
const CLOUDFLARE_IMAGES_API_TOKEN = defineSecretOrString("CLOUDFLARE_IMAGES_API_TOKEN");
const POSTHOG_API_KEY = defineSecretOrString("POSTHOG_API_KEY");

// ============================================================================
// CONFIGURATION PARAMETERS - Non-sensitive settings
// These can remain as regular parameters in .env files
// ============================================================================

// Environment and deployment settings
const ENVIRONMENT = defineString("ENVIRONMENT");
const STORAGE_BUCKET_ID = defineString("STORAGE_BUCKET_ID");
const AUDIBLE_OPDS_FIREBASE_URL = defineString("AUDIBLE_OPDS_FIREBASE_URL");
const HOSTING_DOMAIN = defineString("HOSTING_DOMAIN");
const AAX_CONNECT_SOURCE = defineString("AAX_CONNECT_SOURCE");
const CLOUDFLARE_ACCOUNT_ID = defineString("CLOUDFLARE_ACCOUNT_ID");
const CDN_URL = defineString("CDN_URL", {default: "https://cdn.visibl.ai/"});
const POSTHOG_HOST = defineString("POSTHOG_HOST", {default: "https://eu.i.posthog.com"});

// Service endpoints
const MODAL_OUTPAINT_ENDPOINT = defineString("MODAL_OUTPAINT_ENDPOINT");
const IMAGEROUTER_API_URL = defineString("IMAGEROUTER_API_URL", {default: "https://api.imagerouter.io/v1/openai/images/generations"});

// Processing parameters
const GEMINI_RETRY_DELAY = defineString("GEMINI_RETRY_DELAY", {default: "33s"});
const MODAL_OUTPAINT_STEPS = defineString("MODAL_OUTPAINT_STEPS", {default: "20"});
const TRANSCRIPTION_MAX_DIFF_PERCENT = defineString("TRANSCRIPTION_MAX_DIFF_PERCENT", {default: "33"});
const TRANSCRIPTION_CHUNK_MULTIPLIER = defineString("TRANSCRIPTION_CHUNK_MULTIPLIER", {default: "6"});
const IMAGE_GEN_PRECEDING_SCENES = defineString("IMAGE_GEN_PRECEDING_SCENES", {default: "2"});
const IMAGE_GEN_FOLLOWING_SCENES = defineString("IMAGE_GEN_FOLLOWING_SCENES", {default: "10"});
const BOOK_RUNTIME_MIN = defineString("BOOK_RUNTIME_MIN", {default: "30"});
const GRAPH_CHECKUP_THRESHOLD_MINUTES = defineString("GRAPH_CHECKUP_THRESHOLD_MINUTES", {default: "10"});

// Feature flags
const MOCK_LLM = defineBoolean("MOCK_LLM");
const USE_AIQUEUE = defineBoolean("USE_AIQUEUE", {default: true});
const MOCK_IMAGES = defineBoolean("MOCK_IMAGES");
const ENFORCE_APP_CHECK = defineBoolean("ENFORCE_APP_CHECK", {default: true});
const MOCK_TRANSCRIPTIONS = defineBoolean("MOCK_TRANSCRIPTIONS", {default: false});

// ============================================================================
// EXPORTS
// ============================================================================
export {
  OPENAI_API_KEY,
  ENVIRONMENT,
  ADMIN_API_KEY,
  STORAGE_BUCKET_ID,
  AUDIBLE_OPDS_API_KEY,
  AUDIBLE_OPDS_FIREBASE_URL,
  HOSTING_DOMAIN,
  AAX_CONNECT_SOURCE,
  GEMINI_API_KEY,
  GEMINI_RETRY_DELAY,
  MOCK_LLM,
  MOCK_IMAGES,
  MODAL_API_KEY,
  MODAL_OUTPAINT_ENDPOINT,
  MODAL_CALLBACK_TOKEN,
  MODAL_OUTPAINT_STEPS,
  USE_AIQUEUE,
  OPENROUTER_API_KEY,
  TRANSCRIPTION_MAX_DIFF_PERCENT,
  TRANSCRIPTION_CHUNK_MULTIPLIER,
  IMAGE_GEN_PRECEDING_SCENES,
  IMAGE_GEN_FOLLOWING_SCENES,
  IMAGEROUTER_API_KEY,
  IMAGEROUTER_API_URL,
  FAL_API_KEY,
  WAVESPEED_API_KEY,
  GROQ_API_KEY,
  BOOK_RUNTIME_MIN,
  ENFORCE_APP_CHECK,
  MOCK_TRANSCRIPTIONS,
  CLOUDFLARE_ACCOUNT_ID,
  CLOUDFLARE_IMAGES_API_TOKEN,
  CDN_URL,
  GRAPH_CHECKUP_THRESHOLD_MINUTES,
  POSTHOG_API_KEY,
  POSTHOG_HOST,
};

/**
 * List of all secrets that functions may need access to
 * Only needed in production - emulator reads from .env files
 */
const secrets = isEmulator ? [] : [
  OPENAI_API_KEY,
  ADMIN_API_KEY,
  AUDIBLE_OPDS_API_KEY,
  GEMINI_API_KEY,
  MODAL_API_KEY,
  MODAL_CALLBACK_TOKEN,
  OPENROUTER_API_KEY,
  IMAGEROUTER_API_KEY,
  FAL_API_KEY,
  WAVESPEED_API_KEY,
  GROQ_API_KEY,
  CLOUDFLARE_IMAGES_API_TOKEN,
  POSTHOG_API_KEY,
];

/**
 * Default configuration for Firebase Functions with App Check enforcement
 */
export const firebaseFnConfig = {
  region: "europe-west1",
  enforceAppCheck: ENFORCE_APP_CHECK,
  memory: "512MiB",
  secrets: secrets,
};

/**
 * Default configuration for Firebase HTTP Functions.
 */
export const firebaseHttpFnConfig = {
  region: "europe-west1",
  cors: true,
  memory: "512MiB",
  secrets: secrets,
};
