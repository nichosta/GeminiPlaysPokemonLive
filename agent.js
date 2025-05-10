// Imports from other files
import { getGameImagesBase64, parseDataURI } from "./gamestate/emulatorInteraction/screenshot.js";
import { getPartyCount, getPokemonData, isInBattle } from "./gamestate/pokemonData.js";
import { getBagContents, prettyPrintBag, getPlayerMoney } from "./gamestate/bagData.js";
import * as CONFIGS from "./CONFIGS.js";
import { pressButtons } from "./tools/buttonPress.js";
import { stunNPC } from "./tools/stunNPC.js";
import { readAndClearFile } from "./readInputFile.js";
import { getVisibleMapStateJson, validatePath } from "./gamestate/overworld/mapData.js";
import { getCurrentMapBank, getCurrentMapNumber } from "./gamestate/overworld/playerData.js";
import { isScriptPtrSet } from "./gamestate/textReader.js";

// Import Google AI SDK
import { GoogleGenAI } from "@google/genai";

// Import Node.js file system module
import { promises as fs } from 'fs'; // <-- Add this line
import path from 'path'; // <-- Add this for path joining
import { getPartyMenuSlotId } from "./gamestate/menustate/partyMenu.js";

// --- Configuration ---
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const SUMMARY_HISTORY_FILE_PATH = path.join(process.cwd(), 'summary_history.json'); // <-- Define summary history file path
const HISTORY_FILE_PATH = path.join(process.cwd(), 'chat_history.json'); // <-- Define history file path

if (!GOOGLE_API_KEY) {
    console.error("Error: GOOGLE_API_KEY environment variable not set.");
    process.exit(1); // Exit if the API key is missing
}

// --- Google AI SDK Initialization ---
const genAI = new GoogleGenAI({ apiKey: GOOGLE_API_KEY });

// --- History Management ---
// History format for Google AI SDK: Array of { role: "user" | "model", parts: [{ text?: string, inlineData?: { mimeType: string, data: string } }] }
let googleHistory = []; // Holds the current conversation segment
let summaryHistory = []; // Holds the summaries

/**
 * @description Saves the current chat history to a JSON file.
 * @param {Array} history The chat history array to save.
 * @param {string} filePath The path to the file where history should be saved.
 * @returns {Promise<void>}
 */
async function saveHistoryToFile(history, filePath) {
    try {
        const historyJson = JSON.stringify(history, null, 2); // Pretty print JSON
        await fs.writeFile(filePath, historyJson, 'utf8');
        // console.log(`History saved to ${filePath}`);
    } catch (error) {
        console.error(`Error saving chat history to ${HISTORY_FILE_PATH}:`, error);
    }
}

/**
 * @description Loads chat history from a JSON file.
 * @param {string} filePath The path to the file from which history should be loaded.
 * @param {string} historyName A descriptive name for logging (e.g., "Main", "Summary").
 * @returns {Promise<Array>} The loaded history array, or an empty array if loading fails.
 */
async function loadHistoryFromFile(filePath, historyName) {
    try {
        await fs.access(filePath); // Check if file exists
        const historyJson = await fs.readFile(filePath, 'utf8');
        const loadedHistory = JSON.parse(historyJson);
        console.log(`${historyName} history loaded from ${filePath}`);
        // Basic validation (check if it's an array)
        // Also check if elements have expected 'role' and 'parts' structure
        if (Array.isArray(loadedHistory) && loadedHistory.every(item => item && typeof item.role === 'string' && Array.isArray(item.parts))) {
            return loadedHistory;
        } else {
            console.warn(`Invalid ${historyName} history format found in ${filePath}. Starting fresh.`);
            return [];
        }
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.log(`${historyName} history file ${filePath} not found. Starting fresh.`);
        } else {
            console.error(`Error loading chat history from ${HISTORY_FILE_PATH}:`, error);
        }
        return []; // Return empty history on any error
    }
}

/**
 * @description Formats the data for a single Pokemon into a readable string.
 * @param {object} pokemon The Pokemon data object.
 * @returns {string} Formatted string for the Pokemon.
 */
function formatPokemonInfo(pokemon) {
    if (!pokemon) return "Invalid Pokemon data";
    return `
    Nickname: ${pokemon.nickname}
  Species: ${pokemon.species}
  Level: ${pokemon.level}
  HP: ${pokemon.currentHP}/${pokemon.maxHP}
  Moves:
    \t${pokemon.moves[0]} (PP ${pokemon.currentPP[0]})
    \t${pokemon.moves[1]} (PP ${pokemon.currentPP[1]})
    \t${pokemon.moves[2]} (PP ${pokemon.currentPP[2]})
    \t${pokemon.moves[3]} (PP ${pokemon.currentPP[3]})
`;
}

