/* eslint-disable require-jsdoc */
import {
  storeData,
  getData,
  deleteData,
  updateData} from "./database.js";
import {removeUndefinedProperties} from "../firestore.js";
import {getFileStream} from "../storage.js";
import {uploadStreamToCloudflare} from "../cloudflare.js";
// import {dispatchTask} from "../../util/dispatch.js";
import logger from "../../util/logger.js";
import {getMetaData} from "../../audio/audioMetadata.js";
function catalogueItemToDbRef({sku}) {
  return `catalogue/${sku}`;
}

async function catalogueAddRtdb(req) {
  let item = req.body;
  if (!item.sku) {
    throw new Error("Item sku is required");
  }
  item = removeUndefinedProperties(item);
  // Call catalogueBatchAddFirestore with a single item
  const addedItems = await catalogueBatchAddRtdb([item]);
  // Return the first (and only) element of the list
  return addedItems[0];
}

async function catalogueBatchAddRtdb(items) {
  const addedItems = [];
  for (const item of items) {
    const existingItem = await getData({
      ref: catalogueItemToDbRef({sku: item.sku}),
    });
    if (existingItem) {
      logger.debug(`Skipping item ${item.sku} as it already exists in RTDB`);
      continue;
    }
    if (item.opdsMetadata) {
      item.opdsMetadata = removeUndefinedProperties(item.opdsMetadata);
    }
    if (item.opdsReadingOrder) {
      item.opdsReadingOrder = removeUndefinedProperties(item.opdsReadingOrder);
    }
    if (item.metadata) {
      item.metadata = removeUndefinedProperties(item.metadata);
    }
    if (!item.coverArtUrl) {
      try {
        item.coverArtUrl = await albumArtUrl(item);
      } catch (error) {
        logger.warn(`${item.sku} Error getting album art url for item: ${error}`);
      }
    }
    item.id = item.sku;
    // Remove any undefined properties from data
    const data = removeUndefinedProperties(item);
    if (data.feedTemplate) {
      data.feedTemplate = removeUndefinedProperties(data.feedTemplate);
    }

    // Add createdAt and updatedAt timestamps
    data.createdAt = Date.now();
    data.updatedAt = Date.now();
    if (item.metadata) {
      if (item.metadata.numChapters) {
        data.numChapters = item.metadata.numChapters;
      } else if (item.metadata.chapters) {
        const numChapters = Object.keys(item.metadata.chapters).length;
        data.numChapters = numChapters;
      }
    }
    // Get or create default graph for the item.
    if (data.fiction === undefined) {
      data.fiction = true;
    }
    if (data.visibility === undefined) {
      data.visibility = "public";
    }
    // Initialize graphProgress field
    data.graphProgress = {
      status: "pending",
      currentStep: "initializing",
      completion: 0,
    };

    await storeData({ref: catalogueItemToDbRef({sku: data.sku}), data});
    addedItems.push(getData({ref: catalogueItemToDbRef({sku: data.sku})}));
  }
  return addedItems;
}

async function albumArtUrl({sku}) {
  const path = `Catalogue/Processed/${sku}/${sku}.jpg`;
  const stream = await getFileStream({path});
  const filename = `${sku}.jpg`;
  const cdnUrl = await uploadStreamToCloudflare(stream, filename, "thumb");
  return cdnUrl;
}

async function catalogueGetRtdb({sku, id}) {
  if (id) {
    sku = id;
  }
  const item = await getData({ref: catalogueItemToDbRef({sku})});
  return item;
}

async function catalogueGetAllRtdb({visibility = "public"}) {
  const catalogue = await getData({
    ref: "catalogue",
    ...(visibility !== "all" && {
      query: {
        orderByChild: "visibility",
        equalTo: visibility,
      },
    }),
  });
  if (!catalogue) {
    return [];
  }
  return Object.values(catalogue);
}

async function catalogueDeleteRtdb(req) {
  const data = req.body;
  if (!data.id) {
    throw new Error("Item ID is required for deletion");
  }
  await deleteData({ref: catalogueItemToDbRef({sku: data.id})});
  return {success: true, message: "Item deleted successfully"};
}

async function catalogueUpdateRtdb(req) {
  const data = req.body;
  if (!data.id) {
    throw new Error("Item ID is required for update");
  }
  data.updatedAt = Date.now();
  await updateData({ref: catalogueItemToDbRef({sku: data.id}), data: data});
  return await getData({ref: catalogueItemToDbRef({sku: data.id})});
}

async function catalogueUpdateRtdbProperty({sku, property, value}) {
  // Create an object with the property as the key
  const updateObject = {
    [property]: value,
    updatedAt: Date.now(),
  };

  await updateData({
    ref: catalogueItemToDbRef({sku}),
    data: updateObject,
  });
  return await getData({ref: `${catalogueItemToDbRef({sku})}/${property}`});
}

