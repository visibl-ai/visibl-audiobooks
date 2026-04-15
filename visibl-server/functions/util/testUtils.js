import chai from "chai";
import chaiHttp from "chai-http";
chai.use(chaiHttp);

/**
 * Poll queue until a condition is met
 * @param {Object} params - The parameters
 * @param {string} params.appUrl - The app URL
 * @param {string} params.type - Queue type (e.g., "wavespeed")
 * @param {string} params.status - Queue status to query (e.g., "complete", "error")
 * @param {Function} params.condition - Function that takes entries array and returns truthy when polling should stop
 * @param {number} [params.maxAttempts=10] - Maximum polling attempts (reduced to 2 when MOCK_IMAGES is enabled)
 * @param {number} [params.interval=7000] - Interval between polls in ms
 * @param {number} [params.limit=10] - Limit for queue query
 * @return {Promise<Array>} The matching queue entries
 */
async function pollQueueUntil({appUrl, type, status, condition, maxAttempts = 10, interval = 7000, limit = 10}) {
  // In mock mode, callbacks are mocked so we only need 1 attempt without delay
  if (process.env.MOCK_IMAGES === "true") {
    maxAttempts = 1;
    interval = 0;
  }
  let pollCount = 0;
  let entries = [];

  while (!condition(entries) && pollCount < maxAttempts) {
    pollCount++;
    console.log(`Polling ${pollCount} / ${maxAttempts} for ${type}:${status} tasks...`);
    await new Promise((resolve) => setTimeout(resolve, interval));

    const response = await chai.request(appUrl)
        .post("/v1/admin/queue/get")
        .set("API-KEY", process.env.ADMIN_API_KEY)
        .send({
          type,
          status,
          limit,
        });

    entries = response.body;
  }

  return entries;
}

export {pollQueueUntil};
