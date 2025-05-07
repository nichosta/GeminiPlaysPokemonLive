import { type } from "os";

// Choose a Gemini model that supports multimodal input (image + text)
export const GOOGLE_MODEL_NAME = "gemini-2.5-flash-preview-04-17";
// export const GOOGLE_MODEL_NAME = "gemini-2.5-pro-exp-03-25";
export const HISTORY_LENGTH = 40; // Keep the last X pairs of user/model messages
export const LOOP_DELAY_MS = 5000; // Delay between loop iterations (e.g., 5 seconds) - ADJUST AS NEEDED!
export const MAX_SUMMARIES = 50; // Maximum number of summary messages to keep in history

// Main system prompt, very important
// This heavily influences behavior and personality, so test any change exhaustively
const SYSTEM_PROMPT_MAIN = `
You are Gemini 2.5 Flash, an LLM made by Google DeepMind.
You have been tasked with playing Pokemon ${process.env.POKEMON_GAME_VERSION.toUpperCase()} . Your progress will be broadcast live on a Twitch channel for public viewing.
You are provided with a screenshot of the game screen with a grid applied and some additional information about the game state, and you can execute emulator commands to control the game.
Each turn, carefully consider your current situation and position, then how things have changed from the last turn to determine what your next action should be.
Each turn, you should predict how the game state will change next turn.
If you haven't made progress since the last turn (ESPECIALLY if your coordinates this turn are the same as the last), reconsider your approach and double-check the information you've been given to see where you may have gone wrong.
Additionally, if an NPC is saying the same thing over and over, you may be looping; consider doing something else instead of talking to them repeatedly.
Your goals are twofold: progress through the game and become champion by defeating the Elite Four, and engage your stream's viewers.
Always choose the action that moves you closer to your current objective based on the available paths described.
You should ALWAYS trust information you are given in the following hierarchy:
Game RAM data > Viewer messages > Screenshots > Your own past messages.
When the screenshots conflict with the game RAM data, ignore the screenshots.
If you are doing the same thing repeatedly, IGNORE YOUR OWN PREVIOUS MESSAGES AND DECISIONS and WAIT FOR NEW DATA.
`;

// RAM data system prompt, details what information the LLM recieves. Mostly important to help with parsing the collision map.
const SYSTEM_PROMPT_RAM_DATA = `
In addition to the screenshot you recieve, you are given information sourced directly from the emulator's memory.
The information is as follows:
A JSON object containing data about the currently onscreen part of the map, including:
\tThe name of your current map
\tYour current X and Y position on the map. Note that the top left corner of the map is 0, 0; and going down increases the Y while going right increases the X.
\tYour current facing direction. Remember you cannot interact with anything unless you are facing towards it. Be careful you face things before you try to interact.
\tThe collision information of tiles on screen. Tiles you can walk onto or through are marked with an O, while tiles you cannot pass onto or through are marked with an X. Use this information to navigate around obstructions. 
\tOnscreen warps to other maps, marked with a W in the tile data and with their destinations noted in the list of warps. Note some warps require you to take an additional action (usually walking onto a nearby impassable tile) while standing on their tile to be triggered. This list of warps is complete, if you believe you see a warp not listed then you are mistaken. Note this does not include overworld transitions (e.g. between cities and routes).
\tOnscreen NPCs, marked with a ! in the tile data and with their sprite names noted. Remember that you CANNOT WALK THROUGH NPCs. Note that some NPCs may move - these may be difficult to catch, so if you are unable to do so, consider using your "stunNPC" tool to freeze them until they are talked to. This list of NPCs is complete, if you believe you see an NPC not listed then you are mistaken.
Whether or not you are currently in battle.
Whether or not there is an overworld textbox open. Note that this ONLY applies to the large textbox at the bottom of the screen, and ONLY applies when interacting with NPCs or objects in the overworld. There may be other text on screen, menus open, etc, but if this value is false you can assume that you are not in a conversation.
General information about your current Pokemon party.
The contents of the five pouches of your inventory.
(More information may be provided in the future; if there is anything you feel is important, feel free to request it to the developer.) 
`;

