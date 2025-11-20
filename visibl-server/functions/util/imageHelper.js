/* eslint-disable require-jsdoc */
import logger from "./logger.js";
import {OpenRouterClient, OpenRouterMockResponse} from "../ai/openrouter/base.js";
import {createAnalyticsOptions} from "../analytics/index.js";
/**
 * Moderates an image prompt that was flagged for content policy violation
 * @param {Object} params - Parameters object
 * @param {string} params.prompt - The original prompt that was flagged
 * @param {string} [params.context] - Optional context about the character/scene
 * @return {Promise<string>} - The moderated prompt
 */
async function moderateImagePrompt(params) {
  const {prompt, uid, sku, graphId, context = ""} = params;

  logger.debug(`Moderating image prompt: ${prompt.substring(0, 100)}...`);

  const openRouterClient = new OpenRouterClient();

  const contextReplacement = context ? `Context: ${context}` : "";

  try {
    const result = await openRouterClient.sendRequest({
      prompt: "moderateImagePrompt",
      message: prompt,
      replacements: [
        {key: "CONTEXT", value: contextReplacement},
      ],
      analyticsOptions: createAnalyticsOptions({uid, graphId, sku, promptId: "moderateImagePrompt"}),
      mockResponse: new OpenRouterMockResponse({
        content: `Mock moderated version of: ${prompt.substring(0, 50)}... [content moderated for safety]`,
      }),
    });

    if (result.result) {
      const moderatedPrompt = result.result.trim();
      logger.debug(`Moderated prompt: ${moderatedPrompt.substring(0, 100)}...`);
      return moderatedPrompt;
    } else {
      logger.error("Failed to moderate image prompt - no result returned");
      return prompt; // Return original if moderation fails
    }
  } catch (error) {
    logger.error(`Error moderating image prompt: ${error.message}`);
    return prompt; // Return original if moderation fails
  }
}

export {
  moderateImagePrompt,
};
