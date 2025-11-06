// ffmpeg -ss 7.94 -to 3215.87 -i yourfile.m4b -acodec libmp3lame outputfile.mp3
// ffmpeg -ss 0 -to 7.94 -i test/tmp/audio/nm.m4b -acodec libmp3lame test/tmp/audio/nm-ch0.mp3 -y

// Need to fork fluent-ffmpeg to add support for -activation_bytes
// ffmpeg -y -activation_bytes XXXXXX -i  './XXX.aax' -codec copy 'XXX.m4b'


import ffmpeg from "fluent-ffmpeg";
import {
  downloadFileFromBucket,
  getFileStream,
} from "../storage/storage.js";
import fs from "fs/promises";
// import fs from 'fs/promises';
import logger from "../util/logger.js";
import {ENVIRONMENT} from "../config/config.js";


const splitAudioInParallel = async (
    inputFile,
    outputFiles,
    startTimes,
    endTimes,
    maxSizeInMb,
    codec,
    currentBitrateKbps,
    numThreads,
    ffmpegPath = ffmpeg,
    onChapterComplete = null,
) => {
  const results = [];
  let i = 0;

  while (i < outputFiles.length) {
    const tasks = [];
    for (let j = 0; j < numThreads && i < outputFiles.length; j++, i++) {
      const task = splitAudioWithMaxSize(
          inputFile,
          outputFiles[i],
          startTimes[i],
          endTimes[i],
          maxSizeInMb,
          codec,
          currentBitrateKbps,
          ffmpegPath);
      tasks.push(task);
    }
    const batchResults = await Promise.all(tasks);

    // Each result is now an array of chunks
    for (let resultIndex = 0; resultIndex < batchResults.length; resultIndex++) {
      const chapterChunks = batchResults[resultIndex];
      results.push(chapterChunks); // Push the array of chunks for this chapter

      // Call progress callback for each completed chapter
      if (onChapterComplete) {
        // Validate each chunk using checkAudioStream before calling the callback
        for (const chunk of chapterChunks) {
          try {
            await checkAudioStream(chunk, ffmpegPath);
            logger.debug(`Audio validation successful for ${chunk}`);
          } catch (error) {
            logger.error(`Audio validation failed for ${chunk}: ${error.message}`);
            throw new Error(`Split validation failed for ${chunk}: ${error.message}`);
          }
        }

        await onChapterComplete(chapterChunks);
      }
    }
  }

  return results;
};

const splitAudioByDuration = async (inputFile, outputFile, startTime, duration, ffmpegPath = ffmpeg) => {
  return new Promise((resolve, reject) => {
    logger.debug(`splitAudioByDuration: Splitting ${inputFile} into ${outputFile} from ${startTime} for ${duration}s`);
    ffmpeg(inputFile).setFfmpegPath(ffmpegPath)
        .setStartTime(startTime)
        .setDuration(duration)
        .audioCodec("copy")
        .noVideo()
        .output(outputFile)
        .on("end", () => {
          logger.debug(`splitAudioByDuration: Split complete for ${outputFile}`);
          resolve(outputFile);
        })
        .on("error", (err) => {
          logger.error(`splitAudioByDuration: error occurred: ${outputFile} ${err.message}`);
          reject(err);
        })
        .run();
  });
};

const splitAudioWithMaxSize = async (
    inputFile,
    outputFile,
    startTime,
    endTime,
    maxSizeInMb,
    codec,
    currentBitrateKbps,
    ffmpegPath = ffmpeg) => {
  const durationInSeconds = endTime - startTime;

  // Use safe bitrate (never 0)
  const safeBitrate = currentBitrateKbps && currentBitrateKbps > 0 ? currentBitrateKbps : 128;

  // Calculate max duration that fits in target size
  const targetSizeBits = maxSizeInMb * 1024 * 1024 * 8;
  const maxDurationSeconds = targetSizeBits / (safeBitrate * 1000);

  logger.debug(`splitAudioWithMaxSize: chapter duration=${durationInSeconds}s, maxDuration=${maxDurationSeconds}s for ${maxSizeInMb}MB at ${safeBitrate}kbps`);

  // This function now always returns an array of chunks
  const chunks = [];

  if (durationInSeconds <= maxDurationSeconds) {
    // Chapter fits in single chunk - no compression needed
    const chunkFile = outputFile;
    await splitAudio(inputFile, chunkFile, startTime, durationInSeconds, ffmpegPath);
    chunks.push(chunkFile);
  } else {
    // Chapter needs to be split into multiple chunks
    let currentTime = startTime;
    let chunkIndex = 0;

    while (currentTime < endTime) {
      const chunkStart = currentTime;
      const chunkEnd = Math.min(currentTime + maxDurationSeconds, endTime);
      const chunkDuration = chunkEnd - chunkStart;

      // Generate chunk filename
      const chunkFile = outputFile.replace(".m4a", `-chunk${chunkIndex}.m4a`);

      await splitAudioByDuration(inputFile, chunkFile, chunkStart, chunkDuration, ffmpegPath);
      chunks.push(chunkFile);

      currentTime = chunkEnd;
      chunkIndex++;
    }

    logger.debug(`splitAudioWithMaxSize: Split into ${chunks.length} chunks`);
  }

  return chunks;
};

