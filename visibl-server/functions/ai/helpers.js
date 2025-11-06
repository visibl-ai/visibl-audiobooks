/**
 * Transforms an array of parameters into a list of prompts
 * @param {Object} params - Parameters
 * @param {Array} params.paramsList - Array of parameters
 * @param {String} params.systemInstruction - System instruction
 * @return {Array} Array of prompts
 */
function promptListFromParamsList({paramsList, systemInstruction}) {
  const promptList = [];
  paramsList.forEach((params) => {
    let content = systemInstruction;
    params.forEach((param) => {
      content = content.replaceAll(`%${param.name}%`, param.value);
    });
    promptList.push(content);
  });
  return promptList;
}

/**
 * Transforms a list of prompts and text into a list of messages
 * @param {Object} params - Parameters
 * @param {Array} params.promptList - Array of prompts
 * @param {Array} params.textList - Array of text
 * @return {Object} Object with messages
 */
function messagesFromPromptListAndTextList({promptList, textList}) {
  const messages = [];
  for (let i = 0; i < textList.length; i++) {
    const text = textList[i];
    const userContent = typeof text === "object" ? JSON.stringify(text, null, 2) : text;
    messages.push([
      {
        role: "system",
        content: promptList[i],
      },
      {role: "user", content: userContent},
    ]);
  }
  return {messages};
}

/**
 * Transforms an array of results into an object mapping response keys to results
 * @param {Object} params - Parameters
 * @param {Array} params.results - Array of results to flatten
 * @param {Array} params.responseKeys - Array of keys corresponding to each result
 * @return {Object} Object with responseKey -> result mapping
 */
function flattenResults({results, responseKeys}) {
  if (!Array.isArray(results)) {
    return results;
  }

  const flattenedResults = {};
  results.forEach((result, index) => {
    flattenedResults[responseKeys[index]] = result;
  });
  return flattenedResults;
}

export {
  promptListFromParamsList,
  messagesFromPromptListAndTextList,
  flattenResults,
};