async function catalogueAddStyleRtdb({sku, styleId, title, prompt, uid, userPrompt, provider, category}) {
  const catalogueItem = await catalogueGetRtdb({sku});
  if (!catalogueItem.styles) {
    catalogueItem.styles = {};
  }
  const createdAt = Date.now();
  catalogueItem.styles[styleId]= {title, prompt, uid, userPrompt, createdAt};
  if (provider) { // needed for origin
    catalogueItem.styles[styleId].provider = provider;
  }
  if (category) { // needed for origin
    catalogueItem.styles[styleId].category = category;
  }
  logger.debug(`catalogueAddStyleRtdb: Adding style ${styleId} to catalogue item ${sku} with provider ${provider}`);
  await updateData({ref: catalogueItemToDbRef({sku}), data: catalogueItem});
  return catalogueItem;
}

async function catalogueDeleteStyleRtdb({sku, styleId}) {
  const catalogueItem = await catalogueGetRtdb({sku});
  if (sku && styleId) {
    delete catalogueItem.styles[styleId];
  } else if (sku) {
    delete catalogueItem.styles;
  } else {
    throw new Error("catalogueDeleteStyleRtdb: sku or styleId is required");
  }
  await updateData({ref: catalogueItemToDbRef({sku}), data: catalogueItem});
  return catalogueItem;
}

async function getStylesFromCatalogueRtdb({sku, type = "array"}) {
  const catalogueItem = await catalogueGetRtdb({sku});
  if (!catalogueItem) {
    throw new Error(`Catalogue item not found for sku: ${sku}`);
  }
  if (type === "object") {
    return catalogueItem.styles;
  } else {
    return Object.entries(catalogueItem.styles || {}).map(([key, value]) => ({
      ...value,
      id: key,
    }));
  }
}

async function populateCatalogueWithAAXItems({uid, items}) {
  logger.debug("Populating catalogue with audible items");
  logger.debug("Items SKUs:", items.map((item) => item.sku).join(", "));
  items = await filterNewSKUItemsForCatalogue({items});
  logger.debug("Filtered items:", items.map((item) => item.sku).join(", "));
  // With the new flow, getMetaData will fail and return empty {}
  // Only keeping this for backwards compatibility
  await Promise.all(items.map(async (item) => {
    try {
      const metadata = await getMetaData(uid, item.sku);
      item.metadata = metadata?.bookData || {};
      item.author = item.author || item.metadata.author;
    } catch (error) {
      logger.error(`Error getting metadata for item ${item.sku}: ${error}`);
      item.metadata = {};
    }
  }));
  return await catalogueBatchAddRtdb(items);
}

async function filterNewSKUItemsForCatalogue({items}) {
  const filteredItems = await Promise.all(items.map(async (item) => {
    const existingItem = await getData({
      ref: catalogueItemToDbRef({sku: item.sku}),
    });
    return existingItem ? null : item;
  }));

  return filteredItems.filter((item) => item !== null);
}

// async function catalogueMigrate({req}) {
//   const cataloguePublic = await catalogueGetAllFirestore("public");
//   const cataloguePrivate = await catalogueGetAllFirestore("private");
//   let catalogue = [...cataloguePublic, ...cataloguePrivate];
//   // Filter out items that already exist in RTDB
//   catalogue = await Promise.all(catalogue.map(async (item) => {
//     const existingItem = await getData({
//       ref: catalogueItemToDbRef({sku: item.sku}),
//     });
//     // Skip if item already exists
//     if (existingItem) {
//       logger.debug(`Skipping item ${item.sku} as it already exists in RTDB`);
//       return null;
//     }

//     // Skip if graph is not available
//     if (!item.graphAvailable) {
//       logger.debug(`Skipping item ${item.sku} as it does not have a graph available`);
//       return null;
//     }

//     // get all known scenes for this item
//     const scenes = await getCatalogueScenesFirestore({sku: item.sku});
//     // scenes should be an array. loop through it and add it to item.scenes{}
//     item.scenes = {};
//     for (const scene of scenes) {
//       // Check if title and prompt are defined before adding to item.scenes
//       if (scene.title && scene.prompt !== undefined) {
//         item.scenes[scene.id] = {title: scene.title, prompt: scene.prompt};
//       } else {
//         logger.warn(`Scene ${scene.id} for item ${item.sku} is missing title or prompt.`);
//       }
//     }

//     // Item is new and has graph available
//     return item;
//   }));
//   catalogue = catalogue.filter((item) => item !== null);
//   // DEBUG - only migrate 1 item for now.
//   // catalogue = catalogue.slice(0, 2);
//   logger.debug("Migrating catalogue items:", catalogue.map((item) => item.sku).join(", "));
//   await catalogueBatchAddRtdb(catalogue);
//   return await catalogueGetAllRtdb();
// }


export {
  catalogueAddRtdb,
  catalogueGetAllRtdb,
  catalogueDeleteRtdb,
  catalogueUpdateRtdb,
  populateCatalogueWithAAXItems,
  catalogueGetRtdb,
  catalogueAddStyleRtdb,
  catalogueDeleteStyleRtdb,
  // getPrivateCatalogueItemsRtdb,
  getStylesFromCatalogueRtdb,
  // catalogueMigrate,
  catalogueUpdateRtdbProperty,
};
