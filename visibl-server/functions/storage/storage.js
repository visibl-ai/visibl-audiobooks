/* eslint-disable require-jsdoc */
import {getStorage, getDownloadURL} from "firebase-admin/storage";
import logger from "../util/logger.js";
import {STORAGE_BUCKET_ID, ENVIRONMENT} from "../config/config.js";
import fs from "fs/promises";
import axios from "axios";
import path from "path";
import app from "../firebase.js";
import {storeSceneInCacheFromMemory} from "./realtimeDb/scenesCache.js";
// import {catalogueGetFirestore} from "./firestore/catalogue.js";
import {catalogueGetRtdb} from "./realtimeDb/catalogue.js";
import {isNetworkError} from "../util/errorHelper.js";
import {uploadStreamToCloudflare} from "./cloudflare.js";
import {PassThrough} from "stream";

// Get a reference to the default storage bucket

/**
 * Creates a folder in the default Firestore bucket with the name based on the UID
 * @param {Object} params - must contain uid
 */
async function createUserFolder(params) {
  const {uid} = params;
  const bucket = getStorage(app).bucket(STORAGE_BUCKET_ID.value());
  const folderPath = `UserData/${uid}/`; // Folder path in the bucket
  const file = bucket.file(folderPath + ".placeholder"); // Create a placeholder file to establish the folder

  try {
    await file.save("Placeholder content", {
      metadata: {
        contentType: "text/plain",
      },
    });
    logger.debug(`Folder created with path: ${folderPath}`);
    return `${folderPath}`;
  } catch (error) {
    logger.error(`Error creating folder for user ${uid}:`, error);
    return null;
  }
}

/**
 * Creates a folder in the default Firestore bucket with the name based on the catalogueId
 * @param {Object} params - must contain catalogueId
 */
async function createCatalogueFolder(params) {
  const {catalogueId} = params;
  const bucket = getStorage(app).bucket(STORAGE_BUCKET_ID.value());
  const folderPath = `Catalogue/${catalogueId}/`;
  const file = bucket.file(folderPath + ".placeholder");

  try {
    await file.save("Placeholder content", {
      metadata: {
        contentType: "text/plain",
      },
    });
    logger.debug(`Catalogue folder created with path: ${folderPath}`);
    return folderPath;
  } catch (error) {
    logger.error(`Error creating folder for catalogue ${catalogueId}:`, error);
    return null;
  }
}


/**
 * Checks if a file exists in storage given the UID, path an filename
 * @param {Object} params - must contain path
 */
async function fileExists(params) {
  const {path} = params;
  const bucket = getStorage(app).bucket(STORAGE_BUCKET_ID.value());
  const file = bucket.file(path);
  const [exists] = await file.exists();
  return exists;
}

/**
 * Deletes a file from the storage bucket
 * @param {Object} params - must contain uid, path, filename
 */
async function deleteFile({path}) {
  try {
    const bucket = getStorage(app).bucket(STORAGE_BUCKET_ID.value());
    const file = bucket.file(path);
    await file.delete();
    return true;
  } catch (error) {
    logger.error(`deleteFile: Error deleting file ${path}:`, error);
    return false;
  }
}

const getFileStream = async (params) => {
  const {path} = params;
  const bucket = getStorage(app).bucket(STORAGE_BUCKET_ID.value());
  const file = bucket.file(path);
  const [exists] = await file.exists();
  if (!exists) {
    throw new Error(`File ${path} does not exist`);
  }
  return file.createReadStream();
};

const makeFilePublic = async (params) => {
  const {path} = params;
  const bucket = getStorage(app).bucket(STORAGE_BUCKET_ID.value());
  const file = bucket.file(path);
  await file.makePublic();
  return file.publicUrl();
};

