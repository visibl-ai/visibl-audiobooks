/* eslint-disable camelcase */
/* eslint-disable require-jsdoc */
import axios from "axios";
import {Readable} from "stream";
import logger from "../../util/logger.js";
import {
  IMAGEROUTER_API_KEY,
  IMAGEROUTER_API_URL,
  MOCK_IMAGES,
} from "../../config/config.js";

import {
  uploadStreamAndGetCDNLink,
} from "../../storage/storage.js";

import {
  sharpStream,
} from "../../util/sharp.js";

import path from "path";
import fs from "fs/promises";

async function generateImage(request) {
  const {
    prompt,
    model,
    outputPath,
    outputFormat="jpg",
  } = request;

  if (MOCK_IMAGES.value() === true) {
    // Read from mock image file
    logger.info("Mocking ImageRouter response");
    const mockImagePath = path.join(path.dirname(new URL(import.meta.url).pathname), "imagerouter-mock.jpeg");
    const mockImageBuffer = await fs.readFile(mockImagePath);
    const stream = Readable.from(mockImageBuffer);
    return await uploadStreamAndGetCDNLink({stream: sharpStream({format: outputFormat, sourceStream: stream}), filename: outputPath});
  }

  try {
    logger.debug(`Generating image with ImageRouter - model: ${model}, prompt: ${prompt}`);

    const response = await axios.post(
        IMAGEROUTER_API_URL.value(),
        {
          prompt: prompt,
          model: model,
        },
        {
          headers: {
            "Authorization": `Bearer ${IMAGEROUTER_API_KEY.value()}`,
            "Content-Type": "application/json",
          },
          validateStatus: undefined,
        },
    );

    if (response.status === 200) {
      // ImageRouter returns a JSON response with a URL
      const imageUrl = response.data.url || response.data.data?.[0]?.url;

      if (!imageUrl) {
        logger.error(`ImageRouter response missing URL. Model: ${model}, Response: ${JSON.stringify(response.data)}`);
        logger.error(`Failed prompt (first 200 chars): ${prompt.substring(0, 200)}...`);
        throw new Error(`No image URL in response from model ${model}. Response: ${JSON.stringify(response.data)}`);
      }

      logger.debug(`ImageRouter returned image URL: ${imageUrl}`);

      // Download the image from the URL
      const imageResponse = await axios.get(imageUrl, {
        responseType: "arraybuffer",
      });

      const buffer = Buffer.from(imageResponse.data);
      const stream = Readable.from(buffer);
      logger.debug(`ImageRouter image generation complete ${outputPath}`);

      return await uploadStreamAndGetCDNLink({stream: sharpStream({format: outputFormat, sourceStream: stream}), filename: outputPath});
    } else {
      const errorMessage = JSON.stringify(response.data);
      logger.error(`ImageRouter API error: ${response.status} - ${errorMessage}`);
      throw new Error(`ImageRouter API error: ${response.status} - ${errorMessage}`);
    }
  } catch (error) {
    if (error.response) {
      // The request was made and the server responded with an error status
      const errorMessage = error.response.data ? JSON.stringify(error.response.data) : error.message;
      logger.error(`ImageRouter API error: ${error.response.status} - ${errorMessage}`);
      throw new Error(`ImageRouter API error: ${error.response.status} - ${errorMessage}`);
    } else if (error.request) {
      // The request was made but no response was received
      logger.error(`ImageRouter no response: ${error.message}`);
      throw new Error(`ImageRouter no response: ${error.message}`);
    } else {
      // Something happened in setting up the request
      logger.error(`ImageRouter request error: ${error.message}`);
      throw error;
    }
  }
}

const queueEntryTypeToFunction = (entryType) => {
  switch (entryType) {
    case "generate":
      return generateImage;
    case "failure":
      return () => {
        throw new Error("This is a test error");
      };
    default:
      throw new Error(`Unknown entry type: ${entryType}`);
  }
};

export {
  generateImage,
  queueEntryTypeToFunction,
};
