import {zodTextFormat} from "openai/helpers/zod";

/**
 * Whether a prompt's responseSchema is a Zod schema (as opposed to a plain JSON schema object)
 * @param {*} schema - The prompt's responseSchema
 * @return {boolean} True for a Zod schema
 */
function isZodSchema(schema) {
  return !!schema && typeof schema.safeParse === "function";
}

/**
 * A valid format name for the Responses API (letters, digits, _ and -, at most 64 characters)
 * @param {string} [name] - Usually the prompt key
 * @return {string} The format name
 */
function formatNameFor(name) {
  return String(name || "response").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
}

/**
 * The SDK's text.format for a Zod schema, for use with responses.parse (which returns output_parsed)
 * @param {Object} schema - Zod schema
 * @param {string} [name] - Format name, usually the prompt key
 * @return {Object} zodTextFormat result
 */
function zodTextFormatFor(schema, name) {
  return zodTextFormat(schema, formatNameFor(name));
}

/**
 * Responses API text.format for a plain JSON schema, for use with responses.create
 * @param {Object} params - The parameters object
 * @param {Object} params.responseSchema - Plain JSON schema
 * @param {string} [params.name] - Format name, usually the prompt key
 * @return {Object} The text.format object
 */
function jsonSchemaTextFormat({responseSchema, name}) {
  // In case the schema is edited by another request.
  return {type: "json_schema", name: formatNameFor(name), schema: JSON.parse(JSON.stringify(responseSchema))};
}

/**
 * The refusal text in a Responses API result, if the model refused (structured outputs report a refusal
 * as a separate content item instead of schema output)
 * @param {Object} result - responses.create / responses.parse result
 * @return {string|null} The refusal, or null
 */
function refusalIn(result) {
  for (const output of result?.output || []) {
    if (output.type !== "message") continue;
    for (const item of output.content || []) {
      if (item.type === "refusal") return item.refusal || "refused";
    }
  }
  return null;
}

export {isZodSchema, zodTextFormatFor, jsonSchemaTextFormat, refusalIn};