const uploadStreamAndGetPublicLink = async (params) => {
  const {stream, filename} = params;
  const bucket = getStorage(app).bucket(STORAGE_BUCKET_ID.value());
  const file = bucket.file(filename);
  const blobStream = file.createWriteStream();
  stream.pipe(blobStream);
  return new Promise((resolve, reject) => {
    blobStream.on("error", (err) => {
      logger.error("Error uploading file to GCP: " + err);
      reject(err);
    });
    blobStream.on("finish", async () => {
      // Make the file public
      await file.makePublic().catch((err) => {
        logger.error("Error making file public: " + err);
        reject(err);
      });

      // If in development and upload proxy tunnel is available, use the upload proxy URL
      if (ENVIRONMENT.value() === "development" && process.env.TUNNEL_STORAGE_PROXY_URL) {
        const publicUrl = `${process.env.TUNNEL_STORAGE_PROXY_URL}/download/${filename}`;
        resolve(publicUrl);
        return;
      }

      // Now the file is public, construct the public URL
      // const publicUrl = `https://storage.googleapis.com/${STORAGE_BUCKET_ID.value()}/${filename}`;
      const publicUrl = await getPublicLink({path: filename});
      resolve(publicUrl);
    });
  });
};

/**
 * Uploads a stream to both GCS and Cloudflare Images, returns both URLs
 * @param {Object} params - must contain stream, filename
 * @return {Promise<Object>} Object containing both gcpUrl and cdnUrl
 */
const uploadStreamAndGetCDNLink = async (params) => {
  const {stream, filename} = params;

  // Create two PassThrough streams to split the input stream
  const passThrough1 = new PassThrough();
  const passThrough2 = new PassThrough();

  // Pipe the input stream to both PassThrough streams
  stream.pipe(passThrough1);
  stream.pipe(passThrough2);

  try {
    // Upload to both GCS and Cloudflare in parallel
    const [gcpUrl, cloudflareUrl] = await Promise.all([
      uploadStreamAndGetPublicLink({stream: passThrough1, filename}),
      uploadStreamToCloudflare(passThrough2, filename),
    ]);

    logger.debug(`Successfully uploaded to both GCS and Cloudflare - GCP: ${gcpUrl}, CDN: ${cloudflareUrl}`);

    // Return both URLs
    return {
      gcpUrl: gcpUrl,
      cdnUrl: cloudflareUrl,
    };
  } catch (error) {
    logger.error(`Error in uploadStreamAndGetCDNLink: ${error.message}`);

    // If Cloudflare fails but GCS succeeds, we could fall back to GCS
    // But for now, we'll throw the error to handle it upstream
    throw error;
  }
};

/**
 * Gets the public link for a file in the storage bucket
 * @param {Object} params - must contain path
 * @return {Promise<string>} A promise that resolves to the public link
 */
const getPublicLink = async (params) => {
  const {path} = params;
  const bucket = getStorage(app).bucket(STORAGE_BUCKET_ID.value());
  const file = bucket.file(path);
  const [exists] = await file.exists();
  if (!exists) {
    throw new Error(`File ${path} does not exist`);
  }

  const publicUrl = file.publicUrl();

  // If in development and upload proxy tunnel is available, use the upload proxy URL
  if (ENVIRONMENT.value() === "development" && process.env.TUNNEL_STORAGE_PROXY_URL) {
    return `${process.env.TUNNEL_STORAGE_PROXY_URL}/download/${path}`;
  }

  return publicUrl;
};


/**
 * Gets a signed URL for a file in the storage bucket
 * @param {Object} params - must contain path
 * @param {string} [params.method="read"] - the method to use for the signed URL
 * @param {number} [params.expires=1000 * 60 * 60 * 24] - the number of milliseconds the signed URL will be valid for
 * @param {string} [params.contentType] - the content type of the file
 * @return {Promise<Object>} A promise that resolves to the signed URL and public URL
 */