/**
 * @description Gets the current game state information (RAM data) as a formatted string.
 * @param {object} visibleMapState The pre-fetched visible map state object.
 * @returns {Promise<string>} Formatted string containing party, inventory, location, etc.
 */
async function getGameInfoText(visibleMapState) {
    // console.log("--- Getting Game Info (for stringification) ---"); // Less verbose logging
    let partyCount = await getPartyCount();
    let pokemonInfo = [];
    if (partyCount > 0) {
        for (let i = 0; i < partyCount; i++) {
            pokemonInfo.push(formatPokemonInfo(await getPokemonData(i)));
        }
    }

    let bagInfo = await getBagContents();
    let prettyBagInfo = prettyPrintBag(bagInfo);

    let mapStateJSON = visibleMapState; // Use the passed visibleMapState
    let inBattle = await isInBattle();
    let overworldTextboxOpen = await isScriptPtrSet();
    let playerMoney = await getPlayerMoney();

    let partyMenuSlot = await getPartyMenuSlotId();

    const gameInfo = `
      Map Data:\n${mapStateJSON ? JSON.stringify(mapStateJSON) : "Error: Map data unavailable."}
      In Battle: ${inBattle ? "Yes" : "No"}
      ${partyMenuSlot === 7 ? "" : `Party Menu Slot: ${partyMenuSlot}`}
      ${inBattle ? "" : `Overworld Textbox Onscreen: ${overworldTextboxOpen ? "Yes" : "No"}`}
      Party Count: ${partyCount}
      Pokemon:
        ${pokemonInfo.length > 0
            ? pokemonInfo.join("\n")
            : "No available pokemon"
        }
        Money: ${playerMoney}
      ${prettyBagInfo}
    `;
    // Remove leading spaces from lines created by template literal indentation
    return gameInfo.replace(/\n +/g, "\n");;
}

/**
 * @description Processes the LLM's response, assuming it contains a tool call.
 * If parsing fails, logs the raw text response.
 * @param {string} llmResponse The response from the LLM.
 * @param {object | null} currentMapState The current visible map state, for path validation.
 * @returns {Promise<{success: boolean, message: string}>} Object indicating success and a status message.
 */
async function processLLMResponse(llmResponse, currentMapState) {
    console.log("--- Processing LLM Response ---");

    // Initialize a variable to hold the outcome of path validation
    let pathValidationOutcome = { isValid: true, reason: "No navigation path proposed or validation not applicable." };
    const responseText = llmResponse?.commentary;
    const navigationPath = llmResponse?.navigation; // Array of {x,y}
    const mistakeText = llmResponse?.mistakes;

    // Log commentary, prediction, and navigation if present
    console.log(`LLM Thoughts:\n${responseText ?? "N/A"}`);

    if (navigationPath && navigationPath.length > 0) {
        const navigationDisplayArray = navigationPath.map(item => `[${item.x},${item.y}]`);
        console.log(`LLM Proposed Navigation:\n${navigationDisplayArray.join(" -> ")}`);

        const pathCoordinates = navigationPath.map(coord => [coord.x, coord.y]);
        if (currentMapState) {
            const validationResult = await validatePath(pathCoordinates, currentMapState);
            pathValidationOutcome = validationResult; // Store the actual validation result

            if (!validationResult.isValid) {
                console.warn(`LLM Navigation Path Validation FAILED:`);
                // console.warn(`  Path: ${navigationDisplayArray.join(" -> ")}`);
                if (validationResult.failurePoint) {
                    console.warn(`  Failure at [${validationResult.failurePoint.join(',')}] because: ${validationResult.reason}`);
                } else {
                    console.warn(`  Reason: ${validationResult.reason}`);
                }
            } else {
                // console.log("LLM Navigation Path Validated Successfully.");
            }
        } else {
            pathValidationOutcome = { isValid: false, reason: "Map state not available for validation." };
            console.warn("Skipping navigation path validation: currentMapState not available.");
        }
    } else {
        console.log("LLM Proposed Navigation: N/A");
        // pathValidationOutcome remains as its default:
        // { isValid: true, reason: "No navigation path proposed or validation not applicable." }
    }
    console.log(`LLM Mistakes:\n${mistakeText ?? "N/A"}`);

    try {
        if (llmResponse.functionCall == null) {
            console.warn("Warning: No tool call in LLM response.");
            // Log the full response if there's no function call for context
            console.log("Full LLM Response (no function call):", JSON.stringify(llmResponse, null, 2));
            return {
                toolExecutionText: "No tool call in this response. You may disregard this message if this was intentional.",
                pathValidationResult: pathValidationOutcome
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
                        return { toolExecutionText: "Tool 'pressButtons' called with invalid args.", pathValidationResult: pathValidationOutcome };
                    }
                    return { toolExecutionText: "Successfully executed 'pressButtons' tool.", pathValidationResult: pathValidationOutcome };
                case "stunNPC":
                    console.log(args);
                    if (args.npcID) {
                        await stunNPC(args.npcID);
                    } else {
                        console.warn("Tool 'stunNPC' called with invalid args:", args);
                        return { toolExecutionText: "Tool 'stunNPC' called with invalid args.", pathValidationResult: pathValidationOutcome };
                    }
                    return { toolExecutionText: "Successfully executed 'stunNPC' tool.", pathValidationResult: pathValidationOutcome };
                default:
                    console.warn(
                        `Received unknown tool name: ${responseFunctionCall.name}`
                    );
                    return { toolExecutionText: `Unknown tool name: ${responseFunctionCall.name}`, pathValidationResult: pathValidationOutcome };
            }
            // --- End Tool Execution Logic ---
        } else {
            // Parsed JSON doesn't match expected tool format, treat as plain text
            console.log(
                "LLM response functionCall is invalid or missing expected structure. Outputting object:",
                responseFunctionCall
            );
            console.log(
                "Original LLM Response Object:",
                responseFunctionCall
            );
            return { toolExecutionText: "Improper tool call format.", pathValidationResult: pathValidationOutcome };
        }
    } catch (error) {
        // Log other types of errors during processing
        console.error("Error processing LLM response:", error);
        return { toolExecutionText: "Unspecified error processing LLM response.", pathValidationResult: pathValidationOutcome };
    }
}

