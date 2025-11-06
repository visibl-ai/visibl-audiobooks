/* eslint-disable require-jsdoc */
import axios from "axios";
import FormData from "form-data";
import logger from "../util/logger.js";
import {
  CLOUDFLARE_ACCOUNT_ID,
  CLOUDFLARE_IMAGES_API_TOKEN,
} from "../config/config.js";
import {isNetworkError} from "../util/errorHelper.js";

/**
 * Converts a readable stream to a buffer
 * @param {Stream} stream - The readable stream to convert
 * @return {Promise<Buffer>} A promise that resolves to a buffer
 */
async function streamToBuffer(stream) {
  const chunks = [];

  return new Promise((resolve, reject) => {
    stream.on("data", (chunk) => {
      chunks.push(chunk);
    });

    stream.on("error", (err) => {
      reject(err);
    });

    stream.on("end", () => {
      resolve(Buffer.concat(chunks));
    });
  });
}

/**
 * Uploads an image to Cloudflare Images with retry logic
 * @param {FormData} formData - The form data containing the image
 * @param {string} variant - The variant to return ('public' or 'thumb')
 * @param {number} retryCount - Current retry attempt
 * @param {number} maxRetries - Maximum number of retries
 * @return {Promise<string>} The Cloudflare CDN URL
 */