const getSignedUrl = async ({path, method="read", expires=1000 * 60 * 60 * 24, contentType}) => {
  const storage = getStorage(app);
  if (method === "write" && !contentType) {
    throw new Error("contentType is required for write method");
  }

  // Create the file reference early so it can be used in development mode
  const bucket = storage.bucket(STORAGE_BUCKET_ID.value());
  const file = bucket.file(path);

  // In development, we don't sign the URL, we use the storage proxy
  // Storage proxy URL is required in development for this to work
  if (ENVIRONMENT.value() === "development") {
    if (process.env.TUNNEL_STORAGE_PROXY_URL) {
      let storageProxyUrl;
      if (method === "write") {
        storageProxyUrl = `${process.env.TUNNEL_STORAGE_PROXY_URL}/upload/${path}`;
      } else {
        storageProxyUrl = `${process.env.TUNNEL_STORAGE_PROXY_URL}/download/${path}`;
      }
      return {signedUrl: storageProxyUrl, publicUrl: storageProxyUrl};
    }
    return {signedUrl: file.publicUrl(), publicUrl: file.publicUrl()};
  }

  // Actually get the signed URL
  const [url] = await file.getSignedUrl({action: method, expires: Date.now() + expires, contentType});
  return {signedUrl: url, publicUrl: file.publicUrl()};
};

/**
 * Stores JSON data as a file in the storage bucket
 * @param {Object} params - must contain filename, data
 * @param {Object} [params.metadata] - optional metadata to set on the file
 * @param {number} [params.retryCount] - internal retry counter
 * @param {number} [params.maxRetries] - maximum number of retries
 * @return {Promise<void>} A promise that resolves when the file is stored
 */
async function storeJsonFile(params) {
  const {filename, data, metadata={}, retryCount = 0, maxRetries = 3} = params;
  const bucket = getStorage(app).bucket(STORAGE_BUCKET_ID.value());
  const file = bucket.file(filename);
  let jsonString;
  try {
    jsonString = JSON.stringify(data, null, 2);
  } catch (error) {
    logger.error(`Error parsing JSON for ${filename}`);
    jsonString = data;
  }
  const buffer = Buffer.from(jsonString);

  // Prepare save options with metadata included to make it atomic
  const saveOptions = {
    contentType: "application/json",
    resumable: false, // Disable resumable for JSON files (they're usually small)
    validation: false, // Disable validation to speed up uploads
  };

  // Include metadata in the initial save if provided
  if (metadata && Object.keys(metadata).length > 0) {
    saveOptions.metadata = metadata;
  }

  try {
    await file.save(buffer, saveOptions);
    return filename;
  } catch (err) {
    // Check if this is a network error or metadata conflict that should be retried
    const isRetryableError =
      isNetworkError(err) ||
      err.code === "EPIPE" ||
      err.code === "ECONNRESET" ||
      err.code === "ETIMEDOUT" ||
      err.code === "ESOCKETTIMEDOUT" ||
      (err.message && (
        err.message.includes("metadata") && err.message.includes("edited during the operation") ||
        err.message.includes("timeout") ||
        err.message.includes("EPIPE")
      ));

    if (isRetryableError && retryCount < maxRetries) {
      const baseDelay = Math.min(1000 * Math.pow(2, retryCount), 5000); // Cap at 5 seconds
      const jitter = Math.random() * 1000; // Add 0-1000ms random jitter
      const backoffDelay = baseDelay + jitter;

      const errorType = err.code || (err.message?.includes("metadata") ? "metadata conflict" : "network error");
      logger.warn(`${errorType} uploading JSON to GCP (attempt ${retryCount + 1}/${maxRetries + 1}): ${err.message || err}. Retrying in ${Math.round(backoffDelay)}ms for file: ${filename}`);

      await new Promise((resolve) => setTimeout(resolve, backoffDelay));
      return storeJsonFile({
        filename,
        data,
        metadata,
        retryCount: retryCount + 1,
        maxRetries,
      });
    }

    logger.error(`Error uploading JSON to GCP (file: ${filename}): ${err}`);
    throw err;
  }
}

/**
 * Retrieves scene data as a JSON file from the storage bucket
 * @param {Object} params - must contain sku
 * @return {Promise<Object>} A promise that resolves to the parsed JSON data
 */
async function getCatalogueDefaultScene(params) {
  const {sku} = params;
  const filename = await getDefaultSceneFilename({sku});
  return getJsonFile({filename});
}

async function getDefaultSceneFilename(params) {
  let {sku, defaultSceneId} = params;
  if (!defaultSceneId) {
    const catalogueItem = await catalogueGetRtdb({sku});
    defaultSceneId = catalogueItem.defaultSceneId;
  }
  return `Scenes/${defaultSceneId}/scenes.json`;
}