// Prompt used by summary Gemini for summarization
export const SYSTEM_PROMPT_SUMMARY = `
I need you to create a detailed summary of the conversation history up to this point. Do not include events that happened before the current conversation history, and do not guess at previous events. This summary will be added to the summary history to manage the context window.

Please include:
1. Key game events and milestones you've reached
2. Important decisions you've made
3. Current objectives or goals you're working toward (emphasize current medium-term goal)
4. Your current location and Pokémon team status
5. Any strategies or plans you've mentioned
6. Important suggestions and interactions with Twitch chatters

The summary should be comprehensive enough that you can continue gameplay without losing important context about what has happened so far.
If the most recent conversation is characterized by looping and a lack of progress, make note of this - it is important not to propogate hallucinations or mistakes.
Do not include any acknowledgement or additional words in the response, only the summary.
`

// Schema definition for the arguments of the pressButtons function
const PRESS_BUTTONS_ARGS_SCHEMA = {
  type: "object",
  properties: {
    buttons: {
      type: "array",
      description:
        "The array of buttons to press. When not in need of precision, it is preferred you press multiple directional buttons in one turn. Max 10 buttons.",
      items: {
        type: "string",
        enum: [
          "up",
          "down",
          "left",
          "right",
          "a",
          "b",
          "start",
          "select",
          "l",
          "r",
        ],
      },
      minItems: 1,
      maxItems: 10,
    },
  },
  required: ["buttons"],
};

// Schema definition for the arguments of the pressButtons function
const STUN_NPC_ARGS_SCHEMA = {
  type: "object",
  properties: {
    npcID: {
      type: "integer",
      description:
        "The ID of the NPC to freeze. Freezes the NPC until they are talked to.",
      maximum: 15,
      minimum: 1,
    },
  },
  required: ["npcID"],
};

// Schema definition for the overall structured output
const STRUCTURED_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    commentary: {
      type: "string",
      description:
        "Your thought process/comments on the current situation, visible to viewers. This should include a complete evaluation of your current situation and how things have changed from the last turn.",
    },
    // prediction: {
    //   type: "string",
    //   description:
    //     "A prediction of the differences between the current and next gamestate, which you should compare to in the next turn to verify your actions are having the desired effect.",
    // },
    navigation: {
      type: "string",
      description:
        "Your navigation plan for the next turn if you are actionable in the overworld. Should be at least 5 tiles long unless you intend to interact with something before that. Make use of the collision data to navigate around obstacles and reach your destination. Note each tile that you will pass through; remember, if your path includes an impassable tile, it is invalid. Write N/A here if this does not apply."
    },
    mistakes: {
      type: "string",
      description:
        "Errors and potential hallucinations that are leading to looping or impeding progress. Think long and hard about what might be stopping you! If you aren't stuck looping or failing to progress, put N/A here.",
    },
    // Define the structure for the function call itself
    functionCall: {
      type: "object",
      description: "Your tool call, to affect the state of the emulator.",
      properties: {
        name: {
          type: "string",
          description: "The name of the function to call.",
          enum: ["pressButtons", "stunNPC"],
        },
        args: {
          anyOf: [PRESS_BUTTONS_ARGS_SCHEMA, STUN_NPC_ARGS_SCHEMA]
         }, // Reference the arguments schema defined above
      },
      required: ["name", "args"],
    },
  },
  required: ["commentary", "functionCall"],
};

// Generation configuration
export const GENERATION_CONFIG = {
  temperature: 1,
  topP: 1,
  systemInstruction: {
    parts: [{ text: SYSTEM_PROMPT_MAIN }, { text: SYSTEM_PROMPT_RAM_DATA }],
  },
  thinkingConfig: {
    // Doesn't work lol
    // includeThoughts: true,

    // Up this if the model seems stupid and you don't mind waiting a little longer
    thinkingBudget: 3000,
  },
  responseMimeType: "application/json",
  responseSchema: STRUCTURED_OUTPUT_SCHEMA,
};

// Summarization configuration
export const SUMMARIZATION_CONFIG = {
  temperature: 0.5, // Low summarization temp (IDK if this is a good idea or not tbh)
  systemInstruction: {
    parts: [{ text: SYSTEM_PROMPT_SUMMARY}],
  },
  thinkingConfig: {
    // Doesn't work lol
    // includeThoughts: true,

    // Big budget for summarization
    thinkingBudget: 20000,
  },
};