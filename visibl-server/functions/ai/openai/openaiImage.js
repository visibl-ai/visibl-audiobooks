/* eslint-disable require-jsdoc */
import OpenAI, {toFile} from "openai";
import axios from "axios";
import {Readable} from "stream";
import fs from "fs/promises";
import path from "path";
import logger from "../../util/logger.js";
import {OPENAI_API_KEY, MOCK_IMAGES} from "../../config/config.js";
import {uploadStreamAndGetCDNLink} from "../../storage/storage.js";
import {sharpStream} from "../../util/sharp.js";

const OPENAI_IMAGE_DEFAULT_MODEL = "gpt-image-2.5-flare";
const OPENAI_IMAGE_DEFAULT_PARAMS = {
  size: "720x1280",
  quality: "low",
  output_format: "jpeg",
};
const OPENAI_SCENE_IMAGE_MODEL = "gpt-image-2.5-sunburst";
const OPENAI_SCENE_IMAGE_PARAMS = {
  size: "720x1280",
  quality: "low",
  output_format: "jpeg",
};
// Scene and style images: medium quality, streamed with partials that are shown until the final lands.
const OPENAI_STREAMED_SCENE_IMAGE_PARAMS = {
  ...OPENAI_SCENE_IMAGE_PARAMS,
  quality: "medium",
  partial_images: 2,
};

// Requests that ask for partial images must stream to receive them.
function withStreaming(request) {
  return request.partial_images ? {...request, stream: true} : request;
}

function buildOpenAiImageRequest({prompt, model = OPENAI_IMAGE_DEFAULT_MODEL, modelParams = {}}) {
  return withStreaming({
    model,
    prompt,
    n: 1,
    // Generations only: the edits endpoint isn't documented as accepting moderation.
    moderation: "low",
    ...OPENAI_IMAGE_DEFAULT_PARAMS,
    ...modelParams,
  });
}

function buildOpenAiImageEditRequest({prompt, image, model = OPENAI_IMAGE_DEFAULT_MODEL, modelParams = {}}) {
  return withStreaming({
    model,
    image,
    prompt,
    n: 1,
    ...OPENAI_IMAGE_DEFAULT_PARAMS,
    ...modelParams,
  });
}

function getOpenAiRequestLog({request, response, rawResponse, requestId, model, startedAt, completedAt}) {
  return {
    requestId,
    model,
    startedAt: new Date(startedAt).toISOString(),
    completedAt: new Date(completedAt).toISOString(),
    durationMs: completedAt - startedAt,
    request: {
      n: request.n,
      size: request.size,
      quality: request.quality,
      output_format: request.output_format,
      moderation: request.moderation,
      partial_images: request.partial_images,
      input_fidelity: request.input_fidelity,
    },
    response: {
      created: response.created,
      size: response.size,
      quality: response.quality,
      output_format: response.output_format,
      usage: response.usage || null,
    },
    headers: {
      openaiProcessingMs: rawResponse.headers.get("openai-processing-ms"),
    },
  };
}

/**
 * Run an OpenAI images request, logging the full API error before rethrowing
 * so moderation and other rejections can be diagnosed from the logs.
 * @param {Function} fn - Function that performs the OpenAI request
 * @param {string} model - The model being called
 * @return {Promise<Object>} The SDK response with raw response and request ID
 */
async function withOpenAiErrorLogging(fn, model) {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof OpenAI.APIError) {
      logger.error(`OpenAI image request to ${model} failed: ${JSON.stringify({
        status: error.status,
        code: error.code,
        type: error.type,
        param: error.param,
        requestId: error.requestID,
        error: error.error,
      })}`);
    }
    throw error;
  }
}

// A failed partial is logged and skipped; it never fails the image.
async function sendPartial({onPartial, buffer, index}) {
  if (!onPartial) return;
  try {
    await onPartial(buffer, index);
  } catch (error) {
    logger.warn(`OpenAI image partial ${index} was not stored: ${error.message}`);
  }
}

/**
 * Read a streamed image response. Each partial is handed to onPartial and awaited before the next
 * event is read, so partials are stored in order and always before the final image.
 * @param {Object} params - The parameters object
 * @param {AsyncIterable} params.stream - The SDK image stream
 * @param {Function} [params.onPartial] - Called with (buffer, index) for each partial image
 * @return {Promise<Object>} The completed event as response (final b64_json and usage) and the partial count
 */
async function readImageStream({stream, onPartial}) {
  let completed = null;
  let partials = 0;
  for await (const event of stream) {
    if (event.type.endsWith(".partial_image")) {
      partials++;
      await sendPartial({onPartial, buffer: Buffer.from(event.b64_json, "base64"), index: event.partial_image_index});
    } else if (event.type.endsWith(".completed")) {
      completed = event;
    }
  }
  if (!completed) throw new Error("OpenAI image stream ended without a completed image");
  return {response: completed, partials};
}

// Mock mode: when partials are requested, send the mock image as each partial.
async function sendMockPartials({modelParams, onPartial, imageBuffer}) {
  for (let index = 0; index < (modelParams.partial_images || 0); index++) {
    await sendPartial({onPartial, buffer: imageBuffer, index});
  }
}