function getSceneFilename(sceneId) {
  return `Scenes/${sceneId}/scenes.json`;
}

async function getScene(params) {
  const {sceneId} = params;
  const filename = getSceneFilename(sceneId);
  return getJsonFile({filename});
}

async function deleteSceneFiles(params) {
  const {sceneId, styleId} = params;
  const bucket = getStorage(app).bucket(STORAGE_BUCKET_ID.value());
  const prefix = `Scenes/${sceneId}/`;
  const [files] = await bucket.getFiles({prefix});
  await Promise.all(
      files
          .filter((file) => !styleId || file.name.includes(styleId))
          .map((file) => file.delete()),
  );

  return {
    id: sceneId,
    styleId,
    isDeleted: true,
    filesDeleted: files.length,
  };
}

/**
 * Stores scene data as a JSON file in the storage bucket
 * @param {Object} params - must contain sceneId, sceneData
 * @return {Promise<void>} A promise that resolves when the file is stored
 */
async function storeScenes(params) {
  const {sceneId, sceneData} = params;
  if (sceneId === undefined) {
    throw new Error("storeScenes: sceneId is required");
  }

  await storeSceneInCacheFromMemory({sceneId, sceneData});

  const filename = `Scenes/${sceneId}/scenes.json`;
  return storeJsonFile({filename, data: sceneData});
}


/**
 * Retrieves and parses a JSON file from the storage bucket
 * @param {Object} params - must contain filename, optional retryCount and maxRetries
 * @param {string} params.filename - The name/path of the file to retrieve
 * @param {number} params.retryCount - Current retry attempt (internal use)
 * @param {number} params.maxRetries - Maximum number of retries (default: 3)
 * @return {Promise<Object>} A promise that resolves to the parsed JSON data
 */
async function getJsonFile(params) {
  const {filename, retryCount = 0, maxRetries = 3} = params;
  const bucket = getStorage(app).bucket(STORAGE_BUCKET_ID.value());
  const file = bucket.file(filename);

  return new Promise((resolve, reject) => {
    // Set a timeout for the download operation
    const downloadTimeout = setTimeout(() => {
      const timeoutError = new Error(`Download timeout after 30 seconds for file: ${filename}`);
      timeoutError.code = "ETIMEDOUT";

      // Check if this should be retried
      if (retryCount < maxRetries) {
        const backoffDelay = Math.min(1000 * Math.pow(2, retryCount), 10000); // Cap at 10 seconds
        logger.warn(`Download timeout for JSON from GCP (attempt ${retryCount + 1}/${maxRetries + 1}): ${filename}. Retrying in ${backoffDelay}ms`);

        setTimeout(() => {
          getJsonFile({filename, retryCount: retryCount + 1, maxRetries})
              .then(resolve)
              .catch(reject);
        }, backoffDelay);
      } else {
        logger.error("Download timeout for JSON from GCP: " + timeoutError.message);
        reject(timeoutError);
      }
    }, 30000); // 30 second timeout

    file.download((err, contents) => {
      clearTimeout(downloadTimeout); // Clear timeout on completion

      if (err) {
        if (isNetworkError(err) && retryCount < maxRetries) {
          const backoffDelay = Math.min(1000 * Math.pow(2, retryCount), 10000); // Cap at 10 seconds
          logger.warn(`Network error downloading JSON from GCP (attempt ${retryCount + 1}/${maxRetries + 1}): ${err.message}. Retrying in ${backoffDelay}ms`);

          setTimeout(() => {
            getJsonFile({filename, retryCount: retryCount + 1, maxRetries})
                .then(resolve)
                .catch(reject);
          }, backoffDelay);
        } else {
          logger.warn("Error downloading JSON from GCP - may not exist: " + err);
          reject(err);
        }
      } else {
        try {
          // const currentTime = Date.now();
          const sceneData = JSON.parse(contents.toString());
          // logger.debug(`Time to parse JSON from getJsonFile: ${Date.now() - currentTime}ms`);
          resolve(sceneData);
        } catch (parseError) {
          logger.error("Error parsing JSON: " + parseError);
          reject(parseError);
        }
      }
    });
  });
}

