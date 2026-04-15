import crypto from "crypto";
import logger from "../../util/logger.js";
import {createReadStream} from "fs";
import {fileURLToPath} from "url";
import {dirname, join} from "path";
import axios from "axios";
import {queueGetEntries, queueUpdateEntries, queueSetItemsToError} from "../../storage/firestore/queue.js";
import {uploadStreamAndGetPublicLink} from "../../storage/storage.js";
import {uploadUrlToCloudflare} from "../../storage/cloudflare.js";
import {sharpStream} from "../../util/sharp.js";
import {captureEvent, flushAnalytics} from "../../analytics/index.js";
import {searchBilling} from "./wavespeed.js";
import {wavespeedQueue} from "../queue/wavespeedQueue.js";
import handleSceneImagePostProcessing from "../../storage/realtimeDb/hooks/handleSceneImagePostProcessing.js";
import handleCharacterImagePostProcessing from "../../storage/realtimeDb/hooks/handleCharacterImagePostProcessing.js";
import handleLocationImagePostProcessing from "../../storage/realtimeDb/hooks/handleLocationImagePostProcessing.js";
import handleCoverArtPostProcessing from "../../storage/realtimeDb/hooks/handleCoverArtPostProcessing.js";
import {WAVESPEED_WEBHOOK_SECRET, MOCK_IMAGES} from "../../config/config.js";

/**
 * Verify the Wavespeed webhook signature
 * @param {string} rawBody - The raw request body as a string
 * @param {Object} headers - The request headers
 * @param {string} secret - The webhook secret
 * @param {number} maxAgeSeconds - Maximum age of signature in seconds (default: 300)
 * @return {boolean} Whether the signature is valid
 * @throws {Error} If signature verification fails
 */
function verifyWavespeedSignature(rawBody, headers, secret, maxAgeSeconds = 300) {
  const id = headers["webhook-id"];
  const timestamp = headers["webhook-timestamp"];
  const signatureHeader = headers["webhook-signature"];

  if (!id || !timestamp || !signatureHeader) {
    throw new Error("Missing required webhook headers");
  }

  const parts = signatureHeader.split(",");
  if (parts.length !== 2 || parts[0] !== "v3") {
    throw new Error("Invalid signature header format");
  }
  const receivedSignature = parts[1];

  // Build the signed content string
  const signedContent = `${id}.${timestamp}.${rawBody}`;

  // Remove whsec_ prefix if present
  const keyWithoutPrefix = secret.startsWith("whsec_") ? secret.slice(6) : secret;

  // Generate expected signature
  const expectedSignature = crypto
      .createHmac("sha256", keyWithoutPrefix)
      .update(signedContent)
      .digest("hex");

  // Check timestamp age
  const ageSeconds = Math.abs(Date.now() / 1000 - parseInt(timestamp, 10));
  if (ageSeconds > maxAgeSeconds) {
    throw new Error("Signature timestamp too old");
  }

  // Constant-time comparison
  if (!crypto.timingSafeEqual(Buffer.from(expectedSignature), Buffer.from(receivedSignature))) {
    throw new Error("Invalid signature");
  }

  return true;
}

/**
 * Handle the Wavespeed webhook callback and process it directly
 * @param {Object} req - The request object
 * @param {Object} res - The response object
 * @return {Promise<void>}
 */
async function handleWavespeedCallback(req, res) {
  const entryId = req.query.entryId;

  if (!entryId) {
    logger.error("Wavespeed callback missing entryId query parameter");
    res.status(400).send({success: false, message: "Missing entryId"});
    return;
  }

  // Wavespeed payload: { id, model, input, outputs, status, has_nsfw_contents, created_at, error }
  const payload = req.body;

  if (!payload) {
    logger.error("Wavespeed callback missing body payload");
    res.status(400).send({success: false, message: "Missing payload"});
    return;
  }

  // Verify webhook signature (skip in mock/test mode)
  if (MOCK_IMAGES.value() === false) {
    try {
      const rawBody = req.rawBody?.toString() || JSON.stringify(payload);
      verifyWavespeedSignature(rawBody, req.headers, WAVESPEED_WEBHOOK_SECRET.value());
    } catch (error) {
      logger.error(`Wavespeed webhook signature verification failed: ${error.message}`);
      res.status(401).send({success: false, message: "Invalid signature"});
      return;
    }
  }

  logger.info(`Wavespeed callback received for entry ${entryId}, status: ${payload.status}`);

  // Process the callback directly
  await processWavespeedCallback({entryId, payload});

  res.status(200).send({success: true, message: "Callback processed"});
}

/**
 * Process the Wavespeed webhook callback
 * @param {Object} params - The parameters object
 * @param {string} params.entryId - The queue entry ID
 * @param {Object} params.payload - The Wavespeed webhook payload
 * @return {Promise<void>}
 */
