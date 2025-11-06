import axios from "axios";
import logger from "./logger.js";

/**
 * Class representing a Modal API client
 */
class ModalClient {
  /**
   * Create a Modal API client
   * @param {string} endpoint - The Modal API endpoint URL
   * @param {string} apiKey - The Modal API key
   * @throws {Error} If endpoint is not provided or is invalid
   */
  constructor(endpoint, apiKey) {
    if (!endpoint) {
      throw new Error("Endpoint URL is required");
    }
    // Ensure endpoint is a valid URL
    try {
      new URL(endpoint);
    } catch (error) {
      throw new Error(`Invalid endpoint URL: ${endpoint}`);
    }
    this.endpoint = endpoint;
    this.apiKey = apiKey;
  }

  /**
     * Send a request to the modal endpoint
     * @param {Object} payload - The JSON payload to send
     * @return {Promise<Object>} The response from the modal endpoint
     */
  async sendRequest(payload) {
    try {
      logger.info(`Sending request to modal endpoint: ${this.endpoint}`);
      logger.info(`Payload: ${JSON.stringify(payload)}`);
      const response = await axios({
        method: "post",
        url: this.endpoint,
        data: payload,
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.apiKey}`,
        },
      });

      if (!response?.data) {
        throw new Error("Invalid response from modal endpoint");
      }

      return response.data;
    } catch (error) {
      if (error.response) {
        // The request was made and the server responded with a status code
        // that falls out of the range of 2xx
        throw new Error(`Modal API error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
      } else {
        // Something happened in setting up the request that triggered an Error
        throw new Error(`Failed to send modal request: ${error.message}`);
      }
    }
  }

  /**
     * Get the status of a modal job
     * @param {string} jobId - The ID of the job to check
     * @return {Promise<Object>} The status of the job
     */
  async getJobStatus(jobId) {
    try {
      const response = await axios.get(`${this.endpoint}/status/${jobId}`, {
        headers: {
          "Authorization": `Bearer ${this.apiKey}`,
        },
      });

      if (!response?.data) {
        throw new Error("Invalid response from modal endpoint");
      }

      return response.data;
    } catch (error) {
      if (error.response) {
        // The request was made and the server responded with a status code
        // that falls out of the range of 2xx
        throw new Error(`Modal API error: ${error.response.status} - ${error.response.data?.message || error.message}`);
      } else if (error.request) {
        // The request was made but no response was received
        throw new Error(`No response from modal endpoint: ${error.message}`);
      } else {
        // Something happened in setting up the request that triggered an Error
        throw new Error(`Failed to get job status: ${error.message}`);
      }
    }
  }
}

export default ModalClient;