async function getFileString(params) {
  const {path, retryCount = 0, maxRetries = 3} = params;
  const bucket = getStorage(app).bucket(STORAGE_BUCKET_ID.value());
  const file = bucket.file(path);

  try {
    const [contents] = await file.download();
    return contents.toString();
  } catch (err) {
    if (isNetworkError(err) && retryCount < maxRetries) {
      const backoffDelay = Math.min(1000 * Math.pow(2, retryCount), 10000); // Cap at 10 seconds
      logger.warn(`Network error downloading file string from GCP (attempt ${retryCount + 1}/${maxRetries + 1}): ${err.message}. Retrying in ${backoffDelay}ms`);

      await new Promise((resolve) => setTimeout(resolve, backoffDelay));
      return getFileString({path, retryCount: retryCount + 1, maxRetries});
    } else {
      logger.error(`Error downloading file string from GCP: ${err}`);
      throw err;
    }
  }
}

async function downloadFileFromBucket(params) {
  const {bucketPath, localPath, retryCount = 0, maxRetries = 3} = params;
  const bucket = getStorage(app).bucket(STORAGE_BUCKET_ID.value());
  const file = bucket.file(bucketPath);

  // Ensure the directory exists
  await fs.mkdir(path.dirname(localPath), {recursive: true});

  try {
    // Download the file
    return await file.download({destination: localPath});
  } catch (err) {
    if (isNetworkError(err) && retryCount < maxRetries) {
      const backoffDelay = Math.min(1000 * Math.pow(2, retryCount), 10000); // Cap at 10 seconds
      logger.warn(`Network error downloading file from bucket (attempt ${retryCount + 1}/${maxRetries + 1}): ${err.message}. Retrying in ${backoffDelay}ms`);

      await new Promise((resolve) => setTimeout(resolve, backoffDelay));
      return downloadFileFromBucket({bucketPath, localPath, retryCount: retryCount + 1, maxRetries});
    } else {
      logger.error(`Error downloading file from bucket: ${err}`);
      throw err;
    }
  }
}

async function deleteLocalFiles(localPaths) {
  await Promise.all(localPaths.map((localPath) =>
    fs.unlink(localPath).catch((error) => {
      // Only log if it's not a "file not found" error
      if (error.code !== "ENOENT") {
        logger.error(`Error deleting file ${localPath}:`, error);
      }
    }),
  ));
}

async function uploadFileToBucket(params) {
  const {localPath, bucketPath, content, contentType = "application/octet-stream", retryCount = 0, maxRetries = 3} = params;
  const bucket = getStorage(app).bucket(STORAGE_BUCKET_ID.value());

  try {
    let uploadResponse;

    if (content) {
      // Upload content directly
      const file = bucket.file(bucketPath);
      await file.save(content, {
        contentType: contentType,
        metadata: {
          cacheControl: "no-cache",
        },
        timeout: 300000, // 5 minutes timeout for larger files
        resumable: true,
      });
      logger.debug(`uploadFileToBucket: Uploaded content to ${bucketPath} with content type ${contentType}`);
      return file;
    }
    if (localPath) {
      // Upload from local file path with timeout and resumable settings
      [uploadResponse] = await bucket.upload(localPath, {
        destination: bucketPath,
        timeout: 300000, // 5 minutes timeout for larger files
        resumable: true, // Enable resumable uploads for file uploads
        validation: false, // Disable validation to speed up uploads
        metadata: {
          cacheControl: "no-cache",
        },
      });
      logger.debug(`uploadFileToBucket: Upload response for ${localPath} to ${bucketPath}: ${uploadResponse.name}`);
      return uploadResponse;
    }
    throw new Error("Either 'content' or 'localPath' must be provided");
  } catch (error) {
    // Check if this is a retriable error
    const isRetryable = isNetworkError(error) ||
      error.code === "ETIMEDOUT" ||
      error.code === "ESOCKETTIMEDOUT" ||
      error.message?.includes("timeout") ||
      error.message?.includes("408");

    if (isRetryable && retryCount < maxRetries) {
      const backoffDelay = Math.min(1000 * Math.pow(2, retryCount), 10000); // Cap at 10 seconds
      logger.warn(`Upload error for ${bucketPath} (attempt ${retryCount + 1}/${maxRetries + 1}): ${error.message}. Retrying in ${backoffDelay}ms`);

      await new Promise((resolve) => setTimeout(resolve, backoffDelay));
      return uploadFileToBucket({
        ...params,
        retryCount: retryCount + 1,
        maxRetries,
      });
    }

    logger.error(`Error uploading to ${bucketPath}:`, error);
    throw error;
  }
}

