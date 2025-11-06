/* eslint-disable require-jsdoc */

import {getJsonFile} from "../storage/storage.js";
import logger from "./logger.js";
import {
  copyFile,
} from "../storage/storage.js";
import {bookImportQueue} from "../ai/queue/bookImportQueue.js";

import {
  catalogueAddRtdb,
  catalogueGetRtdb,
  catalogueUpdateRtdbProperty,
} from "../storage/realtimeDb/catalogue.js";

// import {AAX_CONNECT_SOURCE, ENVIRONMENT, HOSTING_DOMAIN} from "../config/config.js";


async function processRawPublicItem(req) {
  const sku = req.body.sku;
  const version = req.body.version || "v0.1"; // Default to v0.1 if not specified
  if (!sku) {
    return {
      error: true,
      message: "sku is required",
    };
  }
  const metadata = await getJsonFile({filename: `Catalogue/Raw/${sku}.json`});
  if (!metadata) {
    return {
      error: true,
      message: "metadata not found",
    };
  }
  // Copy the album art
  await copyAlbumArt(sku);
  // Now that the transcriptions and metadata are available lets add it to the catalogue.
  const catalogueItem = await addSkuToCatalogue("admin", metadata, "public", version);

  // Store the version for graph creation
  if (catalogueItem) {
    await catalogueUpdateRtdbProperty({sku: catalogueItem.sku, property: "graphVersion", value: version});
  }

  // Add the transcription task to the BookImportQueue
  await bookImportQueue.addToQueue({
    model: "default",
    params: {
      uid: "admin",
      sku: sku,
      entryType: "bookImport",
    },
    estimatedTokens: 0,
  });
  return;
}

async function addSkuToCatalogue(uid, metadata, visibility, version = "v0.1") {
  logger.info(`Updating catalogue with metadata for item ${metadata.sku}`);
  const catalogueItem = await catalogueGetRtdb({sku: metadata.sku});
  if (catalogueItem) {
    logger.info(`Catalogue item already exists for ${metadata.sku}`);
    return catalogueItem;
  }
  // Ensure visibility is either 'public' or 'private'
  if (visibility !== "public" && visibility !== "private") {
    throw new Error("Visibility must be either 'public' or 'private'");
  }
  const itemToAdd = {
    type: "audiobook",
    title: metadata.title,
    author: metadata.author,
    duration: metadata.duration,
    visibility: visibility,
    addedBy: uid,
    sku: metadata.sku,
    metadata: metadata,
    graphVersion: version,
  };
  return await catalogueAddRtdb({body: itemToAdd});
}

async function copyAlbumArt(sku) {
  await copyFile({sourcePath: `Catalogue/Raw/${sku}.jpg`, destinationPath: `Catalogue/Processed/${sku}/${sku}.jpg`});
}

export {
  processRawPublicItem,
  addSkuToCatalogue,
};

/* OPDS Catalogue item template
    # https://test.opds.io/2.0/home.json
    # https://readium.org/webpub-manifest/examples/Flatland/manifest.json
{
  "metadata": {
    "@type": "http://schema.org/Audiobook",
    "title": "Neuromancer: Sprawl Trilogy, Book 1",
    "author": {
      "name": "William Gibson",
      "sortAs": "Gibson, William",
    },
    "identifier": "riw7PiKBeKZF70WUMoSw",
    "language": "en",
    "modified": "2024-06-28T15:28:26.000Z",
    "published": "2021",
    "duration": 30777.168345,
    "description": "Neuromancer: Sprawl Trilogy, Book 1",
    "visiblId": "riw7PiKBeKZF70WUMoSw",
  },
  "images": [
    {
      "href": "",
      "type": "image/jpeg",
    },
  ],
  "links": [
    {
      "href": "https://visibl-dev-ali.web.app/v1/tmp/catalogue/",
      "type": "application/audiobook+json",
      "rel": "http://opds-spec.org/acquisition/buy",
    },
  ],
};
*/
/*
{
  asin: "B07231BVRJ",
  asset_details: [],
  available_codecs: [
    {
      enhanced_codec: "LC_64_22050_stereo",
      format: "Enhanced",
      is_kindle_enhanced: true,
      name: "aax_22_64",
    },
    {
      enhanced_codec: "LC_32_22050_stereo",
      format: "Enhanced",
      is_kindle_enhanced: true,
      name: "aax_22_32",
    },
    {
      enhanced_codec: "format4",
      format: "Format4",
      is_kindle_enhanced: false,
      name: "format4",
    },
    {
      enhanced_codec: "mp42264",
      format: "Enhanced",
      is_kindle_enhanced: true,
      name: "mp4_22_64",
    },
    {
      enhanced_codec: "piff2232",
      format: "Enhanced",
      is_kindle_enhanced: true,
      name: "piff_22_32",
    },
    {
      enhanced_codec: "mp42232",
      format: "Enhanced",
      is_kindle_enhanced: true,
      name: "mp4_22_32",
    },
    {
      enhanced_codec: "piff2264",
      format: "Enhanced",
      is_kindle_enhanced: true,
      name: "piff_22_64",
    },
    {
      enhanced_codec: "aax",
      format: "Enhanced",
      is_kindle_enhanced: false,
      name: "aax",
    },
  ],
  content_delivery_type: "MultiPartBook",
  content_type: "Product",
  format_type: "unabridged",
  has_children: true,
  is_adult_product: false,
  is_ayce: false,
  is_listenable: true,
  is_purchasability_suppressed: false,
  is_removable_by_parent: true,
  is_vvab: false,
  issue_date: "2011-08-16",
  language: "english",
  library_status: {
    date_added: "2019-08-31T23:20:57.950Z",
    is_pending: null,
    is_preordered: null,
    is_removable: null,
    is_visible: null,
  },
  merchandising_summary: "<p>In the year 2045, reality is an ugly place. The only time Wade Watts really feels alive is when he's jacked into the OASIS, a vast virtual world where most of humanity spends their days....</p>",
  publication_datetime: "2011-08-16T05:00:00Z",
  publication_name: "Ready Player One",
  purchase_date: "2019-08-31T23:20:57.950Z",
  release_date: "2011-08-16",
  runtime_length_min: 940,
  sku: "BK_RAND_002735CA",
  sku_lite: "BK_RAND_002735",
  status: "Active",
  thesaurus_subject_keywords: ["literature-and-fiction"],
  title: "Ready Player One",
};
*/

/*
      library = library.map((item) => ({
        type: "audiobook",
        title: item.title,
        visibility: "private",
        addedBy: uid,
        sku: item.sku_lite,
        feedTemplate: itemToOPDSFeed(item),
      }));
*/
