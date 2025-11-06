/* eslint-disable require-jsdoc */
import logger from "../util/logger.js";
import {promises as fsPromises} from "fs";
import fs from "fs";
import ffmpegTools from "./ffmpeg.js";
import {aaxGetItemFirestore} from "../storage/firestore/aax.js";
import {HOSTING_DOMAIN} from "../config/config.js";
import {deleteLocalFiles} from "../storage/storage.js";

async function aaxcStreamer(req, res) {
  // Handle HEAD request separately
  const pathParts = req.path.split("/");
  logger.debug(`aaxcStreamer: ${req.path} ${pathParts.length}`);
  if (pathParts.length !== 7) {
    logger.error(`Invalid path: ${req.path} ${pathParts.length}`);
    return res.status(400).send("Invalid path");
  }
  const uid = pathParts[pathParts.length - 3];
  const sku = pathParts[pathParts.length - 2];
  const chapterIndex = pathParts[pathParts.length - 1];
  const params = await getAAXCStreamParams({uid, sku, chapterIndex});
  if (req.method === "HEAD") {
    logger.debug(`aaxcStreamer: HEAD request for ${uid} ${sku} ${chapterIndex}`);
    return handleHeadRequest(params, res);
  } else if (req.method === "GET") {
    logger.debug(`aaxcStreamer: GET request for ${uid} ${sku} ${chapterIndex}`);
    return handleGetRequest(params, req, res);
  }
}

function getOutputFilePath({sku, audibleKey, startTime}) {
  return `${process.cwd()}/bin/${sku}-${audibleKey}-${startTime}.m4a`;
}

// function paramsFromReq(req) {
//   const {
//     audibleKey,
//     audibleIv,
//     sku,
//     uid,
//     startTime,
//     durationInSeconds,
//   } = req.query;
//   logger.debug(`paramsFromReq: ${JSON.stringify(req.query)}`);
//   const outputFile = getOutputFilePath(req.query);
//   return {
//     audibleKey,
//     audibleIv,
//     sku,
//     uid,
//     outputFile,
//     startTime: startTime ? parseFloat(startTime) : undefined,
//     durationInSeconds: durationInSeconds ? parseFloat(durationInSeconds) : undefined,
//   };
// }

async function m4bInMem(params) {
  try {
    await fsPromises.access(params.outputFile);
    logger.debug(`File ${params.outputFile} already exists, using cached version`);
    return params.outputFile;
  } catch (error) {
    // File doesn't exist, proceed with generation
    logger.debug(`File ${params.outputFile} does not exist, generating new file`);
  }
  logger.debug(`m4bInMem: Downloading ffmpeg binary`);
  params.ffmpegPath = await ffmpegTools.downloadFfmpegBinary();
  logger.debug(`m4bInMem: ffmpeg downloaded, generating m4b in memory`);
  const path = await ffmpegTools.generateM4bInMem(params);
  return path;
}

async function splitAaxc(params) {
  const {metadata, uid, sku, audibleKey, audibleIv, numThreads, ffmpegPath} = params;
  // logger.debug(`splitAaxc metadata: ${JSON.stringify(params, null, 2)}`);
  const outputFiles = metadata.outputFiles;
  const results = [];
  let i = 0;

  while (i < outputFiles.length) {
    const tasks = [];
    for (let j = 0; j < numThreads && i < outputFiles.length; j++, i++) {
      const task = ffmpegTools.generateM4bInMem({
        uid,
        sku,
        startTime: metadata.startTimes[i],
        durationInSeconds: parseFloat(metadata.endTimes[i] - metadata.startTimes[i]),
        audibleKey,
        audibleIv,
        outputFile: outputFiles[i],
        ffmpegPath,
      });
      tasks.push(task);
    }
    logger.debug(`splitAaxc: Generating ${tasks.length} files in parallel for ${sku}`);
    results.push(...await Promise.all(tasks));
  }

  return results;
}