async function uploadJsonToBucket(params) {
  const {json, bucketPath, retryCount = 0, maxRetries = 3} = params;
  const bucket = getStorage(app).bucket(STORAGE_BUCKET_ID.value());
  const file = bucket.file(bucketPath);
  const jsonString = JSON.stringify(json);
  logger.debug(`uploadJsonToBucket: Uploading JSON to ${bucketPath}: ${jsonString.substring(0, 100)}`);

  try {
    // Include metadata in the initial save to make it atomic
    await file.save(jsonString, {
      contentType: "application/json",
      metadata: {
        cacheControl: "no-cache",
      },
    });
    return file;
  } catch (error) {
    // Check if this is a metadata conflict error and retry if so
    if (error.message && error.message.includes("metadata") && error.message.includes("edited during the operation")) {
      if (retryCount < maxRetries) {
        const baseDelay = Math.min(1000 * Math.pow(2, retryCount), 5000); // Cap at 5 seconds
        const jitter = Math.random() * 1000; // Add 0-1000ms random jitter
        const backoffDelay = baseDelay + jitter;
        logger.warn(`Metadata conflict uploading JSON to ${bucketPath} (attempt ${retryCount + 1}/${maxRetries + 1}): ${error.message}. Retrying in ${Math.round(backoffDelay)}ms`);

        await new Promise((resolve) => setTimeout(resolve, backoffDelay));
        return uploadJsonToBucket({
          json,
          bucketPath,
          retryCount: retryCount + 1,
          maxRetries,
        });
      } else {
        logger.error(`Max retries exceeded for metadata conflict on ${bucketPath}: ${error.message}`);
      }
    }

    logger.error(`Error uploading JSON to ${bucketPath}:`, error);
    throw error;
  }
}

async function copyFile(params) {
  const {sourcePath, destinationPath} = params;
  const bucket = getStorage(app).bucket(STORAGE_BUCKET_ID.value());
  const sourceFile = bucket.file(sourcePath);
  const destinationFile = bucket.file(destinationPath);
  await sourceFile.copy(destinationFile);
  return destinationFile;
}

async function getPublicUrl(params) {
  const {path} = params;
  const bucket = getStorage(app).bucket(STORAGE_BUCKET_ID.value());
  const file = bucket.file(path);

  try {
    if (ENVIRONMENT.value() === "development") {
      if (process.env.TUNNEL_STORAGE_PROXY_URL) {
        logger.debug(`getPublicLink: Using development proxy URL for ${process.env.TUNNEL_STORAGE_PROXY_URL}`);
        return `${process.env.TUNNEL_STORAGE_PROXY_URL}/download/${path}`;
      }
      return file.publicUrl();
    }
    return await getDownloadURL(file);
  } catch (error) {
    logger.error(`Error getting download URL for ${path}`);
    throw error;
  }
}

async function getTranscriptions(params) {
  // eslint-disable-next-line no-unused-vars
  const {uid, sku, visibility} = params;
  let filename;
  if (uid === "admin") {
    filename = `Catalogue/Processed/${sku}/${sku}-transcriptions.json`;
  } else {
    filename = `UserData/${uid}/Uploads/Processed/${sku}/${sku}-transcriptions.json`;
  }
  return await getJsonFile({filename});
}

