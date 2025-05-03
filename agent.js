// Imports from other files
import { getGameImagesBase64, parseDataURI } from "./gamestate/screenshot.js";
import { getPartyCount, getPokemonData, isInBattle } from "./gamestate/pokemonData.js";
import { getBagContents, prettyPrintBag } from "./gamestate/bagData.js";
import * as CONFIGS from "./CONFIGS.js";
import { pressButtons } from "./buttonPress.js";
import { readAndClearFile } from "./readInputFile.js";
import { getVisibleMapStateJson } from "./gamestate/overworld/mapData.js";
import { getCurrentMapBank, getCurrentMapNumber } from "./gamestate/overworld/playerData.js";
import { isScriptPtrSet } from "./gamestate/textReader.js";

// Import Google AI SDK
import { GoogleGenAI } from "@google/genai";

// Import Node.js file system module
import { promises as fs } from 'fs'; // <-- Add this line
import path from 'path'; // <-- Add this for path joining

// --- Configuration ---
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY; // Get Google AI API key from environment variable
const HISTORY_FILE_PATH = path.join(process.cwd(), 'chat_history.json'); // <-- Define history file path

if (!GOOGLE_API_KEY) {
    console.error("Error: GOOGLE_API_KEY environment variable not set.");
    process.exit(1); // Exit if the API key is missing
}

// --- Google AI SDK Initialization ---
const genAI = new GoogleGenAI({ apiKey: GOOGLE_API_KEY });

// --- History Management ---
// History format for Google AI SDK: Array of { role: "user" | "model", parts: [{ text?: string, inlineData?: { mimeType: string, data: string } }] }
let googleHistory = [];

/**
 * @description Saves the current chat history to a JSON file.
 * @param {Array} history The chat history array to save.
 * @returns {Promise<void>}
 */
async function saveHistory(history) {
    try {
        const historyJson = JSON.stringify(history, null, 2); // Pretty print JSON
        await fs.writeFile(HISTORY_FILE_PATH, historyJson, 'utf8');
        // console.log(`Chat history saved to ${HISTORY_FILE_PATH}`);
    } catch (error) {
        console.error(`Error saving chat history to ${HISTORY_FILE_PATH}:`, error);
    }
}

/**
 * @description Loads chat history from a JSON file.
 * @returns {Promise<Array>} The loaded history array, or an empty array if loading fails.
 */
async function loadHistory() {
    try {
        await fs.access(HISTORY_FILE_PATH); // Check if file exists
        const historyJson = await fs.readFile(HISTORY_FILE_PATH, 'utf8');
        const loadedHistory = JSON.parse(historyJson);
        console.log(`Chat history loaded from ${HISTORY_FILE_PATH}`);
        // Basic validation (check if it's an array)
        if (Array.isArray(loadedHistory)) {
            return loadedHistory;
        } else {
            console.warn(`Invalid history format found in ${HISTORY_FILE_PATH}. Starting fresh.`);
            return [];
        }
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.log(`History file ${HISTORY_FILE_PATH} not found. Starting fresh.`);
        } else {
            console.error(`Error loading chat history from ${HISTORY_FILE_PATH}:`, error);
        }
        return []; // Return empty history on any error
    }
}


/**
 * @description Gets the current game state information (RAM data) as a formatted string.
 * @returns {Promise<string>} Formatted string containing party, inventory, location, etc.
 */
