/* eslint-disable require-jsdoc */
import {onCall, onRequest} from "firebase-functions/v2/https";
import {validateOnCallAuth, validateOnRequestAdmin} from "../auth/auth.js";
import logger from "../util/logger.js";
import {firebaseFnConfig, firebaseHttpFnConfig} from "../config/config.js";

import {
  catalogueAddRtdb,
  catalogueGetAllRtdb,
  catalogueUpdateRtdb,
  catalogueDeleteRtdb,
  // catalogueMigrate,
  // catalogueGetItemRtdb,
} from "../storage/realtimeDb/catalogue.js";
import CatalogueProgressTracker from "../storage/realtimeDb/CatalogueProgressTracker.js";

import {
  dispatchTask,
} from "../util/dispatch.js";

import {createShareableClip} from "../util/shareableContent.js";

export const v1adminCatalogueGet = onRequest(firebaseHttpFnConfig, async (req, res) => {
  await validateOnRequestAdmin(req);
  res.status(200).send(await catalogueGetAllRtdb({visibility: req.body.visibility}));
});

export const v1catalogueAdd = onRequest(firebaseHttpFnConfig, async (req, res) => {
  await validateOnRequestAdmin(req);
  res.status(200).send(await catalogueAddRtdb(req));
});

export const v1catalogueGet = onCall(firebaseFnConfig, async (context) => {
  // eslint-disable-next-line no-unused-vars
  const {uid, data} = await validateOnCallAuth(context);
  return catalogueGetAllRtdb(data);
});

export const v1catalogueDelete = onRequest(firebaseHttpFnConfig, async (req, res) => {
  await validateOnRequestAdmin(req);
  res.status(200).send(await catalogueDeleteRtdb(req));
});

export const v1catalogueUpdate = onRequest(firebaseHttpFnConfig, async (req, res) => {
  await validateOnRequestAdmin(req);
  res.status(200).send(await catalogueUpdateRtdb(req));
});

export const v1catalogueProcessRaw = onRequest(firebaseHttpFnConfig, async (req, res) => {
  await validateOnRequestAdmin(req);
  await dispatchTask({
    functionName: "processM4B",
    data: {sku: req.body.sku},
  });
  res.status(200).send({status: `v1catalogueProcessRaw: attempting to process ${req.body.sku}`});
});

export const v1updateAllCatalogueGraphProgress = onCall({
  ...firebaseFnConfig,
  memory: "512MiB", // More memory than default to ensure it has enough to run the function
}, async (context) => {
  const {uid} = await validateOnCallAuth(context);
  logger.info(`User ${uid} initiated update of all catalogue graph progress`);

  try {
    // Get all catalogue items from RTDB
    const catalogueItems = await catalogueGetAllRtdb({visibility: "all"});
    logger.info(`Found ${catalogueItems.length} catalogue items to update`);

    const results = [];
    // Process each item
    for (const item of catalogueItems) {
      try {
        logger.info(`Updating graph progress for ${item.sku}`);
        // Use new tracker but keep catalogueUpdateGraphProgress for backwards compatibility
        const updatedItem = await CatalogueProgressTracker.updateProgress(item.sku, {
          graphId: item.defaultGraphId,
        });

        if (updatedItem) {
          results.push({
            sku: item.sku,
            success: true,
            progress: updatedItem.graphProgress?.completion,
          });
          logger.info(`Successfully updated ${item.sku} - Progress: ${updatedItem.graphProgress?.completion}%`);
        } else {
          results.push({
            sku: item.sku,
            success: false,
            error: "Item not found",
          });
          logger.warn(`Failed to update ${item.sku} - Item not found`);
        }
      } catch (error) {
        results.push({
          sku: item.sku,
          success: false,
          error: error.message,
        });
        logger.error(`Error updating ${item.sku}: ${error.message}`);
        // Continue with next item even if one fails
        continue;
      }
    }

    logger.info("Completed updating all catalogue graph progress");
    return {
      success: true,
      totalItems: catalogueItems.length,
      results,
    };
  } catch (error) {
    logger.error(`Fatal error in updateAllCatalogueGraphProgress: ${error.message}`);
    throw error;
  }
});

export const v1catalogueCreateShareableClip = onCall({
  memory: "4GiB",
  ...firebaseFnConfig,
}, async (context) => {
  const {uid, data} = await validateOnCallAuth(context);
  return createShareableClip({uid, ...data});
});