const splitAudio = async (inputFile, outputFile, startTime, durationInSeconds, ffmpegPath = ffmpeg) => {
  return new Promise((resolve, reject) => {
    logger.debug(`splitAudio: Splitting ${inputFile} into ${outputFile} from ${startTime} for ${durationInSeconds}`);
    ffmpeg(inputFile).setFfmpegPath(ffmpegPath)
        .setStartTime(startTime)
        .setDuration(durationInSeconds)
        .audioCodec("copy")
        .noVideo()
        .output(outputFile)
        .on("end", () => {
          logger.debug(`split ${inputFile} into ${outputFile} from ${startTime} for ${durationInSeconds} complete`);
          resolve(outputFile);
        })
        .on("error", (err) => {
          logger.error(`splitAudio: error occurred: ${outputFile} ${err.message}`);
          reject(err);
        })
        .run();
  });
};

// splitAndCompressAudio function removed - no longer compressing audio
// We now split by duration instead to maintain quality

const compressAudio = async ({
  inputFile,
  outputFile,
  codec,
  desiredSizeBytes,
  durationInSeconds,
  ffmpegPath = ffmpeg}) => {
  return new Promise((resolve, reject) => {
    const desiredBitrate = Math.floor((desiredSizeBytes * 8) / durationInSeconds / 1000);
    let codecString = "aac";
    if (codec === "mp3") {
      codecString = "libmp3lame";
    }
    logger.debug(`compressAudio: Compressing ${inputFile} into ${outputFile} at ${desiredBitrate}k`);
    ffmpeg(inputFile).setFfmpegPath(ffmpegPath)
        .audioCodec(codecString)
        .audioBitrate(`${desiredBitrate}k`)
        .noVideo()
        .output(outputFile)
        .on("end", () => {
          logger.debug(`compressAudio: Compressed ${inputFile} into ${outputFile}`);
          resolve(outputFile);
        })
        .on("error", (err) => {
          logger.error("compressAudio: error occurred: " + err.message);
          reject(err);
        })
        .run();
  });
};

const ffprobe = async (inputFile, ffprobePath) => {
  return new Promise((resolve, reject) => {
    const options = ["-show_chapters"];
    ffmpeg.setFfprobePath(ffprobePath);
    ffmpeg.ffprobe(inputFile, options, (err, metadata) => {
      if (err) {
        reject(err);
      } else {
        resolve(metadata);
      }
    });
  });
};

// eslint-disable-next-line require-jsdoc
async function generateM4bInMem(params) {
  let ffmpegPath = params.ffmpegPath;
  if (ENVIRONMENT.value() === "development") {
    ffmpegPath = `ffmpeg`;
  }
  logger.debug(`generateM4bInMem: Current working directory: ${process.cwd()}`);
  const inputStream = await getFileStream({path: `UserData/${params.uid}/Uploads/AAXRaw/${params.sku}.aaxc`});
  return new Promise((resolve, reject) => {
    const outputPath = params.outputFile;
    logger.debug(`generateM4bInMem params: ${JSON.stringify(params)}`);
    ffmpeg(inputStream).setFfmpegPath(ffmpegPath)
        .setStartTime(params.startTime)
        .setDuration(params.durationInSeconds)
        .audibleKey(params.audibleKey)
        .audibleIv(params.audibleIv)
        .audioCodec("copy")
        .noVideo()
        // Firebase Functions use an in-memory file system
        // So it is faster to write to the in memory fs than
        // use a buffer with a passthrough.
        .output(outputPath)
        .on("start", (commandLine) => {
          logger.debug("generateM4bInMem: FFmpeg command: " + commandLine);
        })
        .on("end", () => {
          logger.debug(`generateM4bInMem: Generated ${params.outputFile} in memory from ${params.startTime} for ${params.durationInSeconds} complete`);
          resolve(outputPath);
        }).on("error", (err) => {
          logger.error(`generateM4bInMem: error occurred generating ${params.outputFile}: ${err.message}`);
          reject(err);
        })
        .run();
  });
}