async function generateImage({
  prompt,
  model = OPENAI_IMAGE_DEFAULT_MODEL,
  outputPath,
  outputFormat = "jpeg",
  modelParams = {},
  onPartial,
}) {
  if (!prompt) throw new Error("OpenAI image generation requires a prompt");
  if (!outputPath) throw new Error("OpenAI image generation requires an outputPath");

  let imageBuffer;
  let openaiRequest = null;
  if (MOCK_IMAGES.value() === true) {
    const mockImagePath = path.join(path.dirname(new URL(import.meta.url).pathname), "../fal/fal-mock.jpeg");
    imageBuffer = await fs.readFile(mockImagePath);
    await sendMockPartials({modelParams, onPartial, imageBuffer});
  } else {
    const openai = new OpenAI({apiKey: OPENAI_API_KEY.value()});
    const request = buildOpenAiImageRequest({prompt, model, modelParams});
    logger.debug(`Generating image directly with OpenAI model ${model}: ${prompt.substring(0, 100)}`);
    const startedAt = Date.now();
    const {data, response: rawResponse, request_id: requestId} =
      await withOpenAiErrorLogging(() => openai.images.generate(request).withResponse(), model);
    const {response, partials} = request.stream ? await readImageStream({stream: data, onPartial}) : {response: data};
    const completedAt = Date.now();
    const imageBase64 = request.stream ? response.b64_json : response.data?.[0]?.b64_json;
    if (!imageBase64) {
      throw new Error(`OpenAI image response from ${model} did not contain b64_json`);
    }
    imageBuffer = Buffer.from(imageBase64, "base64");
    openaiRequest = {...getOpenAiRequestLog({
      request,
      response,
      rawResponse,
      requestId,
      model,
      startedAt,
      completedAt,
    }), partials};
    logger.info(`OpenAI image request completed: ${JSON.stringify(openaiRequest)}`);
  }

  const uploadResult = await uploadStreamAndGetCDNLink({
    stream: sharpStream({format: outputFormat, sourceStream: Readable.from(imageBuffer)}),
    filename: outputPath,
  });
  return {...uploadResult, openaiRequest};
}

async function editImage({
  prompt,
  inputImageUrl,
  model = OPENAI_IMAGE_DEFAULT_MODEL,
  outputPath,
  outputFormat = "jpeg",
  modelParams = {},
  onPartial,
}) {
  if (!prompt) throw new Error("OpenAI image editing requires a prompt");
  if (!inputImageUrl) throw new Error("OpenAI image editing requires an inputImageUrl");
  if (!outputPath) throw new Error("OpenAI image editing requires an outputPath");

  let imageBuffer;
  let openaiRequest = null;
  if (MOCK_IMAGES.value() === true) {
    const mockImagePath = path.join(path.dirname(new URL(import.meta.url).pathname), "../fal/fal-mock.jpeg");
    imageBuffer = await fs.readFile(mockImagePath);
    await sendMockPartials({modelParams, onPartial, imageBuffer});
  } else {
    const inputResponse = await axios.get(inputImageUrl, {responseType: "arraybuffer"});
    const inputType = inputResponse.headers["content-type"] || "image/jpeg";
    const inputImage = await toFile(Buffer.from(inputResponse.data), "input-image", {type: inputType});
    const openai = new OpenAI({apiKey: OPENAI_API_KEY.value()});
    const request = buildOpenAiImageEditRequest({prompt, image: inputImage, model, modelParams});
    logger.debug(`Editing image directly with OpenAI model ${model}: ${prompt.substring(0, 100)}`);
    const startedAt = Date.now();
    const {data, response: rawResponse, request_id: requestId} =
      await withOpenAiErrorLogging(() => openai.images.edit(request).withResponse(), model);
    const {response, partials} = request.stream ? await readImageStream({stream: data, onPartial}) : {response: data};
    const completedAt = Date.now();
    const imageBase64 = request.stream ? response.b64_json : response.data?.[0]?.b64_json;
    if (!imageBase64) {
      throw new Error(`OpenAI image edit response from ${model} did not contain b64_json`);
    }
    imageBuffer = Buffer.from(imageBase64, "base64");
    openaiRequest = {...getOpenAiRequestLog({
      request,
      response,
      rawResponse,
      requestId,
      model,
      startedAt,
      completedAt,
    }), partials};
    logger.info(`OpenAI image edit request completed: ${JSON.stringify(openaiRequest)}`);
  }

  const uploadResult = await uploadStreamAndGetCDNLink({
    stream: sharpStream({format: outputFormat, sourceStream: Readable.from(imageBuffer)}),
    filename: outputPath,
  });
  return {...uploadResult, openaiRequest};
}

function queueEntryTypeToFunction(entryType) {
  if (entryType === "generate") return generateImage;
  if (entryType === "edit") return editImage;
  if (entryType === "failure") {
    return () => {
      throw new Error("This is a test error");
    };
  }
  throw new Error(`Unknown OpenAI image entry type: ${entryType}`);
}

export {
  buildOpenAiImageRequest,
  buildOpenAiImageEditRequest,
  generateImage,
  editImage,
  queueEntryTypeToFunction,
  OPENAI_IMAGE_DEFAULT_MODEL,
  OPENAI_IMAGE_DEFAULT_PARAMS,
  OPENAI_SCENE_IMAGE_MODEL,
  OPENAI_SCENE_IMAGE_PARAMS,
  OPENAI_STREAMED_SCENE_IMAGE_PARAMS,
};
