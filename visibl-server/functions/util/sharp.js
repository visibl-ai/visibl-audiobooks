import sharp from "sharp";
import logger from "./logger.js";
import {
  getFileStream,
  uploadStreamAndGetPublicLink,
} from "../storage/storage.js";

/**
 * Converts an image stream to WebP format and returns the transformed stream.
 *
 * @async
 * @function webpStream
 * @param {Object} params - The parameters for the conversion.
 * @param {ReadableStream} params.sourceStream - The source image stream.
 * @param {number} params.quality - The quality of the WebP image (0-100).
 * @return {Promise<ReadableStream>} A promise that resolves with the transformed stream.
 */
function webpStream({sourceStream, quality=90}) {
  return sourceStream.pipe(sharp({failOnError: true}).webp({quality}));
}

/**
 * Converts an image stream to JPG format and returns the transformed stream.
 *
 * @async
 * @function jpgStream
 * @param {Object} params - The parameters for the conversion.
 * @param {ReadableStream} params.sourceStream - The source image stream.
 * @param {number} params.quality - The quality of the JPG image (0-100).
 * @return {Promise<ReadableStream>} A promise that resolves with the transformed stream.
 */
function jpgStream({sourceStream, quality=90}) {
  return sourceStream.pipe(sharp({failOnError: true}).jpeg({quality}));
}

/**
 * Routes image stream conversion based on format.
 *
 * @async
 * @function sharpStream
 * @param {Object} params - The parameters for the conversion.
 * @param {string} params.format - The output format ('jpg' or 'webp'). Defaults to 'webp'.
 * @param {ReadableStream} params.sourceStream - The source image stream.
 * @param {number} params.quality - The quality of the output image (0-100).
 * @return {Promise<ReadableStream>} A promise that resolves with the transformed stream.
 */
function sharpStream({format="webp", sourceStream, quality=90}) {
  if (format === "jpg" || format === "jpeg") {
    return jpgStream({sourceStream, quality});
  } else if (format === "webp") {
    return webpStream({sourceStream, quality});
  } else {
    throw new Error(`Unsupported format: ${format}. Supported formats are 'jpg' and 'webp'.`);
  }
}

/**
 * Compresses an image and returns a public URL.
 * @async
 * @function compressImage
 * @param {Object} params - The parameters for the conversion.
 * @param {string} params.sourceFilePath - The source image file path.
 * @param {string} params.destinationFilePath - The destination image file path.
 * @param {string} params.format - The output format ('jpg' or 'webp'). Defaults to 'webp'.
 * @param {number} params.quality - The quality of the output image (0-100).
 * @return {Promise<string>} A promise that resolves with the public URL of the compressed image.
 */
async function compressImage({sourceFilePath, destinationFilePath, format="webp", quality=90}) {
  const sourceStream = await getFileStream({path: sourceFilePath});
  const publicUrl = await uploadStreamAndGetPublicLink({
    stream: sharpStream({format, sourceStream, quality}),
    filename: destinationFilePath,
  });
  logger.debug(`Compressed image saved to ${publicUrl}`);
  return {publicUrl};
}


export {webpStream, jpgStream, sharpStream, compressImage};
