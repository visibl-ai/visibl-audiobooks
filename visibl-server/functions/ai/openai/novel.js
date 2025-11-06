/* eslint-disable camelcase */
import logger from "../../util/logger.js";
import nerFunctions from "./ner.js";
import csv from "../csv.js";
import _ from "lodash";

const DEFAULT_CHUNK_SIZE = 20;
const DEFAULT_CHUNK_OVERLAP = 5;

const novel = {
  /*
   *  nerIdentifyEntites
   *  The goal of this function is to generalize Named entity recognition
   *  of both characters and locations.
   *
   *  promptName =
   * [ ner_identify prompt - recurses on entities
   *  simple dedup prompt - only needs entities
   *  complex dedup prompt - needs entities, and populates entire text.
   * ]
   *
   *  It requires a prompt that outputs a JSON with a list of entites in the "entityName" key:
   *  { entityName:  []}
   *
   *  It also requires that you the entities are passed back into the prompt recursively
   *  replacing the text in the prompt promptRecursiveReplaceKey with the entities.
   */

  nerIdentifyEntites: async (
      promptNames,
      promptRecursiveReplaceKey,
      priming, // list of entities to prime the model with
      fullText, // full text, will chunk into smaller pieces
      entityName, // Name of entity inside the response of the ai JSON response { entityName:  []}
      chunkSize = DEFAULT_CHUNK_SIZE,
      overlap = DEFAULT_CHUNK_OVERLAP,
  ) => {
    const entities = priming;

    // STEP 1: Loop over fullText in chunks of chunkSize, with overlap of overlap
    for (let i = overlap; i < fullText.length; i += chunkSize - overlap) {
      const start = i - overlap;
      const end = Math.min(start + chunkSize, fullText.length);
      const chapterChunkCSV = csv(fullText, start, end);
      logger.debug(`start: ${start}, end: ${end}, of size: ${fullText.length}`);
      const new_entities = await nerFunctions.singleRequest(
          promptNames[0], // prompt name
          [{name: promptRecursiveReplaceKey, value: entities}],
          chapterChunkCSV,
      );

      // Sometimes GPT4 repeats entities or updates them  with new information.
      logger.debug("STEP 1: Identify all entities");
      new_entities[entityName].forEach((new_entity) => {
        let existing_entity;
        try {
          existing_entity = entities[entityName].find(
              (entity) => entity.id === new_entity.id,
          );
        } catch (err) {
          logger.warn(`Unable to search entities: ${err}`);
        }

        if (existing_entity) {
          logger.debug(
              `updating entity: ${new_entity.mainName}, ${JSON.stringify(
                  new_entity.aliases,
              )}, ${new_entity.id}, existing entity: ${
                existing_entity.mainName
              }, ${JSON.stringify(existing_entity.aliases)}, ${
                existing_entity.id
              }`,
          );
          Object.assign(existing_entity, new_entity);
        } else {
          logger.debug(
              `Adding entity: ${new_entity.mainName}, ${JSON.stringify(
                  new_entity.aliases,
              )}, ${new_entity.id}`,
          );
          entities[entityName].push(new_entity);
        }
      });
      logger.debug(
          `openai entity round. New entites: ${new_entities[entityName].length}, total entities: ${entities[entityName].length}`,
      );
    }

    // STEP 2: Simple Dedup.
    logger.debug(
        `STEP 2: Simple Deduping entites length: ${entities[entityName].length}`,
    );
    const deduped_entities = await nerFunctions.singleRequest(
        promptNames[1], // prompt name
        [],
        entities,
    );
    logger.debug(
        `deduped entities: ${JSON.stringify(deduped_entities, null, 2)}`,
    );

    deduped_entities.duplicates.forEach((duplicate) => {
      if (duplicate.firstOccurrence.id != duplicate.duplicate.id) {
        const firstOccurrence = entities[entityName].find(
            (entity) => entity.id === duplicate.firstOccurrence.id,
        );
        const duplicateEntity = entities[entityName].find(
            (entity) => entity.id === duplicate.duplicate.id,
        );

        if (firstOccurrence && duplicateEntity) {
          duplicateEntity.aliases.forEach((alias) => {
            alias = alias.toLowerCase();
            if (!firstOccurrence.aliases.includes(alias.toLowerCase())) {
              firstOccurrence.aliases.push(alias);
            }
          });
          entities[entityName] = entities[entityName].filter(
              (entity) => entity.id !== duplicate.duplicate.id,
          );
        }
      }
    });
    logger.debug(
        `STEP 3: deduped entities length: ${entities[entityName].length}`,
    );

    // STEP 3: DEDUP with text!
    const rawText = fullText.reduce((acc, item) => acc + item.text, "");
    const dedupedEntities = await nerFunctions.singleRequest(
        promptNames[2], // prompt name
        [{name: promptRecursiveReplaceKey, value: entities}],
        rawText,
    );
    logger.debug(
        `deduped entitys: ${JSON.stringify(dedupedEntities, null, 2)}`,
    );
    dedupedEntities.duplicates.forEach((duplicate) => {
      if (duplicate.firstOccurrence.id != duplicate.duplicate.id) {
        const firstOccurrence = entities[entityName].find(
            (entity) => entity.id === duplicate.firstOccurrence.id,
        );
        const duplicateEntity = entities[entityName].find(
            (entity) => entity.id === duplicate.duplicate.id,
        );
        if (firstOccurrence && duplicateEntity) {
          duplicateEntity.aliases.forEach((alias) => {
            alias = alias.toLowerCase();
            if (!firstOccurrence.aliases.includes(alias.toLowerCase())) {
              firstOccurrence.aliases.push(alias);
            }
          });
          entities[entityName] = entities[entityName].filter(
              (entity) => entity.id !== duplicate.duplicate.id,
          );
        }
      }
    });
    logger.debug(
        `complex deduped entities length: ${entities[entityName].length}`,
    );

    return entities;
  },
  nerIdentifyProps: async (
      prompt,
      promptRecursiveReplaceKey,
      promptContextReplaceKey,
      priming, // list of entities to prime the model with
      context, // List of context items, such as characters or locations.
      fullText, // full text, will chunk into smaller pieces
      entityName, // Name of entity inside the response of the ai JSON response { entityName:  []}
      chunkSize = DEFAULT_CHUNK_SIZE,
      overlap = DEFAULT_CHUNK_OVERLAP,
  ) => {
    const properties = priming;
    for (let i = overlap; i < fullText.length; i += chunkSize - overlap) {
      const start = i - overlap;
      const end = Math.min(start + chunkSize, fullText.length);
      logger.debug(`start: ${start}, end: ${end}`);
      const chapterChunkCSV = csv(fullText, start, end);
      const new_properties = await nerFunctions.singleRequest(
          prompt, // prompt name
          [
            {name: promptContextReplaceKey, value: context},
            {name: promptRecursiveReplaceKey, value: properties},
          ],
          chapterChunkCSV,
      );

      logger.debug(
          `openai properties round, properties length: ${new_properties[entityName].length}`,
      );

      properties[entityName] = properties[entityName].concat(
          new_properties[entityName],
      );
      // Simple deduplication.
      properties[entityName] = _.uniqWith(properties[entityName], _.isEqual);
    }
    return properties;
  },
  entityImageDescription: async (
      prompt,
      entites,
      entityName,
      properties,
      propertiesName,
      propertiesEntityKey,
      tokensPerMinute,
  ) => {
    // 1. create a list of all the properties for each entity.
    const propsList = [];
    const returnResults = {};
    const entityIndex = [];
    for (const item of entites[entityName]) {
      const specificEntityProps = properties[propertiesName].filter(
          (prop) => prop[propertiesEntityKey] === item.mainName,
      );
      specificEntityProps.forEach((prop) => {
        if (prop.relationship) {
          prop.has = prop.relationship;
          delete prop.relationship;
        }
      });
      if (!specificEntityProps || specificEntityProps.length === 0) {
        logger.debug(`no character properties found for ${item.mainName}`);
        continue;
      } else {
        propsList.push(specificEntityProps);
        entityIndex.push(item.mainName);
      }
      returnResults[item.mainName] = {};
      returnResults[item.mainName].aliases = item.aliases;
    }

    const descriptionResults = await nerFunctions.batchRequest({
      prompt,
      paramsList: [],
      textList: propsList,
      tokensPerMinute,
    });
    // logger.debug(`descriptionResults: ${JSON.stringify(descriptionResults, null, 2)}`);
    for (let i = 0; i < descriptionResults.length; i++) {
      const entityName = entityIndex[i];
      returnResults[entityName].description = descriptionResults[i].description;
    }

    return returnResults;
  },
  entityImageSummarize: async (prompt, entityDescriptions, tokensPerMinute) => {
    const descriptions = [];
    const names = [];
    for (const key in entityDescriptions) {
      if (entityDescriptions[key] && entityDescriptions[key].trim() !== "") {
        descriptions.push(entityDescriptions[key]);
        names.push(key);
      }
    }
    logger.debug(`descriptions: ${JSON.stringify(descriptions, null, 2)}`);
    logger.debug(`names: ${JSON.stringify(names, null, 2)}`);
    const descriptionSummaries = await nerFunctions.batchRequest({
      prompt,
      paramsList: [],
      textList: descriptions,
      tokensPerMinute,
      temp: 0.1,
      maxTokens: 4096,
      format: "text",
    });
    // need to map to characters and remove hyphens.
    for (let i = 0; i < descriptionSummaries.length; i++) {
      const key = names[i];
      let summary = descriptionSummaries[i].replace(/-\s/g, ". ").replace(/^\.\s/, "");
      summary = summary.replace(/- /g, ". ");
      summary = summary.replace(/\n/g, "");
      entityDescriptions[key] = summary;
    }
    return entityDescriptions;
  },
};

export default novel;
