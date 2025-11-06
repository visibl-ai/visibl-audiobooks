import ModalClient from "../util/modal.js";
import {MODAL_OUTPAINT_ENDPOINT, MODAL_API_KEY, MODAL_OUTPAINT_STEPS, ENVIRONMENT, MOCK_IMAGES} from "../config/config.js";
import {getPublicLink, getSignedUrl} from "../storage/storage.js";
import path from "path";
import fs from "fs/promises";
import {Readable} from "stream";
import {webpStream} from "../util/sharp.js";
import {uploadStreamAndGetPublicLink} from "../storage/storage.js";
import logger from "../util/logger.js";

/**
 * Outpaints an image using the Modal API
 * @param {Object} request - The request parameters
 * @param {string} request.inputPath - Path to the input image
 * @param {string} request.outputPath - Path where the output image will be saved
 * @param {number} [request.left=0] - Number of pixels to outpaint on the left
 * @param {number} [request.right=0] - Number of pixels to outpaint on the right
 * @param {number} [request.down=0] - Number of pixels to outpaint on the bottom
 * @param {number} [request.up=0] - Number of pixels to outpaint on the top
 * @param {string} [request.outputFormat="jpeg"] - Output image format
 * @param {string} request.prompt - Prompt for the outpainting
 * @param {string} request.resultKey - Key to identify the result
 * @param {string} request.callbackUrl - URL to call when processing is complete
 * @return {Promise<Object>} The result from the Modal API
 */
async function outpaint(request) {
  const {
    inputPath,
    outputPath,
    left=0,
    right=0,
    down=0,
    up=0,
    outputFormat="jpeg",
    prompt,
    resultKey,
    callbackUrl,
    timestamp,
  } = request;

  // Mock outpaint response
  if (MOCK_IMAGES.value() === true) {
    // Read from mock image file in the same directory
    logger.info("Mocking outpaint response");
    const mockImagePath = path.join(path.dirname(new URL(import.meta.url).pathname), "modal-mock.jpeg");
    const mockImageBuffer = await fs.readFile(mockImagePath);
    const stream = Readable.from(mockImageBuffer);
    return await uploadStreamAndGetPublicLink({stream: webpStream({sourceStream: stream}), filename: outputPath});
  }

  // Get public link for inputPath
  const inputPublicLink = await getPublicLink({path: inputPath});

  // Get signed URL for outputPath (expires in 4 hours)
  const {signedUrl, publicUrl} = await getSignedUrl({
    path: outputPath,
    method: "write",
    expires: 1000 * 60 * 60 * 4,
    contentType: "image/webp",
  });

  // Mock outpaint response in development when tunnel is not set
  if (ENVIRONMENT.value() === "development" && !process.env.TUNNEL_APP_URL) {
    logger.info("Mocking outpaint response because tunnel is not set");
    return publicUrl;
  }

  // Send request to Modal for Outpainting
  const modalOutpaintClient = new ModalClient(MODAL_OUTPAINT_ENDPOINT.value(), MODAL_API_KEY.value());
  await modalOutpaintClient.sendRequest({
    input: inputPublicLink,
    output_url: signedUrl,
    prompt,
    left,
    right,
    top: up,
    bottom: down,
    steps: parseInt(MODAL_OUTPAINT_STEPS.value()),
    output_format: outputFormat,
    result_key: resultKey,
    callback_url: callbackUrl,
    timestamp,
  });

  return publicUrl;
}

// We could have imported these with outpaint injected into stability.js, but this is cleaner
const outpaintTall = async (request) => {
  const {inputPath, outputPathWithoutExtension, pixels=384, callbackUrl, resultKey, timestamp} = request;
  return await outpaint({
    inputPath,
    outputPath: `${outputPathWithoutExtension}.9.16.webp`,
    up: pixels,
    down: pixels,
    callbackUrl,
    resultKey,
    timestamp,
  });
};

const outpaintWideAndTall = async (request) => {
  const {inputPath, outputPathWithoutExtension, pixels=384, callbackUrl, resultKey, timestamp} = request;
  return await outpaint({
    inputPath,
    outputPath: `${outputPathWithoutExtension}.16.9.webp`,
    left: pixels,
    right: pixels,
    callbackUrl,
    resultKey,
    timestamp,
  });
};

const queueEntryTypeToFunction = (entryType) => {
  switch (entryType) {
    case "outpaint":
      return outpaint;
    case "outpaintTall":
      return outpaintTall;
    case "outpaintWideAndTall":
      return outpaintWideAndTall;
    case "failure":
      return () => {
        throw new Error("This is a test error");
      };
    default:
      throw new Error(`Unknown entry type: ${entryType}`);
  }
};

export {outpaint, outpaintTall, outpaintWideAndTall, queueEntryTypeToFunction};