/**
 * @description Summarizes the provided history using the Gemini API.
 * @param {Array} historyToSummarize The portion of the chat history to summarize.
 * @returns {Promise<string|null>} The summary text, or null if summarization fails.
 */
async function summarizeHistory(historyToSummarize) {
    if (!historyToSummarize || historyToSummarize.length === 0) {
        console.log("No history provided for summarization.");
        return null;
    }

    console.log(`--- Summarizing History (${historyToSummarize.length} messages) ---`);

    try {
        // Construct the prompt for the summarization model
        // The summarization prompt expects the history directly as 'contents'
        const result = await genAI.models.generateContent({
            model: CONFIGS.GOOGLE_MODEL_NAME,
            contents: historyToSummarize,
            config: CONFIGS.SUMMARIZATION_CONFIG,
        });

        // NOTE: Using the main genAI instance and config here, as requested.
        if (!result) {
            console.error("Summarization Error: No response received from Google AI.");
            return null;
        }

        const summaryText = result.text;

        if (result.promptFeedback && result.promptFeedback.blockReason) {
            console.error(
                `Summarization Error: Prompt blocked. Reason: ${result.promptFeedback.blockReason}`
            );
            console.error("Block Details:", result.promptFeedback.safetyRatings);
            return null;
        }

        console.log("--- Summarization Complete ---");
        return summaryText;
    } catch (error) {
        console.error("Error during summarization API call:", error);
        return null;
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
    googleHistory = await loadHistoryFromFile(HISTORY_FILE_PATH, "Main");
    summaryHistory = await loadHistoryFromFile(SUMMARY_HISTORY_FILE_PATH, "Summary");

    // Calculate initial turn counter based on the length of the current googleHistory segment
    let turnCounter = Math.floor(googleHistory.length / 3);

    while (true) {
        try {
            console.log("\n--- New Iteration ---");

            console.log(`Turns Till Summary: ${CONFIGS.HISTORY_LENGTH - turnCounter}`);

            // 1. Get current game state (map data object and stringified version)
            const visibleMapState = await getVisibleMapStateJson(); // Get the map state object
            if (!visibleMapState) {
                console.error("Critical: Failed to get visible map state. Skipping iteration.");
                await delay(CONFIGS.LOOP_DELAY_MS);
                continue;
            }
            const currentGameInfoString = await getGameInfoText(visibleMapState); // Get stringified version for LLM

            let mapBank = await getCurrentMapBank();
            let mapNum = await getCurrentMapNumber();
            let inBattle = await isInBattle();
            let inMsgbox = await isScriptPtrSet();
            const { original: currentImageBase64URI, processed: currentImageBase64URIProcessed } = await getGameImagesBase64(); // Get full data URI

            // Parse the image data URI (use grid version if outside battle + textbox and game started, else use nongrid)
            let imageParts;
            if ((mapBank === 0 && mapNum === 0) || inBattle || inMsgbox) {
                imageParts = parseDataURI(currentImageBase64URI);
            } else {
                imageParts = parseDataURI(currentImageBase64URIProcessed);
            }

            if (!imageParts) {
                console.error(`Skipping iteration due to invalid image data URI: ${currentImageBase64URI ? currentImageBase64URI.substring(0, 50) + '...' : 'null'}`);
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
            const currentPromptText = `Current game state:\n${currentGameInfoString}\n`;
            const currentTwitchChat = `Twitch Messages this turn:\n${twitch_chat}\n`;
            // console.log("Current Prompt Text:", currentPromptText); // Optional: Log full prompt text

            const currentUserPromptParts = [
                {
                    inlineData: { mimeType: imageParts.mimeType, data: imageParts.data },
                },
                { text: currentPromptText },
                { text: currentTwitchChat },
            ];

            // 3. Check if summarization is needed BEFORE making the main API call
            if (turnCounter >= CONFIGS.HISTORY_LENGTH) {
                console.log(`Turn limit (${CONFIGS.HISTORY_LENGTH}) reached. Attempting summarization...`);

                // Summarize the current googleHistory segment
                if (googleHistory.length > 0) {
                    const summaryText = await summarizeHistory(googleHistory);

                    if (summaryText) {
                        // Use 'model' role for the summary message
                        const newSummaryMessage = {
                            role: "model",
                            parts: [{ text: `Summary of last ${turnCounter} turns:\n${summaryText}` }]
                        };

                        // Add new summary and limit total summaries
                        summaryHistory.push(newSummaryMessage);
                        while (summaryHistory.length > CONFIGS.MAX_SUMMARIES) {
                            summaryHistory.shift(); // Remove the oldest summary
                        }

                        // Clear the main history and reset counter
                        googleHistory = [];
                        turnCounter = 0; // Reset turn counter

                        // Save both histories
                        await saveHistoryToFile(googleHistory, HISTORY_FILE_PATH);
                        await saveHistoryToFile(summaryHistory, SUMMARY_HISTORY_FILE_PATH);
                        console.log("History summarized and replaced.");
                    } else {
                        console.warn("Summarization failed. Proceeding without summarizing.");
                        // Optionally, reset turn counter anyway or implement other fallback
                    }
                } else {
                    console.log("No non-summary messages found to summarize. Resetting turn counter.");
                    turnCounter = 0; // Reset counter if history was empty
                }
            }

            // 4. Construct the full message history for the API call (including current user turn)
            const messagesForApi = [
                ...summaryHistory, // Start with summaries
                ...googleHistory, // Add current conversation segment
                { role: "user", parts: currentUserPromptParts },
            ];

            // 5. Make the API call to Google AI
            console.log(
                `Sending request to Google AI (${CONFIGS.GOOGLE_MODEL_NAME})...`
            );

            // Use generateContent for stateless requests suitable for loops
            const result = await genAI.models.generateContent({
                model: CONFIGS.GOOGLE_MODEL_NAME,
                contents: messagesForApi,
                config: CONFIGS.GENERATION_CONFIG,
            });

            // 6. Handle the response
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

                let { toolExecutionText, pathValidationResult } = await processLLMResponse(parsedResponse, visibleMapState);

                // Add current user turn and model response to history
                // IMPORTANT: Add the *model's* response first
                googleHistory.push({
                    role: "model",
                    parts: [
                        {
                            text: `Commentary: ${
                                parsedResponse.commentary ??
                                "No commentary in the previous turn."
                            }`
                        },
                        {
                            text: (Array.isArray(parsedResponse.navigation) && parsedResponse.navigation.length > 0)
                                ? `Proposed Navigation: ${JSON.stringify(parsedResponse.navigation)}`
                                : "No navigation proposed in the previous turn.",
                        },
                        { text: `Mistakes Identified: ${parsedResponse.mistakes ?? "N/A"}` }
                    ],
                });
                // Then add the *result* of the LLM's action and path validation
                googleHistory.push({
                    role: "user", // This represents the outcome/feedback from the environment
                    parts: [
                        { text: `Tool Execution Outcome: ${toolExecutionText}` },
                        { text: `Path Validation Outcome: ${pathValidationResult ? JSON.stringify(pathValidationResult) : 'Validation not performed or path was empty.'}` }
                    ]
                });

                // Finally, add the twitch chat for that turn
                googleHistory.push({ role: "user", parts: [{ text: currentTwitchChat}] });

                turnCounter++; // Increment turn counter after a successful turn cycle

                // Save the updated history
                await saveHistoryToFile(googleHistory, HISTORY_FILE_PATH); // Only save main history here
                fs.writeFile('userPrompt_history.json', JSON.stringify(currentUserPromptParts));

            }
        } catch (error) {
            console.error("Error during game loop iteration:", error);
            // Save both histories on error
            await saveHistoryToFile(googleHistory, HISTORY_FILE_PATH);
            await saveHistoryToFile(summaryHistory, SUMMARY_HISTORY_FILE_PATH);
        }

        // 7. Wait before the next iteration
        console.log(`--- Waiting for ${CONFIGS.LOOP_DELAY_MS}ms ---`);
        await delay(CONFIGS.LOOP_DELAY_MS);
    }
}

// Start the loop
runGameLoop();