async function handleHeadRequest(params, res) {
  logger.debug("Handling HEAD request");
  // Here we respond with the correct headers for the content.
  res.writeHead(200, {
    "Accept-Ranges": "bytes",
    "Content-Type": "audio/m4a", // Correct content type for ADTS-wrapped AAC
    "Connection": "close",
    "Content-Length": params.fileSize, // Omit or dynamically calculate if static file
    // "Cache-Control": "private, max-age=0",
    // "Date": new Date().toUTCString(),
    // "Server": "FFmpeg-Server",
  });

  res.end(); // End the response without sending a body
}

async function sendFullFile({params, res}) {
  logger.debug(`sendFullFile: GET request without a range, sending full file.`);
  await m4bInMem(params);
  const headersToSend = {
    "Content-Length": params.fileSize,
    "Content-Type": "audio/m4a",
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store",
  };
  res.writeHead(200, headersToSend);
  const fileStream = fs.createReadStream(params.outputFile);
  fileStream.pipe(res);
  res.on("close", async () => {
    console.log("sendFullFile: Client closed connection");
    fileStream.destroy();
    await deleteLocalFiles([params.outputFile]);
  });
}

async function handleGetRequest(params, req, res) {
  logger.debug(`handleGetRequest: Headers: ${JSON.stringify(req.headers)}`);
  const range = req.headers.range;
  if (!range) {
    return await sendFullFile({params, res});
  }
  const contentLength = params.fileSize;
  await m4bInMem(params);
  // Parse the byte range from the request
  const parts = range.replace(/bytes=/, "").split("-");
  const startByte = parseInt(parts[0], 10);
  const endByte = parts[1] ? parseInt(parts[1], 10) : contentLength - 1;
  let endbyteToSend = endByte;
  if (endByte == contentLength) {
    endbyteToSend = contentLength - 1;
  }
  const headersToSend = {
    // 'Content-Range': `bytes ${newStartByte}-${newEndByte}/${audioFileSize}`,
    "Content-Range": `bytes ${startByte}-${endbyteToSend}/${contentLength}`,
    "Accept-Ranges": "bytes",
    // 'Content-Length': `${newEndByte-newStartByte}`,
    "Content-Length": `${endByte-startByte}`,
    "Content-Type": "audio/m4a",
    // 'Connection':"close",
  };
  console.log(`Sending headers:`, headersToSend);
  res.writeHead(206, headersToSend);
  const fileStream = fs.createReadStream(params.outputFile, {start: startByte, end: endByte});
  fileStream.on("error", (err) => {
    console.error("handleGetRequest: Error reading file:", err);
    if (!res.headersSent) {
      res.status(500).send("handleGetRequest: Error during streaming");
    }
  });

  fileStream.on("end", () => {
    console.log("handleGetRequest: Reached the end of the partial file stream");
  });

  fileStream.pipe(res);

  res.on("close", async () => {
    console.log("handleGetRequest: Client closed connection");
    fileStream.destroy();
    await deleteLocalFiles([params.outputFile]);
  });
}

async function getAAXCStreamParams(params) {
  const {uid, sku, chapterIndex} = params;
  const aaxcId = `${uid}:${sku}`;
  const item = await aaxGetItemFirestore(aaxcId);
  return {
    uid,
    sku,
    outputFile: getOutputFilePath({sku, audibleKey: item.key, startTime: item.chapterMap[chapterIndex].startTime}),
    startTime: item.chapterMap[chapterIndex].startTime,
    durationInSeconds: parseFloat(item.chapterMap[chapterIndex].endTime - item.chapterMap[chapterIndex].startTime),
    audibleKey: item.key,
    audibleIv: item.iv,
    fileSize: item.chapterMap[chapterIndex].fileSizeBytes,
  };
}

async function getAAXCStreamUrl({uid, sku, chapterIndex}) {
  return `${HOSTING_DOMAIN.value()}/v1/aax/stream/${uid}/${sku}/${chapterIndex}`;
}


export {
  aaxcStreamer,
  splitAaxc,
  getAAXCStreamUrl,
};
