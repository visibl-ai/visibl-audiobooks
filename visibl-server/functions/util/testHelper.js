import fs from "fs";
import {getStorage} from "firebase-admin/storage";

import {processModalCallback} from "../modal/callback.js";

const SYM_PATH = "./test/bindings/queue/";

import chai from "chai";
import chaiHttp from "chai-http";
chai.use(chaiHttp);
const expect = chai.expect;

/**
 * Helper function to wait for modal queue callbacks to be posted
 * @param {string} APP_URL - The URL of the app
 * @return {Promise<void>}
 */
async function postModalQueueCallback(APP_URL) {
  if (process.env.MOCK_IMAGES !== "true") {
    console.log(`Waiting for modal callbacks to be posted`);
    // Poll for modal queue entries until completed or timeout
    const timeout = 2 * 60000; // 2 minutes
    const startTime = Date.now();
    const spinner = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
    let spinnerIndex = 0;
    let lastCount = 0;

    while (Date.now() - startTime < timeout) {
      try {
        // Get all processing modal queue entries
        const modalResponse = await chai.request(APP_URL)
            .post("/v1/admin/queue/get")
            .set("API-KEY", process.env.ADMIN_API_KEY)
            .send({
              type: "modal",
              status: "processing",
              limit: 200,
            });
        expect(modalResponse).to.have.status(200);
        const modalQueueIds = modalResponse.body.map((entry) => entry.id);

        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        const count = modalQueueIds.length;

        // Only update if count changed or every 1 second
        if (count !== lastCount || elapsed % 1 === 0) {
          const status = count > 0 ? `${count} processing` : "complete";
          const progress = elapsed > 0 ? ` (${elapsed}s)` : "";
          process.stdout.write(`\r${spinner[spinnerIndex]} Modal queue: ${status}${progress}`);
          lastCount = count;
        }

        spinnerIndex = (spinnerIndex + 1) % spinner.length;

        // If no processing entries, break the loop
        if (modalQueueIds.length === 0) {
          process.stdout.write(`\r✅ Modal queue: complete (${elapsed}s)\n`);
          break;
        }
      } catch (error) {
        console.error("Error polling modal queue:", error);
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    // Mock success response with 200 status
    return {status: 200};
  }

  console.log(`Posting modal queue callback manually`);
  // Get all processing modal queue entries
  const modalResponse = await chai.request(APP_URL)
      .post("/v1/admin/queue/get")
      .set("API-KEY", process.env.ADMIN_API_KEY)
      .send({
        type: "modal",
        status: "processing",
        limit: 200,
      });
  expect(modalResponse).to.have.status(200);
  const modalQueueIds = modalResponse.body.map((entry) => entry.id);
  console.log(`Modal queue ids: ${modalQueueIds}`);

  // Post callbacks to the processing modal queue entries
  const callbackResponse = await chai.request(APP_URL)
      .post("/v1/modal/callback")
      .set("Content-Type", "application/json")
      .set("Authorization", `Bearer ${process.env.MODAL_CALLBACK_TOKEN}`)
      .send({
        results: modalQueueIds.map((id) => ({
          [id]: "https://example.com/output.png",
        })),
      });

  // This is the actual process we should call since we are not dispatching the task.
  await processModalCallback({results: modalQueueIds.map((id) => ({
    [id]: "https://example.com/output.png",
  }))});

  return callbackResponse;
}

/**
 * Helper function to upload files to the bucket
 * @param {Object} app - The Firebase app instance
 * @param {Array<{from: string, to: string}>} fileList - The list of files to upload
 * @return {Promise<void>}
 */
async function uploadFiles(app, fileList) {
  const bucket = getStorage(app).bucket();
  for (const thisFile of fileList) {
    // console.log(`Uploading file: ${thisFile.from}`);
    const filePath = thisFile.to;
    const file = bucket.file(filePath);
    try {
      const stream = fs.createReadStream(`${SYM_PATH}${thisFile.from}`);
      await new Promise((resolve, reject) => {
        stream.pipe(file.createWriteStream({}))
            .on("error", (error) => {
              console.error(`Upload failed for ${thisFile.from}:`, error);
              reject(error);
            })
            .on("finish", () => {
              // console.log(`File ${thisFile.from} uploaded successfully`);
              resolve();
            });
      });
    } catch (error) {
      console.error(`Failed to upload file ${thisFile.from}:`, error);
    }
  }
}

export {postModalQueueCallback, uploadFiles};