async function processWavespeedCallback({entryId, payload}) {
  const startTime = Date.now();

  try {
    // Get the queue entry
    const entries = await queueGetEntries({id: entryId});
    if (!entries || entries.length === 0) {
      logger.error(`No queue entry found for entryId: ${entryId}`);
      return;
    }

    const entry = entries[0];

    // Check if the task completed successfully
    if (payload.status === "completed" && payload.outputs?.[0]) {
      logger.info(`Processing completed Wavespeed result for entry ${entryId}`);

      const outputPath = entry.params.outputPath || entry.params.outputPathWithoutExtension + ".jpeg";
      const outputFormat = entry.params.outputFormat || "jpeg";
      let result;

      // Check if this is a mock callback (from simulateWavespeedCallbacks in tests)
      const isMockCallback = payload.id?.startsWith("mock-");

      if (isMockCallback) {
        // In mock mode, read the local mock image and save it to storage emulator
        logger.info(`Mock callback detected for entry ${entryId}, using local mock image`);
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = dirname(__filename);
        const mockImagePath = join(__dirname, "wavespeed-mock.jpeg");

        const stream = createReadStream(mockImagePath);

        const gcpUrl = await uploadStreamAndGetPublicLink({
          stream: sharpStream({format: outputFormat, sourceStream: stream}),
          filename: outputPath,
        });

        result = {
          gcpUrl,
          cdnUrl: gcpUrl,
          id: payload.id,
          model: payload.model,
        };
      } else {
        // Fetch image from URL and upload to GCS + Cloudflare in parallel
        // Cloudflare fetches directly from the source URL to avoid buffering through this container
        const imageUrl = payload.outputs[0];
        logger.debug(`Fetching image from URL: ${imageUrl}`);
        const response = await axios.get(imageUrl, {responseType: "stream"});
        const stream = response.data;

        const [gcpUrl, cdnUrl] = await Promise.all([
          uploadStreamAndGetPublicLink({
            stream: sharpStream({format: outputFormat, sourceStream: stream}),
            filename: outputPath,
          }),
          uploadUrlToCloudflare({url: imageUrl}),
        ]);

        result = {
          gcpUrl,
          cdnUrl,
          id: payload.id,
          model: payload.model,
        };
      }

      // Store result in GCS if large (consistent with AIQueue behavior)
      const resultGcsPath = await wavespeedQueue.storeLargeResult({result});
      const storedResult = resultGcsPath ? {resultGcsPath} : result;

      // Handle post-processing hooks
      const resultObj = {result: storedResult};
      if (entry.params?.type === "sceneImage") {
        await handleSceneImagePostProcessing(entry, resultObj);
      } else if (entry.params?.type === "character" || entry.params?.type === "character-profile") {
        await handleCharacterImagePostProcessing(entry, resultObj);
      } else if (entry.params?.type === "location") {
        await handleLocationImagePostProcessing(entry, resultObj);
      } else if (entry.params?.type === "coverArt") {
        await handleCoverArtPostProcessing(entry, resultObj);
      }

      // Mark entry as complete
      await queueUpdateEntries({
        ids: [entry.id],
        queue: [entry],
        results: [{result: storedResult}],
        statuses: ["complete"],
      });

      // Capture analytics
      await captureAnalytics({entry, result, payload, startTime, success: true});

      logger.info(`Successfully processed Wavespeed callback for entry ${entryId}`);
    } else if (payload.status === "failed" || payload.status === "error") {
      const errorMessage = payload.error || "Unknown error";
      logger.error(`Wavespeed task failed for entry ${entryId}: ${errorMessage}`);

      // Handle retry
      const error = new Error(errorMessage);
      const retryResult = await wavespeedQueue.handleRetry({entry, error});

      // If retry didn't handle it, mark as error
      if (!retryResult?.success) {
        await queueSetItemsToError({
          queue: [entry],
          error: errorMessage,
        });
      }

      // Capture analytics for failure
      await captureAnalytics({entry, payload, startTime, success: false, errorMessage});
    } else {
      logger.warn(`Unexpected Wavespeed callback status for entry ${entryId}: ${payload.status}`);
    }
  } catch (error) {
    logger.error(`Error processing Wavespeed callback for entry ${entryId}: ${error.message}`);
  }
}

/**
 * Capture analytics for the Wavespeed callback
 * @param {Object} params - The parameters object
 */
async function captureAnalytics({entry, result, payload, startTime, success, errorMessage}) {
  try {
    const latencyMs = Date.now() - startTime;
    let cost = 0;

    // Get cost from billing if we have a task ID
    if (payload?.id) {
      try {
        const billing = await searchBilling({prediction_uuids: [payload.id]});
        cost = billing?.data?.items?.[0]?.price || 0;
      } catch (billingError) {
        logger.debug(`Could not fetch billing for ${payload.id}: ${billingError.message}`);
      }
    }

    const eventProperties = {
      provider: "wavespeed",
      model: payload?.model || entry.params.model || "wavespeed-ai/flux-kontext-dev/multi",
      traceId: entry.id,
      input: entry.params.prompt,
      output: success && result ? `Generated image: ${JSON.stringify(result)}` : undefined,
      latency: latencyMs,
      success: success,
      error: errorMessage,
      cost: cost,
      entry: entry,
      sku: entry.params.sku,
      uid: entry.params.uid,
      graph_id: entry.params.graphId,
      callbackProcessing: true,
    };

    const distinctId = entry.params.uid || "system";
    await captureEvent("image_generation", eventProperties, distinctId);
    await flushAnalytics().catch((err) => {
      logger.debug(`Analytics flush warning: ${err.message}`);
    });
  } catch (error) {
    logger.debug(`Analytics capture error: ${error.message}`);
  }
}

export {handleWavespeedCallback};