async function getGameInfoText() {
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

    let bagInfo = await getBagContents();
    let prettyBagInfo = prettyPrintBag(bagInfo);

    let mapBank = await getCurrentMapBank();
    let mapNum = await getCurrentMapNumber();

    let mapStateJSON = mapBank === 0 && mapNum === 0 ? { "map_name": "MAP_UNINITIALIZED" } : await getVisibleMapStateJson();

    let inBattle = await isInBattle();

    let overworldTextboxOpen = await isScriptPtrSet();

    const gameInfo = `
      Map Data:\n${JSON.stringify(mapStateJSON)}
      In Battle: ${inBattle ? "Yes" : "No"}
      Overworld Textbox Onscreen: ${overworldTextboxOpen ? "Yes" : "No"}
      Party Count: ${partyCount}
      Pokemon:
        ${pokemonInfo.length > 0
            ? pokemonInfo.join("\n")
            : "No available pokemon"
        }
      ${prettyBagInfo}
        `;
    return gameInfo.replace(/\n +/g, "\n");;
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
    const predictionText = llmResponse?.prediction;
    const navigationText = llmResponse?.navigation;

    if (responseText) {
        console.log(`LLM Thoughts:\n${responseText}`);
    } else {
        console.error("LLM didn't think anything this turn.");
    }

    if (predictionText) {
        console.log(`LLM Prediction:\n${predictionText}`);
    } else {
        console.error("LLM didn't predict anything this turn.");
    }

    if (navigationText && navigationText.toUpperCase() !== "N/A") {
        console.log(`LLM Navigation:\n${navigationText}`);
    } else {
        console.error("LLM didn't have a navigation plan for the next turn.");
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

/**
 * @description Delays execution for a specified number of milliseconds.
 * @param {number} ms Time to delay in milliseconds.
 * @returns {Promise<void>}
 */
function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runGameLoop() {
    // Load history at the start
    googleHistory = await loadHistory(); // <-- Load history here

    console.log(
        `Starting game loop with model ${CONFIGS.GOOGLE_MODEL_NAME}. Delay: ${CONFIGS.LOOP_DELAY_MS}ms`
    );
    console.log(`Initial history length: ${googleHistory.length}`);


    while (true) {
        try {
            console.log("\n--- New Iteration ---");

            // 1. Get current game state
            const { original: currentImageBase64URI, processed: currentImageBase64URIProcessed } = await getGameImagesBase64(); // Get full data URI
            const currentGameInfo = await getGameInfoText();
            let mapBank = await getCurrentMapBank();
            let mapNum = await getCurrentMapNumber();
            let inBattle = await isInBattle();
            let inMsgbox = await isScriptPtrSet();

            // Parse the image data URI (use grid version if outside battle + textbox and game started, else use nongrid)
            let imageParts;
            if ((mapBank === 0 && mapNum === 0) || inBattle || inMsgbox) {
                imageParts = parseDataURI(currentImageBase64URI);
            } else {
                imageParts = parseDataURI(currentImageBase64URIProcessed);
            }

            if (!imageParts) {
                console.error("Skipping iteration due to invalid image data URI.");
                await delay(CONFIGS.LOOP_DELAY_MS); // Use config value
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
            const currentPromptText = `Current game state:\n${currentGameInfo}\n`;

            const currentTwitchChat = `Twitch Messages this turn:\n${twitch_chat}\n`;
            // console.log(currentPromptText);

            const currentUserPromptParts = [
                {
                    inlineData: { mimeType: imageParts.mimeType, data: imageParts.data },
                },
                { text: currentPromptText },
                { text: currentTwitchChat },
            ];

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
                let parsedResponse;
                try {
                    parsedResponse = JSON.parse(result.text);
                } catch (parseError) {
                    console.error("Error parsing LLM response text:", parseError);
                    console.error("Raw LLM response text:", result.text);
                    // Handle the error, maybe skip this turn or try to recover
                    await delay(CONFIGS.LOOP_DELAY_MS); // Wait before retrying
                    continue;
                }


                console.log(
                    `Total tokens used: ${result.usageMetadata.totalTokenCount}`
                );

                let responseResult = await processLLMResponse(parsedResponse);

                // Add current user turn and model response to history
                googleHistory.push({
                    role: "model",
                    parts: [
                        {
                            text:
                                parsedResponse.commentary ??
                                "No thoughts in the previous turn.",
                        },
                        {
                            text:
                                parsedResponse.prediction ??
                                "No prediction in the previous turn.",
                        },
                        {
                            text:
                                parsedResponse.navigation ??
                                "No navigation in the previous turn.",
                        }
                    ],
                });
                googleHistory.push({ role: "user", parts: [responseResult] });
                googleHistory.push({ role: "user", parts: [{ text: currentTwitchChat}] });

                // Manage history length (remove oldest model/response set)
                // Keep 3 * HISTORY_LENGTH items (model + response + twitch turn = 3 items)
                while (googleHistory.length > CONFIGS.HISTORY_LENGTH * 3) {
                    googleHistory.shift(); // Remove oldest model message
                    googleHistory.shift(); // Remove oldest response message
                    googleHistory.shift(); // Remove oldest user message
                }

                // Save the updated history
                await saveHistory(googleHistory);
                fs.writeFile('userPrompt_history.json', JSON.stringify(currentUserPromptParts));

            }
        } catch (error) {
            console.error("Error during game loop iteration:", error);
            // Decide how to handle unexpected errors (e.g., stop, wait longer)
            await saveHistory(googleHistory);
        }

        // 6. Wait before the next iteration
        console.log(`--- Waiting for ${CONFIGS.LOOP_DELAY_MS}ms ---`);
        await delay(CONFIGS.LOOP_DELAY_MS);
    }
}

// Start the loop
runGameLoop();