async function uploadToCloudflareWithRetry(formData, variant = "public", retryCount = 0, maxRetries = 3) {
  const accountId = CLOUDFLARE_ACCOUNT_ID.value();
  const apiToken = CLOUDFLARE_IMAGES_API_TOKEN.value();

  if (!accountId || !apiToken) {
    throw new Error("Cloudflare configuration missing: CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_IMAGES_API_TOKEN not set");
  }

  const apiUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/images/v1`;

  try {
    const response = await axios.post(apiUrl, formData, {
      headers: {
        "Authorization": `Bearer ${apiToken}`,
        ...formData.getHeaders(),
      },
      timeout: 30000, // 30 second timeout
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    });

    if (response.data && response.data.success && response.data.result) {
      const imageId = response.data.result.id;
      const variants = response.data.result.variants;

      // Look for the requested variant URL
      const selectedVariant = variants.find((url) => url.includes(`/${variant}`)) || variants[0];

      if (!selectedVariant) {
        throw new Error(`No ${variant} variant found in Cloudflare response`);
      }

      logger.debug(`Cloudflare Images upload successful: ${imageId}, Variant: ${variant}, URL: ${selectedVariant}`);
      return selectedVariant;
    } else {
      throw new Error(`Cloudflare API error: ${JSON.stringify(response.data)}`);
    }
  } catch (error) {
    // Check if this is a retryable error
    const isRetryable = isNetworkError(error) ||
      error.code === "ETIMEDOUT" ||
      error.code === "ESOCKETTIMEDOUT" ||
      (error.response && error.response.status >= 500 && error.response.status < 600);

    if (isRetryable && retryCount < maxRetries) {
      const backoffDelay = Math.min(1000 * Math.pow(2, retryCount), 10000); // Cap at 10 seconds
      logger.warn(`Cloudflare upload error (attempt ${retryCount + 1}/${maxRetries + 1}): ${error.message}. Retrying in ${backoffDelay}ms`);

      await new Promise((resolve) => setTimeout(resolve, backoffDelay));
      return uploadToCloudflareWithRetry(formData, variant, retryCount + 1, maxRetries);
    }

    // Log detailed error information
    if (error.response) {
      logger.error(`Cloudflare API response error - Status: ${error.response.status}, Data: ${JSON.stringify(error.response.data)}`);
    } else {
      logger.error(`Cloudflare upload error: ${error.message}`);
    }

    throw error;
  }
}

/**
 * Uploads a stream to Cloudflare Images
 * @param {Stream} stream - The image stream to upload
 * @param {string} filename - The filename for the image
 * @param {string} [variant='public'] - The variant to return ('public' or 'thumb')
 * @return {Promise<string>} The Cloudflare CDN URL
 */
async function uploadStreamToCloudflare(stream, filename, variant = "public") {
  try {
    // Convert stream to buffer
    const buffer = await streamToBuffer(stream);

    // Create form data
    const formData = new FormData();
    formData.append("file", buffer, {
      filename: filename,
      contentType: "image/jpeg", // Default to JPEG, Cloudflare will handle conversion
    });

    // Optional: Add metadata
    // formData.append("metadata", JSON.stringify({ source: "visibl-server" }));

    // Upload with retry logic
    return await uploadToCloudflareWithRetry(formData, variant);
  } catch (error) {
    logger.error(`Failed to upload to Cloudflare Images: ${error.message}`);
    throw error;
  }
}

/**
 * Uploads an image to Cloudflare Images from a URL
 * @param {Object} params - Upload parameters
 * @param {string} params.url - The URL of the image to upload
 * @param {string} [params.variant='public'] - The variant to return ('public' or 'thumb')
 * @param {number} [params.retryCount=0] - Current retry attempt (internal use)
 * @param {number} [params.maxRetries=3] - Maximum number of retries
 * @return {Promise<string>} The Cloudflare CDN URL
 */
async function uploadUrlToCloudflare({url, variant = "public", retryCount = 0, maxRetries = 3}) {
  const accountId = CLOUDFLARE_ACCOUNT_ID.value();
  const apiToken = CLOUDFLARE_IMAGES_API_TOKEN.value();

  if (!accountId || !apiToken) {
    throw new Error("Cloudflare configuration missing: CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_IMAGES_API_TOKEN not set");
  }

  const apiUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/images/v1`;

  try {
    // Create form data with the URL
    const formData = new FormData();
    formData.append("url", url);

    const response = await axios.post(apiUrl, formData, {
      headers: {
        "Authorization": `Bearer ${apiToken}`,
        ...formData.getHeaders(),
      },
      timeout: 60000, // 60 second timeout for URL uploads (they need to download the image first)
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    });

    if (response.data && response.data.success && response.data.result) {
      const imageId = response.data.result.id;
      const variants = response.data.result.variants;

      // Look for the requested variant URL
      const selectedVariant = variants.find((url) => url.includes(`/${variant}`)) || variants[0];

      if (!selectedVariant) {
        throw new Error(`No ${variant} variant found in Cloudflare response`);
      }

      logger.debug(`Cloudflare Images URL upload successful: ${imageId}, Variant: ${variant}, URL: ${selectedVariant}`);
      return selectedVariant;
    } else {
      throw new Error(`Cloudflare API error: ${JSON.stringify(response.data)}`);
    }
  } catch (error) {
    // Check if this is a retryable error
    const isRetryable = isNetworkError(error) ||
      error.code === "ETIMEDOUT" ||
      error.code === "ESOCKETTIMEDOUT" ||
      (error.response && error.response.status >= 500 && error.response.status < 600);

    if (isRetryable && retryCount < maxRetries) {
      const backoffDelay = Math.min(1000 * Math.pow(2, retryCount), 10000); // Cap at 10 seconds
      logger.warn(`Cloudflare URL upload error (attempt ${retryCount + 1}/${maxRetries + 1}): ${error.message}. Retrying in ${backoffDelay}ms`);

      await new Promise((resolve) => setTimeout(resolve, backoffDelay));
      return uploadUrlToCloudflare({url, variant, retryCount: retryCount + 1, maxRetries});
    }

    // Log detailed error information
    if (error.response) {
      logger.error(`Cloudflare API response error - Status: ${error.response.status}, Data: ${JSON.stringify(error.response.data)}`);
    } else {
      logger.error(`Cloudflare URL upload error: ${error.message}`);
    }

    throw error;
  }
}

export {
  uploadStreamToCloudflare,
  uploadUrlToCloudflare,
  streamToBuffer,
  uploadToCloudflareWithRetry,
};