// eslint-disable-next-line require-jsdoc
async function downloadFfmpegBinary() {
  // Check Node version
  const nodeVersion = process.version;
  const majorVersion = parseInt(nodeVersion.slice(1).split(".")[0]);

  if (majorVersion >= 22) {
    // Ensure ./bin directory exists for Node 22+ (other processes expect it)
    const binDir = "./bin";
    try {
      await fs.access(binDir);
    } catch {
      await fs.mkdir(binDir, {recursive: true});
      logger.debug(`downloadFfmpegBinary: Created ${binDir} directory`);
    }

    logger.debug(`downloadFfmpegBinary: Node ${nodeVersion} detected, using built-in ffmpeg`);
    return "ffmpeg"; // Use built-in ffmpeg in Node 22+
  }

  // Node < 22: Download ffmpeg binary as before
  const ffmpegPath = "./bin/ffmpeg";
  try {
    // Check if file already exists
    await fs.access(ffmpegPath);
    logger.debug(`downloadFfmpegBinary: ffmpeg binary already exists, skipping download: ${ffmpegPath}`);
    return ffmpegPath;
  } catch (error) {
    // File doesn't exist, proceed with download
    await downloadFileFromBucket({bucketPath: "bin/ffmpeg", localPath: ffmpegPath});
    await fs.chmod(ffmpegPath, 0o755);
    return ffmpegPath;
  }
}


const clipAudio = async ({inputFile, outputFile, startTime, endTime, sku, ffmpegPath = ffmpeg}) => {
  return new Promise((resolve, reject) => {
    const duration = Math.round((endTime - startTime) * 1000) / 1000; // Round to 3 decimal places
    logger.debug(`clipAudio: Clipping ${sku} from ${startTime} to ${endTime} (duration: ${duration}s)`);
    logger.debug(`clipAudio: Input: ${inputFile}, Output: ${outputFile}`);

    const command = ffmpeg(inputFile)
        .setFfmpegPath(ffmpegPath)
        .inputOptions([
          `-ss ${startTime}`, // Seek before input for efficiency with HTTP
          `-loglevel debug`, // Verbose logging to see where it crashes
        ])
        .setDuration(duration)
        .audioCodec("copy")
        .noVideo()
        .output(outputFile)
        .on("start", (commandLine) => {
          logger.debug(`clipAudio: FFmpeg command: ${commandLine}`);
        })
        .on("end", () => {
          logger.debug(`clipAudio: Clip complete for ${sku} - ${outputFile}`);
          resolve(outputFile);
        })
        .on("error", (err, _stdout, stderr) => {
          logger.error(`clipAudio: error occurred for ${sku}: ${outputFile} ${err.message}`);
          if (stderr) {
            logger.error(`clipAudio: stderr: ${stderr}`);
          }
          reject(err);
        });

    command.run();
  });
};

const checkAudioStream = async (chapterChunk, ffmpegPath = ffmpeg) => {
  return new Promise((resolve, reject) => {
    let stderrOutput = "";

    const command = ffmpeg(chapterChunk)
        .setFfmpegPath(ffmpegPath)
        .inputOptions([
          "-v", "error", // Only show errors
          "-xerror", // Exit on error
        ])
        .outputOptions([
          "-map", "0:a:0", // Map first audio stream
          "-c", "copy", // Copy codec (no re-encoding)
          "-frames:a", "1", // Only process 1 audio frame
          "-f", "null", // Null output format
        ])
        .output("-") // Output to null
        .on("start", (commandLine) => {
          logger.debug(`checkAudioStream: Checking ${chapterChunk}`);
          logger.debug(`checkAudioStream: FFmpeg command: ${commandLine}`);
        })
        .on("end", () => {
          logger.debug(`checkAudioStream: Audio stream check successful for ${chapterChunk}`);
          resolve({
            success: true,
            file: chapterChunk,
            stderr: stderrOutput,
          });
        })
        .on("error", (err) => {
          // Check for specific stream mapping error
          const hasStreamError = stderrOutput.includes("matches no streams") ||
                                stderrOutput.includes("Invalid argument");

          logger.error(`checkAudioStream: Audio check failed for ${chapterChunk}: ${err.message}`);
          logger.error(`checkAudioStream stderr output: ${stderrOutput}`);

          reject(new Error(`Audio stream check failed: ${hasStreamError ? "No valid audio stream found" : err.message}. stderr: ${stderrOutput}`));
        })
        .on("stderr", (stderrLine) => {
          // Accumulate stderr output
          stderrOutput += stderrLine + "\n";

          // Log errors
          if (stderrLine) {
            logger.debug(`checkAudioStream stderr: ${stderrLine}`);
          }
        });

    command.run();
  });
};

const ffmpegTools = {
  splitAudio,
  splitAudioByDuration,
  splitAudioInParallel,
  ffprobe,
  splitAudioWithMaxSize,
  generateM4bInMem,
  downloadFfmpegBinary,
  compressAudio,
  checkAudioStream,
  clipAudio,
};

export default ffmpegTools;
