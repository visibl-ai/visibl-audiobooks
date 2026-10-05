import {z} from "zod";

// v0.2 model choices come from the graph LLM benchmark (functions/test/graphBench, run bench-1).
// Requests go straight to OpenAI (openaiLLMRequest); reasoning models take an effort instead of
// temperature/top_p.
const openaiConfig = (effort) => ({
  max_tokens: 32000,
  reasoning: {effort},
});

const graphPrompts = {
  v0_2_get_characters_chunk: {
    systemInstruction: `
You are analyzing a portion of a chapter from the novel %NOVEL_TITLE% by %AUTHOR%. 
Your task is to identify ALL the character that appear in this text chunk.

Instructions:
1. List ONLY characters - no descriptions, titles, or context
2. Include EVERY character mentioned, no matter how minor or briefly
3. Include characters who are named, referenced, or mentioned in any way
4. Use the name as it appears in the text. If no name is provided, however the character is mentioned in the text
5. Do NOT include locations, objects, items
6. Do NOT include pronouns (he, her, him, she, they)
7. When in doubt, include the name - it's better to over-include than miss someone

Return a simple list of character names found in this text chunk.
    `,
    openAIModel: "gpt-6-luna",
    openAIGenerationConfig: openaiConfig("medium"),
    responseSchema: z.object({
      characters: z.array(z.string().describe("A character name found in the text"))
          .describe("List of all character names found in this chunk"),
    }),
  },
  v0_2_consolidate_characters: {
    systemInstruction: `
You are analyzing a chapter from the novel %NOVEL_TITLE% by %AUTHOR%. 
You have been provided with a list of character names extracted from this chapter, and your task is to consolidate this list by grouping names that refer to the same character.

Instructions:
1. Carefully read through the chapter text to understand which names refer to the same character
2. Group all variations, nicknames, and references to the same character together
3. Choose the most complete/formal name as the main name
4. List all other references as aliases, such as mis-spellings, nicknames, or other variations
5. Every character in the list must be in the JSON array, don't skip anything
6. If multiple entries could refer to the same character, merge them into one entry with all variations as aliases

The character list to consolidate is:
%CHARACTER_LIST%

Return a JSON array where each character has a main name and list of aliases.
    `,
    openAIModel: "gpt-6-luna",
    openAIGenerationConfig: openaiConfig("high"),
    responseSchema: z.object({
      characters: z.array(z.object({
        name: z.string().describe("The main/most formal name of the character"),
        aliases: z.array(z.string()).describe("All other names, nicknames, or references to this character"),
      })),
    }),
  },
  v0_2_character_properties: {
    systemInstruction: `
You are analyzing a portion of a chapter from the novel %NOVEL_TITLE% by %AUTHOR%.
You have been provided with a list of characters from this chapter, and your task is to identify STATIC PHYSICAL PROPERTIES that would help generate a neutral portrait image of these characters.

The chapter's characters are:
%CHARACTER_LIST%

Instructions:
1. Extract ONLY actual visual descriptions from the text - do NOT make up or infer properties
2. ALWAYS use the character's main name (the name in [brackets], NOT any aliases)
3. Include visual attributes ONLY if explicitly described in the text:
   - Physical build (height, body type, age appearance)
   - Skin (color, tone, permanent marks like scars, tattoos, birthmarks)
   - Hair (color, style, length, texture)
   - Face (eye color, facial features, bone structure)
   - Clothing and accessories being worn
   - Distinctive features or modifications

4. The "relationship" field describes the type of property:
   - GOOD: "height", "build", "skin_tone", "hair_color", "eye_color", "facial_features", "wearing", "clothing", "distinguishing_marks"
   - BAD: "action", "location", "reputation", "emotion", "carrying" (unless it's part of their appearance)

5. DO NOT include:
   - "No description provided" or "unknown" properties
   - Generic properties like "male", "female", "bartender", "waiter"
   - Actions or activities (running, talking, fighting, studying)
   - Locations or settings (sitting at bar, behind console)
   - Emotional states or expressions (angry, smiling)
   - Reputations or personality traits
   - Relationships with other characters
   - Duplicate properties for the same character

6. IMPORTANT: If a character has no visual descriptions in this chunk, DO NOT include them
7. It is perfectly acceptable to return an empty properties array if no visual descriptions are found

Examples:
GOOD: {"character": "mary", "relationship": "wearing", "property": "red dress"}
GOOD: {"character": "john", "relationship": "hair_color", "property": "dark brown"}
GOOD: {"character": "sam", "relationship": "facial_features", "property": "prominent scar across left cheek"}
BAD: {"character": "mary", "relationship": "location", "property": "ballroom"}
BAD: {"character": "john", "relationship": "action", "property": "running away"}

Return a JSON object with a "properties" array containing ONLY visual properties explicitly described in this text chunk. If no visual properties are found, return {"properties": []}.
    `,
    openAIModel: "gpt-4.1",
    openAIGenerationConfig: {
      temperature: 0.1,
      max_tokens: 8096,
      top_p: 1,
      provider: {
        only: ["openai"],
        order: ["openai"],
      },
    },
    responseSchema: z.object({
      properties: z.array(z.object({
        character: z.string().describe("The main name of the character (not an alias)"),
        relationship: z.string().describe("Visual property type (e.g., 'height', 'hair_color', 'wearing', 'facial_features')"),
        property: z.string().describe("The visual description of what can be seen"),
      })).describe("List of visual properties suitable for image generation"),
    }),
  },
  v0_2_character_properties_single: {
    systemInstruction: `
You are analyzing the complete text of a chapter from the novel %NOVEL_TITLE% by %AUTHOR%.
Your task is to identify STATIC PHYSICAL PROPERTIES for ONE SPECIFIC CHARACTER that would help generate a neutral portrait image.

You are looking for properties of this character:
Name: %CHARACTER_NAME%
Aliases: %CHARACTER_ALIASES%

Instructions:
1. Extract ONLY actual visual descriptions from the text - do NOT make up or infer properties
   - The description must explicitly mention THIS character by name or alias
   - Do NOT transfer properties from other characters

2. ALWAYS use the character's main name (%CHARACTER_NAME%) in your response, NOT any aliases

3. ONLY extract properties for the specified character - ignore all other characters

4. Include visual attributes ONLY if explicitly described in the text:
   - Gender (male, female  - based on pronouns, descriptions, or explicit mentions)
   - Physical build (height, body type, age appearance)
   - Skin (color, tone, permanent marks like scars, tattoos, birthmarks)
   - Hair (color, style, length, texture)
   - Face (eye color, facial features, bone structure)
   - Age, race, nationality, ethnicity, etc.
   - Clothing and accessories being worn
   - Distinctive features or modifications

5. The "relationship" field describes the type of property:
   - GOOD: "gender", "height", "build", "skin_tone", "hair_color", "eye_color", "facial_features", "wearing", "clothing", "distinguishing_marks"
   - BAD: "action", "location", "reputation", "emotion", "carrying" (unless it's part of their appearance)

6. DO NOT include:
   - Properties for any other characters
   - "No description provided" or "unknown" properties
   - Actions or activities (running, talking, fighting, studying)
   - Locations or settings (sitting at bar, behind console)
   - Emotional states or expressions (angry, smiling)
   - Reputations or personality traits
   - Relationships with other characters
   - Duplicate properties

7. Since you have the entire chapter, extract ALL visual properties for this character found anywhere in the text

8. It is perfectly normal and expected to return an empty properties array {"properties": []} if no visual descriptions are found for this character

Examples:
GOOD: {"character": "%CHARACTER_NAME%", "relationship": "gender", "property": "female"}
GOOD: {"character": "%CHARACTER_NAME%", "relationship": "gender", "property": "male"}
GOOD: {"character": "%CHARACTER_NAME%", "relationship": "wearing", "property": "red dress"}
GOOD: {"character": "%CHARACTER_NAME%", "relationship": "hair_color", "property": "dark brown"}
GOOD: {"character": "%CHARACTER_NAME%", "relationship": "facial_features", "property": "prominent scar across left cheek"}
BAD: {"character": "other_character", "relationship": "height", "property": "tall"} // WRONG CHARACTER
BAD: {"character": "%CHARACTER_NAME%", "relationship": "location", "property": "ballroom"} // LOCATIONS ARE NOT PROPERTIES
BAD: {"character": "%CHARACTER_NAME%", "relationship": "action", "property": "running away"} // ACTIONS ARE NOT PROPERTIES
BAD: {"character": "%CHARACTER_NAME%", "relationship": "gender", "property": "androgynous"} // BE SPECIFIC, DON'T BE AMBIGUOUS

Return a JSON object with a "properties" array containing ONLY visual properties for %CHARACTER_NAME% explicitly described in this chapter. If no visual properties are found, return {"properties": []}.
    `,
    openAIModel: "gpt-6-luna",
    openAIGenerationConfig: openaiConfig("high"),
    responseSchema: z.object({
      properties: z.array(z.object({
        character: z.string().describe("The main name of the character (not an alias)"),
        relationship: z.string().describe("Visual property type (e.g., 'height', 'hair_color', 'wearing', 'facial_features')"),
        property: z.string().describe("The visual description of what can be seen"),
      })).describe("List of visual properties suitable for image generation"),
    }),
  },
  v0_2_character_image_prompt: {
    systemInstruction: `
You are CharacterInterpreterGPT, an expert at creating vivid, detailed character descriptions for visual art generation.

Your task is to create a comprehensive visual description of a character from the novel %NOVEL_TITLE% by %AUTHOR%.
You will receive a character's name and their physical properties extracted from the text. Your goal is to synthesize these
into a rich, detailed portrait description suitable for image generation with GPT Image.

CRITICAL REQUIREMENTS:
1. You MUST use ALL physical properties provided in the input - these are extracted directly from the text and are your PRIMARY source
2. NEVER contradict or ignore any provided properties
3. Build your description around these properties, using them as the foundation
4. Only add details that complement and don't conflict with the given properties
5. Never be ambiguous, only define specific details, not ranges, likelyness, or other vague terms like "ambiguous" or "androgynous"

ADDITIONAL REQUIREMENTS:
1. You MUST include a specific apparent age
2. You MUST include a clear binary gender (male or female)
3. If age, gender, or ethnicity are not provided in the properties, make educated inferences based on:
   - The character's name and context
   - Your knowledge of the book (if familiar) - but NEVER override provided properties
   - Context clues from the given properties
   - Common patterns in the genre/setting

DESCRIPTION GUIDELINES:
1. Start with the provided properties and weave them into a vivid, natural description
2. Include EVERY provided physical attribute without exception
3. You may carefully add complementary details about:
   - Facial features (if not conflicting with provided descriptions)
   - Body posture and bearing (if it fits the provided properties)
   - Additional clothing details (that match the style of provided clothing)
   - Overall atmosphere (that aligns with the provided characteristics)
4. Use rich, descriptive language that paints a clear mental picture
5. Focus on visual elements only - no personality traits or backstory unless directly tied to appearance

STYLE NOTES:
- Write in present tense ("She has..." not "She had...")
- Use specific, evocative adjectives
- Create a cohesive image that feels like a portrait or character study
- Consider the book's setting and time period for appropriate styling

The input will contain:
- Character: The character's name
- Novel context: %NOVEL_TITLE% by %AUTHOR%
- Physical properties: A list of extracted physical attributes

Return a JSON object with the character name and a detailed, vivid description of their physical appearance.
    `,
    openAIModel: "gpt-5.6-luna",
    openAIGenerationConfig: openaiConfig("medium"),
    responseSchema: z.object({
      character: z.string().describe("The character's name"),
      description: z.string().describe("A descriptive sentence of the character's physical appearance suitable for image generation"),
    }),
  },
  v0_2_get_locations_chunk: {
    systemInstruction: `
You are analyzing a portion of a chapter from the novel %NOVEL_TITLE% by %AUTHOR%. 
Your task is to identify ALL the locations that appear in this text chunk.

Instructions:
1. List ONLY locations - no descriptions, character names, or context
2. Include EVERY location mentioned, no matter how minor or briefly
3. Include locations that are named, referenced, or mentioned in any way
4. Use the name as it appears in the text
5. Include both specific places (e.g., "the library", "Central Station") and general areas (e.g., "the city", "downtown")
6. Do NOT include objects or parts of a room (e.g., "a window", "the desk", "the back wall"), characters or people, nationalities or other adjectives (e.g., "French"), or the names of games, shows or programs
7. Do NOT include generic terms like "there", "here", "place"
8. When in doubt, include the location - it's better to over-include than miss one

Return a simple list of location names found in this text chunk.
    `,
    openAIModel: "gpt-6-luna",
    openAIGenerationConfig: openaiConfig("medium"),
    responseSchema: z.object({
      locations: z.array(z.string().describe("A location name found in the text"))
          .describe("List of all location names found in this chunk"),
    }),
  },
  v0_2_consolidate_locations: {
    systemInstruction: `
You are analyzing a chapter from the novel %NOVEL_TITLE% by %AUTHOR%. 
You have been provided with a list of location names extracted from this chapter, and your task is to consolidate this list by grouping names that refer to the same location.

Instructions:
1. Carefully read through the chapter text to understand which names refer to the same location
2. Group all variations, nicknames, and references to the same location together
3. Choose the most complete/formal name as the main name
4. List all other references as aliases
5. Consider nested locations (e.g., "office" might be inside "building" or "downtown")
6. Every location in the list must be in the JSON array, don't skip anything
7. Don't consolidate places inside another place. For example "Room 44" inside "Hotel" is not a valid consolidation.

The location list to consolidate is:
%LOCATION_LIST%

Return a JSON array where each location has a main name and list of aliases.
    `,
    openAIModel: "gpt-6-luna",
    openAIGenerationConfig: openaiConfig("high"),
    responseSchema: z.object({
      locations: z.array(z.object({
        name: z.string().describe("The main/most formal name of the location"),
        aliases: z.array(z.string()).describe("All other names, nicknames, or references to this location"),
      })),
    }),
  },
  v0_2_location_properties: {
    systemInstruction: `
You are analyzing a portion of a chapter from the novel %NOVEL_TITLE% by %AUTHOR%.
You have been provided with a list of locations from this chapter, and your task is to identify STATIC VISUAL/DESCRIPTIVE PROPERTIES that would help generate an atmospheric image of these locations.

The chapter's locations are:
%LOCATION_LIST%

Instructions:
1. Extract ONLY actual descriptions from the text - do NOT make up or infer properties
2. ALWAYS use the location's main name (the name in [brackets], NOT any aliases)
3. Include descriptive attributes ONLY if explicitly described in the text:
   - Architecture and structure (size, style, materials, design)
   - Atmosphere (lighting, mood, ambiance - but NOT people creating that mood)
   - Interior features (furniture, decor, layout - but NOT what people are doing with them)
   - Exterior features (surroundings, entrance, facade)
   - Environmental details (weather, sky, time of day effects)
   - Distinctive physical features or characteristics

4. The "relationship" field describes the type of property:
   - GOOD: "architecture", "atmosphere", "interior", "exterior", "lighting", "style", "environment", "distinctive_features"
   - BAD: "occupants", "events", "actions", "character_presence", "people", "activities"

5. DO NOT include:
   - "No description provided" or "unknown" properties
   - Generic properties like "building", "place", "area"
   - Actions or events happening in the location
   - Characters, people, or occupants in the location
   - What people are doing, wearing, or saying
   - Character descriptions or character actions
   - Duplicate properties for the same location

6. FOCUS ONLY ON THE PHYSICAL SPACE ITSELF:
   - The building/structure
   - The environment/atmosphere of the space itself
   - Fixed features and decorations
   - NOT the people inside or what they're doing

7. IMPORTANT: If a location has no visual descriptions in this chunk, DO NOT include it
8. It is perfectly acceptable to return an empty properties array if no visual descriptions are found

Examples:
GOOD: {"location": "library", "relationship": "atmosphere", "property": "dim lighting filtered through stained glass"}
GOOD: {"location": "bar", "relationship": "interior", "property": "polished mahogany counter"}
GOOD: {"location": "city center", "relationship": "architecture", "property": "glass and steel towers"}
GOOD: {"location": "apartment", "relationship": "interior", "property": "peeling wallpaper and water-stained ceiling"}
BAD: {"location": "cafe", "relationship": "interior", "property": "waiter with a prosthetic arm"}
BAD: {"location": "bar", "relationship": "atmosphere", "property": "crowded with expatriates"}
BAD: {"location": "shop", "relationship": "interior", "property": "owner wearing a blue suit"}
BAD: {"location": "street", "relationship": "environment", "property": "people walking by"}

Return a JSON object with a "properties" array containing ONLY visual/descriptive properties explicitly described in this text chunk. If no visual properties are found, return {"properties": []}.
    `,
    openAIModel: "gpt-4.1",
    openAIGenerationConfig: {
      temperature: 0.1,
      max_tokens: 8096,
      top_p: 1,
      provider: {
        only: ["openai"],
        order: ["openai"],
      },
    },
    responseSchema: z.object({
      properties: z.array(z.object({
        location: z.string().describe("The main name of the location (not an alias)"),
        relationship: z.string().describe("Visual property type (e.g., 'architecture', 'atmosphere', 'interior', 'lighting')"),
        property: z.string().describe("The visual/descriptive detail"),
      })).describe("List of visual properties suitable for image generation"),
    }),
  },
  v0_2_location_properties_single: {
    systemInstruction: `
You are analyzing the complete text of a chapter from the novel %NOVEL_TITLE% by %AUTHOR%.
Your task is to identify STATIC VISUAL/DESCRIPTIVE PROPERTIES for ONE SPECIFIC LOCATION that would help generate an atmospheric image.

You are looking for properties of this location:
Name: %LOCATION_NAME%
Aliases: %LOCATION_ALIASES%

Instructions:
1. Extract ONLY actual descriptions from the text - do NOT make up or infer properties
   - The description must explicitly mention THIS location by name or alias
   - Do NOT transfer properties from other locations

2. ALWAYS use the location's main name (%LOCATION_NAME%) in your response, NOT any aliases

3. ONLY extract properties for the specified location - ignore all other locations

4. Include descriptive attributes ONLY if explicitly described in the text:
   - Architecture and structure (size, style, materials, design)
   - Atmosphere (lighting, mood, ambiance - but NOT people creating that mood)
   - Interior features (furniture, decor, layout - but NOT what people are doing with them)
   - Exterior features (surroundings, entrance, facade)
   - Environmental details (weather, sky, time of day effects)
   - Distinctive physical features or characteristics

5. The "relationship" field describes the type of property:
   - GOOD: "architecture", "atmosphere", "interior", "exterior", "lighting", "style", "environment", "distinctive_features"
   - BAD: "occupants", "events", "actions", "character_presence", "people", "activities"

6. DO NOT include:
   - Properties for any other locations
   - "No description provided" or "unknown" properties
   - Generic properties like "building", "place", "area"
   - Actions or events happening in the location
   - Characters, people, or occupants in the location
   - What people are doing, wearing, or saying
   - Character descriptions or character actions
   - Duplicate properties

7. FOCUS ONLY ON THE PHYSICAL SPACE ITSELF:
   - The building/structure
   - The environment/atmosphere of the space itself
   - Fixed features and decorations
   - NOT the people inside or what they're doing

8. Since you have the entire chapter, extract ALL visual properties for this location found anywhere in the text

9. It is perfectly normal and expected to return an empty properties array {"properties": []} if no visual descriptions are found for this location

Examples:
GOOD: {"location": "%LOCATION_NAME%", "relationship": "atmosphere", "property": "dim lighting filtered through stained glass"}
GOOD: {"location": "%LOCATION_NAME%", "relationship": "interior", "property": "polished mahogany counter"}
GOOD: {"location": "%LOCATION_NAME%", "relationship": "architecture", "property": "glass and steel towers"}
GOOD: {"properties": []} (when location is mentioned but has no visual descriptions)
BAD: {"location": "other_location", "relationship": "interior", "property": "marble floors"} (wrong location)
BAD: {"location": "%LOCATION_NAME%", "relationship": "interior", "property": "waiter with a prosthetic arm"}
BAD: {"location": "%LOCATION_NAME%", "relationship": "atmosphere", "property": "crowded with expatriates"}

Return a JSON object with a "properties" array containing ONLY visual properties for %LOCATION_NAME% explicitly described in this chapter. If no visual properties are found, return {"properties": []}.
    `,
    openAIModel: "gpt-5.6-luna",
    openAIGenerationConfig: openaiConfig("high"),
    responseSchema: z.object({
      properties: z.array(z.object({
        location: z.string().describe("The main name of the location (not an alias)"),
        relationship: z.string().describe("Visual property type (e.g., 'architecture', 'atmosphere', 'interior', 'lighting')"),
        property: z.string().describe("The visual/descriptive detail"),
      })).describe("List of visual properties suitable for image generation"),
    }),
  },
  v0_2_location_image_prompt: {
    systemInstruction: `
You are LocationInterpreterGPT, an expert at creating vivid, detailed location descriptions for visual art generation.

Your task is to create a comprehensive visual description of a location from the novel %NOVEL_TITLE% by %AUTHOR%.
You will receive a location's name and their descriptive properties extracted from the text. Your goal is to synthesize these
into a rich, detailed atmospheric description suitable for image generation with GPT Image.

CRITICAL REQUIREMENTS:
1. You MUST use ALL descriptive properties provided in the input - these are extracted directly from the text and are your PRIMARY source
2. NEVER contradict or ignore any provided properties
3. Build your description around these properties, using them as the foundation
4. Only add details that complement and don't conflict with the given properties

ADDITIONAL REQUIREMENTS:
1. You MUST establish a clear sense of scale and perspective
2. You MUST include atmospheric elements (lighting, mood, ambiance)
3. If time of day or weather are not provided in the properties, make educated inferences based on:
   - The location type and setting
   - Your knowledge of the book (if familiar) - but NEVER override provided properties
   - Context clues from the given properties
   - Common patterns in the genre/setting

DESCRIPTION GUIDELINES:
1. Start with the provided properties and weave them into a vivid, natural description
2. Include EVERY provided descriptive attribute without exception
3. You may carefully add complementary details about:
   - Architectural style (if not conflicting with provided descriptions)
   - Environmental atmosphere (that matches the provided mood)
   - Additional visual elements (that enhance the provided characteristics)
   - Perspective and composition suggestions
4. Use rich, descriptive language that paints a clear mental picture
5. Focus on visual elements only - no events, characters, or actions

STYLE NOTES:
- Write in present tense ("The bar features..." not "The bar featured...")
- Use specific, evocative adjectives
- Create a cohesive image that feels like an establishing shot or environment concept art
- Consider the book's setting and time period for appropriate styling

The input will contain:
- Location: The location's name
- Novel context: %NOVEL_TITLE% by %AUTHOR%
- Descriptive properties: A list of extracted visual attributes

Return a JSON object with the location name and a detailed, vivid description of its appearance.
    `,
    openAIModel: "gpt-5.6-luna",
    openAIGenerationConfig: openaiConfig("medium"),
    responseSchema: z.object({
      location: z.string().describe("The location's name"),
      description: z.string().describe("A descriptive sentence of the location's appearance suitable for image generation"),
    }),
  },
  v0_2_character_image_summarize: {
    systemInstruction: `
You are CharacterInterpreterGPT. Your task is to summarize a character description by focusing solely on physical characteristics. This summary will be used to generate a visual image using GPT Image, so it's crucial to include only the physical traits.

Follow these guidelines to create your summary:

1. Focus only on physical traits, including:
   - Age
   - Gender
   - Race (if provided or can be inferred)
   - Physical appearance
   - Clothing and accessories worn by the character
   - Items the character might be holding

2. Exclude:
   - Non-physical traits (personality, background, etc.)
   - Any context or setting information

3. Format your response in point form, without any gap words or explanations of your reasoning.

4. Include all relevant physical details provided in the description.

5. If any key physical characteristics (age, gender, race) are not explicitly stated but can be reasonably inferred, include them in your summary.

Include every relevant physical detail without any additional explanation.
    `,
    openAIModel: "gpt-5.6-luna",
    openAIGenerationConfig: openaiConfig("medium"),
  },
  v0_2_location_image_summarize: {
    systemInstruction: `
You are LocationInterpreterGPT. Your task is to interpret and summarize a given location description, focusing solely on its physical characteristics. This summary will be used to generate a visual image using GPT Image, so it's crucial to include only the physical aspects of the location.

Follow these steps to summarize the location:

1. Read the description carefully.
2. Identify all physical characteristics of the location.
3. Remove any mentions of non-physical traits, such as historical significance, emotional atmosphere, or cultural importance.
4. Exclude any descriptions of characters or people that might be present in the location.
5. Summarize the physical aspects in a concise, point-form format.
6. Include all relevant physical details, no matter how small.
7. Do not use any filler words, explanations, or transition phrases.

Remember:
- Include ONLY physical characteristics that can be visually represented.
- Do NOT include any non-physical traits or descriptions of characters.
- Be comprehensive - do not leave out any physical details from the original description.
- Do NOT include any explanations or reasoning for your choices.
- Use concise language without any gap words or filler phrases.
    `,
    openAIModel: "gpt-5.6-luna",
    openAIGenerationConfig: openaiConfig("medium"),
  },
  v0_2_generate_scenes: ({minScenes, isLastAttempt = false}) => ({
    systemInstruction: `
You are CinematographerGPT.

You are being provided a CSV with the raw text of a novel. The "text" column
of the CSV contains individual sentences from the chapter. The "startTime" of the CSV
is the time in seconds when the narrator reaches the sentence.
You are also being provided a list of characters, and a list of locations also in CSV format.
Pay close attention to the aliases of each character and location.

You are collaborating with a film director to adapt this novel into a movie.
Your task is to create a storyboard that the film crew will use to craft the movie scenes.

Read the text and generate a storyboard object for each key frame of the scene in the chapter.
Each storyboard object should provide a clear and structured snapshot of what will be captured in that specific key frame,
rather than describing a continuous moving scene.
 A storyboard object is:
  a "scene_number" increasing one by one
  a "description" of the scene, which is very detailed and outlines exactly what is happening. Take a lot of the text from the chapter and insert it here.
  a "startTime" of the scene, based on the start_time of the sentences in the csv file the scene captures. Each scene must start after the previous scene.
  a "character" array of characters in the scene (up to 2 characters), can be empty to setup a scene or location
  a "locations" array of locations in the scene (up to 1 location)
  a "viewpoint" {
  "setting": "time of day and lightning of the scene",
  "placement": "Placement of characters or other points of focus",
  "shot_type": "wide, medium or close-up shot, camera angle",
  "mood": "mood of the scene",
  "technical": "lens choices and aperture settings"
  }

Only refer to characters by their name from the Character List.
Only refer to locations by their name from the Locations List.

If the text introduces a new character, or location, or other object, the storyboard can simply include a closeup of that subject.
You must create enough key frames to cover the entire raw text. Avoid creating key frames that are too similar to each other.
You MUST generate at least ${minScenes} key frames (approximately one every 15 seconds), and at most one every 5 seconds.

---Example Start---
List of Characters in CSV:
name, aliases
"vera chen","the detective, chen"
"marcus rivera","the ghost, rivera"
"silent witness",""

List of Locations in CSV:
name, aliases
"abandoned pier", "pier",
"warehouse district", "the district"
"shipping containers", "maze"
"the edge", "precipice"

Chapter JSON File:
"id","startTime","text"
0,"4.5","The rain hammered against the corrugated metal roofs of the warehouse district like a thousand desperate fists."
1,"7.2","Vera Chen pulled her collar higher, water streaming from the brim of her fedora as she navigated the maze of shadows."
2,"10.8","Each footstep echoed in the narrow alleyways, swallowed by the storm's relentless symphony."
3,"13.4","She could taste salt in the air - they were close to the pier now."
4,"15.9","The abandoned warehouses loomed like tombstones, their broken windows weeping rainwater."
5,"18.6","Ahead, through the curtain of rain, she glimpsed the skeletal remains of Pier 47."
6,"21.3","Once bustling with life, now it stood as a monument to the city's decay."
7,"24.1","The wooden planks groaned beneath her weight, slick with algae and neglect."
8,"26.8","Lightning split the sky, illuminating the maze of shipping containers ahead."
9,"29.5","In that flash, she saw him - Marcus 'The Ghost' Rivera, waiting at the edge."
10,"32.2","His silhouette was unmistakable, even after five years."
11,"34.7","The same broad shoulders that once carried her to safety, now turned against the storm."
12,"37.4","'You came,' his voice carried over the wind, rough as gravel."
13,"39.8","Vera's hand instinctively moved to her holster, fingers dancing over cold steel."
14,"42.3","'You didn't leave me much choice, Marcus.'"
15,"44.6","He turned slowly, rain cascading off his leather coat like a waterfall."
16,"47.2","The scar across his left eye seemed deeper in the darkness, a canyon of regret."
17,"50.1","'There's always a choice, Chen. You taught me that.'"
18,"52.8","Between them, the pier stretched out into the black water, waves crashing hungrily below."
19,"55.6","A figure emerged from behind a container - the silent witness they both sought."
20,"58.3","Wrapped in shadows and secrets, face obscured by a hood."
21,"60.9","'Thirty seconds,' the witness whispered. 'Then they'll know we're here.'"
22,"63.4","Vera felt time compress, each heartbeat a thunderclap."
23,"65.8","The rain intensified, as if the sky itself was trying to wash away their sins."

Storyboard object:
{scenes: 
    [{scene_number: 1, 
      description: 'Establishing shot of the rain-soaked warehouse district at night. Rain pounds relentlessly on corrugated metal roofs, creating rivers in the alleyways. Industrial decay is evident everywhere - rust, broken windows, and abandoned machinery barely visible through the downpour.', 
      characters: [], 
      locations: ['warehouse district'],
      startTime: 4.5,
      viewpoint: {
        "setting": "night, heavy storm, minimal street lighting creating pools of darkness",
        "placement": "aerial view slowly descending into the maze of warehouses",
        "shot_type": "wide establishing shot, slow crane down",
        "mood": "ominous, noir atmosphere with industrial decay",
        "technical": "24mm f/2.8, high contrast with deep blacks"
        }
    }, 
    {scene_number: 2, 
      description: 'Detective Vera Chen emerges from shadows, water cascading from her fedora. She pulls her trench coat collar higher against the storm. Her face is partially obscured but determination is evident in her posture. Each footstep splashes through puddles, the sound swallowed by rain.', 
      characters: ['vera chen'], 
      locations: ['warehouse district'],
      startTime: 7.2,
      viewpoint: {
        "setting": "continuing storm, intermittent lightning",
        "placement": "low angle following Vera through narrow alley",
        "shot_type": "medium tracking shot from behind",
        "mood": "tense, determined, film noir aesthetic",
        "technical": "50mm f/1.8, shallow depth of field"
        }
    },
    {scene_number: 3, 
      description: 'The abandoned Pier 47 reveals itself through the rain curtain. Skeletal wooden structures jut into the stormy harbor. Broken planks and rusted metal create a treacherous landscape. Waves crash violently against the pillars below.', 
      characters: [], 
      locations: ['abandoned pier'],
      startTime: 18.6,
      viewpoint: {
        "setting": "storm intensifying, lightning flashes illuminate decay",
        "placement": "Vera's POV as she approaches the pier",
        "shot_type": "wide shot revealing the pier's full desolation",
        "mood": "foreboding, dangerous, abandoned",
        "technical": "35mm f/4, deep focus to capture environmental detail"
        }
    },
    {scene_number: 4, 
      description: 'Lightning flash reveals Marcus "The Ghost" Rivera standing at the pier edge. His broad silhouette cuts against the storm, leather coat billowing. Rain streams off him like he's part of the tempest itself. His stance suggests both threat and tragedy.', 
      characters: ['marcus rivera'], 
      locations: ['abandoned pier'],
      startTime: 29.5,
      viewpoint: {
        "setting": "dramatic lightning strike, momentary brilliant illumination",
        "placement": "Marcus framed against the violent sea",
        "shot_type": "dramatic wide shot, slight low angle",
        "mood": "epic confrontation, noir tragedy",
        "technical": "85mm f/2, compressed perspective"
        }
    },
    {scene_number: 5, 
      description: 'Close confrontation between Vera and Marcus. The camera captures the weight of their shared history - her hand hovering near her holster, his scarred face revealed as he turns. Rain streams between them like a curtain of regret. The pier groans beneath their feet.', 
      characters: ['vera chen', 'marcus rivera'], 
      locations: ['abandoned pier'],
      startTime: 42.3,
      viewpoint: {
        "setting": "continuous rain, distant thunder, minimal lighting",
        "placement": "alternating over-shoulder shots showing both faces",
        "shot_type": "intimate medium shots, cutting between perspectives",
        "mood": "tense reunion, unresolved history, danger",
        "technical": "75mm f/2.8, focus on eyes and expressions"
        }
    },
    {scene_number: 6, 
      description: 'The silent witness emerges from shipping container shadows like a specter. Hood obscuring features, they embody mystery itself. The countdown begins - "Thirty seconds." The frame captures all three figures in a triangle of tension as rain intensifies to near-biblical proportions.', 
      characters: ['silent witness', 'vera chen'], 
      locations: ['shipping containers'],
      startTime: 55.6,
      viewpoint: {
        "setting": "storm reaching crescendo, visibility dropping",
        "placement": "wide shot showing spatial relationship of all three",
        "shot_type": "wide shot pulling back to reveal the trap closing",
        "mood": "climactic tension, time running out",
        "technical": "40mm f/2.8, high contrast noir lighting"
        }
    }
]}
---Example End---
Do not simply repeat dialogue from the text - describe in words what is happening so it can be visualised.
You MUST generate at least ${minScenes} key frames (approximately one every 15 seconds), and at most one every 5 seconds.

List of Characters in CSV:
%CHARACTER_LIST%

List of Locations in CSV:
%LOCATION_LIST%
    `,
    openAIModel: "gpt-5.6-luna",
    openAIGenerationConfig: openaiConfig("medium"),
    responseSchema: z.object({
      scenes: z.array(z.object({
        scene_number: z.number().describe("Sequential scene number starting from 1"),
        description: z.string().describe("Detailed description of what is happening in the scene"),
        startTime: z.number().describe("Start time in seconds based on the transcription timestamps. Each scene must start after the previous scene."),
        characters: z.array(z.string()).describe("Array of character names from the provided character list (up to 2)"),
        locations: z.array(z.string()).describe("Array of location names from the provided location list (up to 1)"),
        viewpoint: z.object({
          setting: z.string().describe("Time of day and lighting of the scene"),
          placement: z.string().describe("Placement of characters or other points of focus"),
          shot_type: z.string().describe("Wide, medium or close-up shot, camera angle"),
          mood: z.string().describe("Mood of the scene"),
          technical: z.string().describe("Lens choices and aperture settings"),
        }),
      })).min(isLastAttempt ? 1 : minScenes).describe("Array of scene storyboard objects"),
    }),
  }),
  v0_2_character_continuity: {
    systemInstruction: `
You are tasked with analyzing characters from two distinct chapters of the novel %NOVEL_TITLE% by %AUTHOR%. Your goal is to determine which characters from the current chapter correspond to entities from a previous chapter.
Begin with a concise checklist (3-7 bullets) of what you will do; keep items conceptual, not implementation-level.
## Instructions
1. Compare characters based on their names and aliases.
2. Account for variations such as spelling differences, nicknames, titles, and indirect references.
3. Possible character matches include:
- **Exact name match** (e.g., "John" ↔ "John").
- **Alias overlap** (e.g., "the detective" in one chapter and "Detective Smith", who is also referred to as "the detective", in another).
- **Nickname and formal name correspondence** (e.g., "Bob" ↔ "Robert").
- **Equivalent roles or descriptions** (e.g., "the mayor" ↔ "Mayor Johnson", who is described as "the mayor").
- **Title variations** (e.g., "Dr. Smith" ↔ "Doctor Smith" ↔ "Smith").
4. For each match, assign a confidence level:
- **high**: Identical name or strong alias overlap.
- **medium**: Strong contextual similarity or partial overlap.
- **low**: Possible match, but uncertain.
- **none**: No match found.
5. Only include matches where the confidence is "low", "medium", or "high" (exclude "none").
6. Each character from the current chapter should appear no more than once in the final matches.
After all matches are identified, briefly validate that each match aligns with the stated confidence levels and the given rationale. If a match appears ambiguous or unsubstantiated, self-correct by either adjusting its confidence, clarifying the rationale, or omitting it if it does not meet the criteria.

If no matches meet the criteria, return an empty array.
    `,
    openAIModel: "gpt-6-luna",
    openAIGenerationConfig: openaiConfig("medium"),
    responseSchema: z.object({
      matches: z.array(z.object({
        currentEntity: z.string().describe("Name or identifier from the current chapter."),
        previousEntity: z.string().describe("Name or identifier from the previous chapter."),
        confidence: z.enum(["high", "medium", "low"]).describe("The assigned confidence level"),
        reason: z.string().describe("Concise rationale for the match (e.g., name match, alias overlap, title variation)."),
      })).describe("Array of character matches between chapters"),
    }),
  },
  v0_2_location_continuity: {
    systemInstruction: `
You are tasked with comparing locations from two different chapters of the novel %NOVEL_TITLE% by %AUTHOR%. The goal is to determine which locations in the current chapter correspond to locations from a previous chapter.
Begin with a concise checklist (3-7 bullets) of what you will do; keep items conceptual, not implementation-level.
Instructions:
1. Compare locations based on their names and aliases.
2. Account for possible variations in how a place is referenced, including:
- Exact name matches (e.g., "London" and "London")
- Aliases or alternative names (e.g., "the library" vs. "City Library" with alias "the library")
- Abbreviations or expansions (e.g., "the pub" and "The Red Lion Pub")
- Descriptive variations when context strongly indicates they're the same place (e.g., "the old mansion" and "the abandoned house")
3. For each identified match, assign a confidence level of:
- "high": Same location with clear name/alias match
- "medium": Same location with different descriptive terms
- "low": Possibly the same location but uncertain
- "none": Different locations OR one is part of another
4. Report only matches with confidence of "low" or greater.
5. Each location from the current chapter may only be included once in the output.
6. Avoid matching overly generic locations (such as "street" or "room") unless external evidence indicates they are the same specific place.
7. Never match a sub-location to its parent location (e.g., a room to its building, a section to its area, a feature to its containing space).
Set reasoning_effort = medium to ensure reliable yet efficient matching.
Return the results as a JSON array of matched locations between chapters, including confidence levels.
    `,
    openAIModel: "gpt-6-luna",
    openAIGenerationConfig: openaiConfig("medium"),
    responseSchema: z.object({
      matches: z.array(z.object({
        currentEntity: z.string().describe("Location name from the current chapter"),
        previousEntity: z.string().describe("Matching location name from the previous chapter"),
        confidence: z.enum(["high", "medium", "low"]).describe("Confidence level of the match"),
        reason: z.string().describe("Brief explanation of why these are the same location"),
      })).describe("Array of location matches between chapters"),
    }),
  },
  v0_2_filter_character_continuity_properties: {
    systemInstruction: `
You are analyzing character properties from the novel %NOVEL_TITLE% by %AUTHOR%.
Your task is to determine which properties from a PREVIOUS chapter still apply to a character in the CURRENT chapter.

You will be given:
1. Properties from the CURRENT chapter for a specific character
2. Properties from a PREVIOUS chapter for the same character (verified through continuity matching)

Your goal is to filter the previous chapter properties and return ONLY those that still apply given the current chapter context.

## Filtering Rules:

### ALWAYS KEEP (unless directly contradicted):
- Gender, ethnicity, race
- Permanent physical features: scars, tattoos, birthmarks, missing limbs
- Core physical attributes: eye color, natural hair color (unless dyed), skin tone
- Facial features: bone structure, nose shape, distinctive features
- Body type/build (unless significant time has passed or transformation mentioned)
- Age-related features (adjusted for time progression)

### EVALUATE BASED ON CONTEXT:
- Hair style/length: May change between chapters
- Facial hair: Can be grown or shaved
- Weight/fitness: May change over time
- Injuries: Consider if they would have healed

### Only replace or drop if conflicting:
- Clothing: Keep unless current chapter describes different clothing for same body part
- Temporary states: Keep unless current chapter describes a different state
- Emotional expressions: Keep unless conflicting emotion shown
- Objects held: If a character was holding an unimportant object in the previous chapter, drop it if it's not mentioned in the current chapter

## Decision Process:
1. Default to keeping properties - absence doesn't mean change
2. Only drop if current chapter explicitly contradicts
3. When in doubt, keep the property
4. Properties are cumulative, not exclusive

Return a JSON object with the filtered properties that should be carried forward from the previous chapter.
    `,
    openAIModel: "gpt-6-luna",
    openAIGenerationConfig: openaiConfig("high"),
    responseSchema: z.object({
      filteredProperties: z.array(z.object({
        relationship: z.string().describe("Visual property type"),
        property: z.string().describe("The visual description"),
      })).describe("Properties from previous chapter that still apply"),
      reasoning: z.string().describe("Brief explanation of filtering decisions"),
    }),
  },
  v0_2_filter_location_continuity_properties: {
    systemInstruction: `
You are analyzing location properties from the novel %NOVEL_TITLE% by %AUTHOR%.
Your task is to determine which properties from a PREVIOUS chapter still apply to a location in the CURRENT chapter.

You will be given:
1. Properties from the CURRENT chapter for a specific location
2. Properties from a PREVIOUS chapter for the same location (verified through continuity matching)

Your goal is to filter the previous chapter properties and return ONLY those that still apply given the current chapter context.

## Filtering Rules:

### ALWAYS KEEP (unless directly contradicted):
- Architectural features: building materials, structural design, layout
- Permanent fixtures: built-in furniture, architectural details, fixed decorations
- Size and scale: room dimensions, building height, spatial relationships
- Core infrastructure: plumbing, electrical, foundational elements
- Historical or aged features: wear patterns, structural damage, patina

### EVALUATE BASED ON CONTEXT:
- Lighting conditions: Time of day may affect natural lighting
- Weather-dependent features: May change between chapters
- Seasonal decorations: Consider time progression
- Renovations: Look for mentions of changes or updates

### Only replace if conflicting:
- Furniture: Keep unless explicitly moved or replaced
- Decorations: Keep unless current chapter describes different ones
- Weather/lighting: Keep unless current chapter describes different conditions
- Activity levels: Keep unless explicitly changed

## Decision Process:
1. Default to keeping properties - absence doesn't mean change
2. Only drop if current chapter explicitly contradicts
3. When in doubt, keep the property
4. Properties are cumulative, not exclusive

Return a JSON object with the filtered properties that should be carried forward from the previous chapter.
    `,
    openAIModel: "gpt-6-luna",
    openAIGenerationConfig: openaiConfig("high"),
    responseSchema: z.object({
      filteredProperties: z.array(z.object({
        relationship: z.string().describe("Visual property type"),
        property: z.string().describe("The visual description"),
      })).describe("Properties from previous chapter that still apply"),
      reasoning: z.string().describe("Brief explanation of filtering decisions"),
    }),
  },
  v0_2_augment_scene_prompt: {
    systemInstruction: `You are an expert at creating detailed, vivid image generation prompts. Given scene metadata including description, characters, locations, and viewpoint details, create a comprehensive, vivid prompt that captures all visual elements, atmosphere, mood, and technical specifications for image generation. Focus on visual details, lighting, composition, colors, textures, and any specific technical camera settings provided. Never modify the ethnicity of a character. The image should be visually appealing, creative, evocative and engaging with a wow factor.`,
    openAIModel: "gpt-5.6-luna",
    openAIGenerationConfig: openaiConfig("medium"),
  },
};

export default graphPrompts;
