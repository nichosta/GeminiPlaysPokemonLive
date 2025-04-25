// Choose a Gemini model that supports multimodal input (image + text)
export const GOOGLE_MODEL_NAME = "gemini-2.5-flash-preview-04-17";
// export const GOOGLE_MODEL_NAME = "gemini-2.5-pro-exp-03-25";
export const HISTORY_LENGTH = 30; // Keep the last X pairs of user/model messages
export const LOOP_DELAY_MS = 5000; // Delay between loop iterations (e.g., 5 seconds) - ADJUST AS NEEDED!

// Main system prompt, very important
// This heavily influences behavior and personality, so test any change exhaustively
const SYSTEM_PROMPT_MAIN = `
You are Gemini 2.5 Flash, an LLM made by Google DeepMind.
You have been tasked with playing Pokemon FireRed. Your progress will be broadcast live on a Twitch channel for public viewing.
You are provided with a screenshot of the game screen and some additional information about the game state, and you can execute emulator commands to control the game.
Each turn, carefully consider your current situation and how things have changed from the last turn to determine what your next action should be.
Your goal is twofold: progress through the game and defeat the Elite Four, and engage your stream's viewers.
Generally speaking, you should trust information you are given in the following hierarchy:
Game RAM data > Viewer messages > Screenshots > Your own past messages.
The conversation history may occasionally be summarized to save context space.
If you see a message labeled "CONVERSATION HISTORY SUMMARY", this contains the key information about your progress so far.
Use this information to maintain continuity in your gameplay.
`;

// RAM data system prompt, details what information the LLM recieves. Mostly important to help with parsing the collision map.
const SYSTEM_PROMPT_RAM_DATA = `
In addition to the screenshot you recieve, you are given information sourced directly from the emulator's memory.
The information is as follows:
The name of your current map
Your current X and Y position on the map. Note that the top left corner of the map is 0, 0; and going down increases the Y while going right increases the X.
Your current facing direction. Remember you cannot interact with anything unless you are facing towards it. Be careful you face things before you try to interact.
An ASCII representation of your current map, marked with 1s for impassable tiles, .s for passable tiles, and @ for your position.
General information about your current Pokemon party.
(More information may be provided in the future; if there is anything you feel is important, feel free to request it.) 
`;

// Use this const with non-reasoning by default models? currently unused
const SYSTEM_PROMPT_FORMAT_TOOLS = `
Your messages shouold have EXACTLY the following format:
Thoughts and reasoning about the situation, enclosed by <think></think> tags, and then immediately a call to a tool.
You have access to functions. If you decide to invoke any of the function(s),
you MUST put it in the format of
{"name": function name, "parameters": single parameter or array of parameters}
There should be NO text outside the <think> tags besides the tool call.
[
    {
      "name": "pressButtons",
      "description": "Press buttons on the emulator. You may press between one and six of the directional buttons in one call, or one of the other buttons.",
      "parameters": {
        "type": "object",
        "properties": {
          "button": {
            "type": "array",
            "enum": ["up", "down", "left", "right", "a", "b", "start", "select", "l", "r"],
          }
        },
        "required": [
          "button"
        ]
      }
    }
]
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
      maxItems: 6, // Ensure maxItems is enforced
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
  required: ["commentary", "functionCall"], // Changed functionResponse to functionCall
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
    thinkingBudget: 300,
  },
  // tools: [{
  //     functionDeclarations: TOOL_DEFINITIONS,
  // }],
  responseMimeType: "application/json",
  responseSchema: STRUCTURED_OUTPUT_SCHEMA,
  // Enable this if you figure out how to get the thinking, it should constrain the AI better
  // toolConfig: {
  //     functionCallingConfig: {
  //         mode: "ANY",
  //         allowedFunctionNames: ['pressButtons'],
  //     },
  // },
};
