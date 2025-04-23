// Imports from other files
import { getGameImageBase64, parseDataURI } from "./gamestate/screenshot.js";
import { getPartyCount, getPokemonData } from "./gamestate/pokemonData.js";
import * as CONFIGS from "./CONFIGS.js";
import { pressButtons } from "./buttonPress.js";
import { readAndClearFile } from "./readInputFile.js";
import {
    getPlayerX,
    getPlayerY,
    getCurrentMapBank,
    getCurrentMapNumber,
    getMainMapCollisionData,
} from "./gamestate/mapData.js";

// Constants mapping imports
import { getMapName } from "./constant/map_map.js";

// Import Google AI SDK
import { GoogleGenAI } from "@google/genai";

// --- Configuration ---
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY; // Get Google AI API key from environment variable

if (!GOOGLE_API_KEY) {
    console.error("Error: GOOGLE_API_KEY environment variable not set.");
    process.exit(1); // Exit if the API key is missing
}

// --- Google AI SDK Initialization ---
const genAI = new GoogleGenAI({ apiKey: GOOGLE_API_KEY });

/**
 * @description Gets the current game state information (RAM data) as a formatted string.
 * @returns {Promise<string>} Formatted string containing party, inventory, location, etc.
 */
async function getGameInfoText() {
    // TODO: Implement logic to get structured info from RAM/mGBA-http
    // Example: Fetch data, format it clearly
    console.log("--- Getting Game Info ---");
    let partyCount = await getPartyCount();
    let pokemonInfo = [];
    if (partyCount > 0) {
        for (let i = 0; i < partyCount; i++) {
            let pokemon = await getPokemonData(i);
            pokemonInfo.push(`
            Species: ${pokemon.species}
            Level: ${pokemon.level}
            HP: ${pokemon.currentHP}/${pokemon.maxHP}
            Moves:
            \t${pokemon.moves[0]} (PP ${pokemon.currentPP[0]})
            \t${pokemon.moves[1]} (PP ${pokemon.currentPP[1]})
            \t${pokemon.moves[2]} (PP ${pokemon.currentPP[2]})
            \t${pokemon.moves[3]} (PP ${pokemon.currentPP[3]})
        `);
        }
    }
    let playerX = await getPlayerX();
    let playerY = await getPlayerY();
    let mapBank = await getCurrentMapBank();
    let mapNum = await getCurrentMapNumber();

    const gameInfo = `
      Current Map Name: ${getMapName(
        mapBank,
        mapNum
    )}, Location: (${playerX}, ${playerY})
      Map Collision Data:\n${await getMainMapCollisionData()}
      Party Count: ${partyCount}
      Pokemon:
        ${pokemonInfo.length > 0
            ? pokemonInfo.join("\n")
            : "No available pokemon"
        }
      `;
    return gameInfo.replace(/\n\s+/g, "\n");;
}

/**
 * @description Processes the LLM's response, assuming it contains a tool call.
 * If parsing fails, logs the raw text response.
 * @param {string} llmResponse The response from the LLM.
 * @returns {Promise<void>}
 */
async function processLLMResponse(llmResponse) {
    console.log("--- Processing LLM Response ---");

    // Get the text part of the response
    const responseText = llmResponse?.commentary;

    if (responseText) {
        console.log(`LLM Thoughts:\n${responseText}`);
    } else {
        console.error("LLM didn't think anything this turn.");
    }

    try {
        if (llmResponse.functionCall == null) {
            console.warn("Warning: No tool call in LLM response.");
            console.log(JSON.stringify(llmResponse));
            return {
                text: "No tool call in this response. You may disregard this message if this was intentional.",
            };
        }

        // Attempt to get the response
        const responseFunctionCall = llmResponse.functionCall;

        // Check if it looks like our expected tool call format
        if (
            responseFunctionCall &&
            typeof responseFunctionCall === "object" &&
            responseFunctionCall.name &&
            typeof responseFunctionCall.name === "string" &&
            responseFunctionCall.args
        ) {
            console.log(`Attempting to execute tool: ${responseFunctionCall.name}`);
            const args = responseFunctionCall.args;

            // --- Tool Execution Logic ---
            switch (responseFunctionCall.name) {
                case "pressButtons":
                    console.log(args);
                    if (args.buttons) {
                        await pressButtons(args.buttons);
                    } else {
                        console.warn("Tool 'pressButtons' called with invalid args:", args);
                    }
                    return { text: "Succesfully executed 'pressButtons' tool." };
                default:
                    console.warn(
                        `Received unknown tool name: ${responseFunctionCall.name}`
                    );
                    return { text: "Unknown tool name." };
            }
            // --- End Tool Execution Logic ---
        } else {
            // Parsed JSON doesn't match expected tool format, treat as plain text
            console.log(
                "Response is invalid. Outputting object:",
                responseFunctionCall
            );
            return { text: "Improper tool call format." };
        }
    } catch (error) {
        // Log other types of errors during processing
        console.error("Error processing LLM response:", error);
        return { text: "Unspecified error processing LLM response." };
    }
}