/**
 * Stores a graph JSON file in storage.
 * @param {Object} params - Parameters for storing the graph.
 * @param {string} params.sku - The SKU identifier.
 * @param {Object} params.data - The JSON data to store.
 * @param {string} params.type - The type of graph (e.g., "entity", "scene").
 * @param {string} params.graphId - The unique graph ID.
 * @param {number} [params.chapter] - Optional chapter number for chapter-specific graphs.
 * @return {Promise<Object>} The result of storing the JSON file.
 */
async function storeGraph(params) {
  const {sku, data, type, graphId, chapter} = params;
  if (!graphId || !type || !sku) {
    throw new Error("storeGraph: graphId is required");
  }
  let filename;
  if (chapter !== undefined) {
    filename = `Graphs/${graphId}/${sku}-${type}-${chapter}.json`;
  } else {
    filename = `Graphs/${graphId}/${sku}-${type}.json`;
  }
  return await storeJsonFile({filename, data});
}


/**
 * Retrieves a graph JSON file from storage.
 * @param {Object} params - Parameters for retrieving the graph.
 * @param {string} params.sku - The SKU identifier.
 * @param {string} params.type - The type of graph (e.g., "entity", "scene").
 * @param {string} params.graphId - The unique graph ID.
 * @param {number} [params.chapter] - Optional chapter number for chapter-specific graphs.
 * @return {Promise<Object>} The parsed JSON content of the graph file.
 */
async function getGraph(params) {
  const {sku, type, graphId, chapter} = params;
  let filename;
  if (chapter !== undefined) {
    filename = `Graphs/${graphId}/${sku}-${type}-${chapter}.json`;
  } else {
    filename = `Graphs/${graphId}/${sku}-${type}.json`;
  }
  return await getJsonFile({filename});
}

// Download an image from a URL and upload it to GCP.
// Returns the public URL.
async function downloadImage(url, filename, retryCount = 0, maxRetries = 3) {
  try {
    const response = await axios({
      method: "GET",
      url: url,
      responseType: "stream",
      timeout: 30000, // 30 second timeout
    });
    return uploadStreamAndGetPublicLink({stream: response.data, filename}).then(async (publicUrl) => {
      logger.debug("uploaded to GCP, publicURL is = " + publicUrl);
      return publicUrl;
    }).catch((err) => {
      logger.error("Error uploading file:", err);
      return "";
    });
  } catch (err) {
    if (isNetworkError(err) && retryCount < maxRetries) {
      const backoffDelay = Math.min(1000 * Math.pow(2, retryCount), 10000); // Cap at 10 seconds
      logger.warn(`Network error downloading image (attempt ${retryCount + 1}/${maxRetries + 1}): ${err.message}. Retrying in ${backoffDelay}ms`);

      await new Promise((resolve) => setTimeout(resolve, backoffDelay));
      return downloadImage(url, filename, retryCount + 1, maxRetries);
    } else {
      logger.error("Error downloading image:", err);
      return "";
    }
  }
}

/**
 * Get files from storage bucket by prefix
 * @param {Object} params
 * @param {string} params.prefix - The prefix path to search for files
 * @return {Promise<Array>} Array of file objects from the bucket
 */
async function getFilesByPrefix(params) {
  const {prefix} = params;
  const bucket = getStorage(app).bucket(STORAGE_BUCKET_ID.value());
  const [files] = await bucket.getFiles({prefix});
  return files;
}


export {
  createUserFolder,
  createCatalogueFolder,
  fileExists,
  deleteFile,
  uploadStreamAndGetPublicLink,
  uploadStreamAndGetCDNLink,
  getFileStream,
  storeScenes,
  getCatalogueDefaultScene,
  getScene,
  deleteSceneFiles,
  downloadFileFromBucket,
  uploadFileToBucket,
  getJsonFile,
  storeJsonFile,
  getFileString,
  uploadJsonToBucket,
  copyFile,
  getPublicUrl,
  getDefaultSceneFilename,
  getSceneFilename,
  getTranscriptions,
  storeGraph,
  getGraph,
  downloadImage,
  deleteLocalFiles,
  getFilesByPrefix,
  getPublicLink,
  getSignedUrl,
  makeFilePublic,
};
