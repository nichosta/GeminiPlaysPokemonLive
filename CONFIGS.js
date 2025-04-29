// Choose a Gemini model that supports multimodal input (image + text)
export const GOOGLE_MODEL_NAME = "gemini-2.5-flash-preview-04-17";
// export const GOOGLE_MODEL_NAME = "gemini-2.5-pro-exp-03-25";
export const HISTORY_LENGTH = 15; // Keep the last X pairs of user/model messages
export const LOOP_DELAY_MS = 5000; // Delay between loop iterations (e.g., 5 seconds) - ADJUST AS NEEDED!

// Main system prompt, very important
// This heavily influences behavior and personality, so test any change exhaustively
const SYSTEM_PROMPT_MAIN = `
You are Gemini 2.5 Flash, an LLM made by Google DeepMind.
You have been tasked with playing Pokemon. Your progress will be broadcast live on a Twitch channel for public viewing.
You are provided with a screenshot of the game screen with a grid applied and some additional information about the game state, and you can execute emulator commands to control the game.
Each turn, carefully consider your current situation and position, then how things have changed from the last turn to determine what your next action should be.
Each turn, you should predict what the game state will be next turn.
If you haven't made progress since the last turn (ESPECIALLY if your coordinates this turn are the same as the last), reconsider your approach and look at the information you've been given to see where you may have gone wrong.
Your goal is twofold: progress through the game and defeat the Elite Four, and engage your stream's viewers.
Generally speaking, you should trust information you are given in the following hierarchy:
Game RAM data > Viewer messages > Screenshots > Your own past messages.
`;

// RAM data system prompt, details what information the LLM recieves. Mostly important to help with parsing the collision map.
const SYSTEM_PROMPT_RAM_DATA = `
In addition to the screenshot you recieve, you are given information sourced directly from the emulator's memory.
The information is as follows:
A JSON object containing data about the currently onscreen part of the map, including:
\tThe name of your current map
\tYour current X and Y position on the map. Note that the top left corner of the map is 0, 0; and going down increases the Y while going right increases the X.
\tYour current facing direction. Remember you cannot interact with anything unless you are facing towards it. Be careful you face things before you try to interact.
\tThe passability information of tiles on screen. Tiles you can walk onto or through are marked with an O, while tiles you cannot pass onto or through are marked with an X.
\tOnscreen warps to other maps, marked with a W in the tile data and with their destinations noted in the list of warps.
Whether or not you are currently in battle.
Whether or not there is an overworld textbox open. Note that this ONLY applies to the large textbox at the bottom of the screen, and ONLY applies when interacting with NPCs or objects in the overworld. There may be other text on screen, menus open, etc, but if this value is false you can assume that you are not in a conversation.
General information about your current Pokemon party.
The contents of the five pouches of your inventory.
(More information may be provided in the future; if there is anything you feel is important, feel free to request it.) 
`;

// Schema definition for the arguments of the pressButtons function
const PRESS_BUTTONS_ARGS_SCHEMA = {
  type: "object",
  properties: {
    buttons: {
      type: "array",
      description:
        "The array of buttons to press. When moving medium to long distances, it is preferred you press multiple directional buttons in one turn. Max 6 buttons.",
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
      maxItems: 6,
    },
  },
  required: ["buttons"],
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
    prediction: {
      type: "string",
      description:
        "A prediction of the differences between the current and next gamestate, which you should compare to in the next turn to verify your actions are having the desired effect.",
    },
    // Define the structure for the function call itself
    functionCall: {
      type: "object",
      description: "Your tool call, to affect the state of the emulator.",
      properties: {
        name: {
          type: "string",
          description: "The name of the function to call.",
          enum: ["pressButtons"], // Only allow 'pressButtons' for now
        },
        args: PRESS_BUTTONS_ARGS_SCHEMA, // Reference the arguments schema defined above
      },
      required: ["name", "args"],
    },
  },
  required: ["commentary", "functionCall"],
};

// Generation configuration
export const GENERATION_CONFIG = {
  temperature: 1.0,
  systemInstruction: {
    parts: [{ text: SYSTEM_PROMPT_MAIN }, { text: SYSTEM_PROMPT_RAM_DATA }],
  },
  thinkingConfig: {
    // Doesn't work lol
    // includeThoughts: true,

    // Up this if the model seems stupid and you don't mind waiting a little longer
    thinkingBudget: 1000,
  },
  responseMimeType: "application/json",
  responseSchema: STRUCTURED_OUTPUT_SCHEMA,
};