// --- Main Application Logic ---

// History format for Google AI SDK: Array of { role: "user" | "model", parts: [{ text?: string, inlineData?: { mimeType: string, data: string } }] }
let googleHistory = [];

/**
 * @description Delays execution for a specified number of milliseconds.
 * @param {number} ms Time to delay in milliseconds.
 * @returns {Promise<void>}
 */
function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

console.log(
    `Starting game loop with model ${CONFIGS.GOOGLE_MODEL_NAME}. Delay: ${CONFIGS.LOOP_DELAY_MS}ms`
);

async function runGameLoop() {
    while (true) {
        try {
            console.log("\n--- New Iteration ---");

            // 1. Get current game state
            const currentImageBase64URI = await getGameImageBase64(); // Get full data URI
            const currentGameInfo = await getGameInfoText();

            // Parse the image data URI
            const imageParts = parseDataURI(currentImageBase64URI);
            if (!imageParts) {
                console.error("Skipping iteration due to invalid image data URI.");
                await delay(LOOP_DELAY_MS);
                continue; // Skip this loop iteration
            }

            // Potentially get content from Twitch Chat file
            let twitch_chat = await readAndClearFile("./twitch_chat.txt");

            if (twitch_chat === "") {
                console.info("No content in Twitch chat file.");
                twitch_chat = "No Twitch messages since last turn.";
            }

            // 2. Construct the prompt parts for the current turn
            // Combine system prompts and current game info into the text part
            const currentPromptText = `Current game state:\n${currentGameInfo}\nTwitch Messages: ${twitch_chat}\n`;

            console.log(currentPromptText);

            const currentUserPromptParts = [
                {
                    inlineData: { mimeType: imageParts.mimeType, data: imageParts.data },
                },
                { text: currentPromptText },
            ];

            const imagelessPromptParts = [
                { text: currentPromptText },
            ]

            // 3. Construct the full message history for the API call
            const messagesForApi = [
                ...googleHistory, // Add past user/model turns
                { role: "user", parts: currentUserPromptParts }, // Add current user turn
            ];

            // 4. Make the API call to Google AI
            console.log(
                `Sending request to Google AI (${CONFIGS.GOOGLE_MODEL_NAME})...`
            );

            // Use generateContent for stateless requests suitable for loops
            const result = await genAI.models.generateContent({
                model: CONFIGS.GOOGLE_MODEL_NAME,
                contents: messagesForApi,
                config: CONFIGS.GENERATION_CONFIG,
            });

            // 5. Handle the response
            if (!result) {
                console.error("API Error: No response received from Google AI.");
                // Optional: Log the full result for debugging
                // console.error("Full API Result:", JSON.stringify(result, null, 2));
            } else if (result.promptFeedback && result.promptFeedback.blockReason) {
                // Handle blocked prompts
                console.error(
                    `API Error: Prompt blocked. Reason: ${result.promptFeedback.blockReason}`
                );
                console.error("Block Details:", result.promptFeedback.safetyRatings);
            } else {
                // Process the valid response
                let parsedResponse = JSON.parse(result.text);

                console.log(
                    `Total tokens used: ${result.usageMetadata.totalTokenCount}`
                );

                let responseResult = await processLLMResponse(parsedResponse);

                // Add current user turn and model response to history
                googleHistory.push({ role: "user", parts: imagelessPromptParts });
                googleHistory.push({
                    role: "model",
                    parts: [
                        {
                            text:
                                parsedResponse.commentary ??
                                "No thoughts in the previous turn.",
                        },
                    ],
                });
                googleHistory.push({ role: "user", parts: [responseResult] });

                // Manage history length (remove oldest user/model/response set)
                // Keep 3 * HISTORY_LENGTH items (user + model + response turn = 3 items)
                while (googleHistory.length > CONFIGS.HISTORY_LENGTH * 3) {
                    googleHistory.shift(); // Remove oldest user message
                    googleHistory.shift(); // Remove oldest model message
                    googleHistory.shift(); // Remove oldest response message
                }
            }
        } catch (error) {
            console.error("Error during game loop iteration:", error);
            // Decide how to handle unexpected errors (e.g., stop, wait longer)
        }

        // 6. Wait before the next iteration
        console.log(`--- Waiting for ${CONFIGS.LOOP_DELAY_MS}ms ---`);
        await delay(CONFIGS.LOOP_DELAY_MS);
    }
}

// Start the loop
runGameLoop();
