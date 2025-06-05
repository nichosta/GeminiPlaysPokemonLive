// Imports from other files
import { getGameImagesBase64, parseDataURI } from "./gamestate/emulatorInteraction/screenshot.js";
import { isInBattle } from "./gamestate/pokemonData.js"; // isInBattle is used
import * as CONFIGS from "./CONFIGS.js";
import { readAndClearFile } from "./readInputFile.js";
import { getVisibleBackupMapStateJson } from "./gamestate/overworld/mapApi.js";
import { areFieldControlsLocked } from "./gamestate/overworld/playerData.js";
import { getGameInfoText, saveHumanReadablePromptToFile } from "./llminteract/buildPrompt.js";
import { processLLMResponse } from "./llminteract/processResponse.js";

// Import Google AI SDK
import { GoogleGenAI } from "@google/genai";

// Import Node.js file system module
import { promises as fs } from 'fs';
import path from 'path';
import { WebSocketServer } from 'ws';

// --- Configuration ---
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const SUMMARY_HISTORY_FILE_PATH = path.join(process.cwd(), 'summary_history.json');
const HUMAN_READABLE_PROMPT_FILE_PATH = path.join(process.cwd(), 'human_readable_prompt_details.txt');
const HISTORY_FILE_PATH = path.join(process.cwd(), 'chat_history.json');

if (!GOOGLE_API_KEY) {
    console.error("Error: GOOGLE_API_KEY environment variable not set.");
    process.exit(1);
}

// --- Google AI SDK Initialization ---
const genAI = new GoogleGenAI({ apiKey: GOOGLE_API_KEY });

// --- WebSocket Server Setup --- Added ---
const WSS_PORT = 8080; // Port for the WebSocket server
const wss = new WebSocketServer({ port: WSS_PORT });
const clients = new Set();
let lastOverlayData = {}; // Stores the most recent data for new connections or polling

console.log(`WebSocket server for overlay started on ws://localhost:${WSS_PORT}`);

wss.on('connection', (ws) => {
    console.log('Overlay client connected');
    clients.add(ws);
    // Send the last known state to the newly connected client immediately
    if (Object.keys(lastOverlayData).length > 0) {
        try {
            ws.send(JSON.stringify(lastOverlayData));
        } catch (e) {
            console.error("Error sending initial data to new overlay client:", e);
        }
    }
    ws.on('message', (message) => {
        // Handle messages from overlay if needed in the future
        console.log('Received from overlay:', message.toString());
    });
    ws.on('close', () => {
        console.log('Overlay client disconnected');
        clients.delete(ws);
    });
    ws.on('error', (error) => {
        console.error('WebSocket error with an overlay client:', error);
        clients.delete(ws); // Ensure client is removed on error
    });
});

function broadcastToOverlays(data) {
    const jsonData = JSON.stringify(data);
    clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) { // Check if client is ready
            try {
                client.send(jsonData);
            } catch (e) {
                console.error("Error sending data to an overlay client:", e);
                // Optionally remove client if send fails repeatedly
                // clients.delete(client);
            }
        }
    });
}
// --- End WebSocket Server Setup ---

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
        const historyJson = JSON.stringify(history, null, 2);
        await fs.writeFile(filePath, historyJson, 'utf8');
    } catch (error) {
        console.error(`Error saving chat history to ${filePath}:`, error);
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
        await fs.access(filePath);
        const historyJson = await fs.readFile(filePath, 'utf8');
        const loadedHistory = JSON.parse(historyJson);
        console.log(`${historyName} history loaded from ${filePath}`);
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
            console.error(`Error loading chat history from ${filePath}:`, error);
        }
        return [];
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

    console.log(`--- Summarizing History (${historyToSummarize.length} messages) and saving gamestate ---`);

    await fetch(`http://localhost:5000/core/savestateslot?slot=8`, { method: "POST"});
  
    try {
        const result = await genAI.models.generateContent({
            model: CONFIGS.GOOGLE_MODEL_NAME,
            contents: historyToSummarize,
            config: CONFIGS.SUMMARIZATION_CONFIG,
        });
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

/**
 * @description Delays execution for a specified number of milliseconds.
 * @param {number} ms Time to delay in milliseconds.
 * @returns {Promise<void>}
 */
function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runGameLoop() {
    googleHistory = await loadHistoryFromFile(HISTORY_FILE_PATH, "Main");
    summaryHistory = await loadHistoryFromFile(SUMMARY_HISTORY_FILE_PATH, "Summary");
    let turnCounter = Math.floor(googleHistory.length / 3);

    while (true) {
        try {
            console.log("\n--- New Iteration ---");
            console.log(`Turns Till Summary: ${CONFIGS.HISTORY_LENGTH - turnCounter}`);

            const visibleMapState = await getVisibleBackupMapStateJson();
            if (!visibleMapState) {
                console.error("Critical: Failed to get visible map state. Skipping iteration.");
                await delay(CONFIGS.LOOP_DELAY_MS);
                continue;
            }
            // Get gameInfoObject once, used for both LLM prompt and overlay data
            const currentGameInfoObject = await getGameInfoText(visibleMapState);
            const currentGameInfoString = JSON.stringify(currentGameInfoObject);

            let inBattle = await isInBattle();
            let fieldControlsLocked = await areFieldControlsLocked();
            const { original: currentImageBase64URI, processed: currentImageBase64URIProcessed } = await getGameImagesBase64();

            let imageParts;
            if (inBattle || fieldControlsLocked) {
                imageParts = parseDataURI(currentImageBase64URI);
            } else {
                imageParts = parseDataURI(currentImageBase64URIProcessed);
            }

            if (!imageParts) {
                console.error(`Skipping iteration due to invalid image data URI: ${currentImageBase64URI ? currentImageBase64URI.substring(0, 50) + '...' : 'null'}`);
                await delay(CONFIGS.LOOP_DELAY_MS);
                continue;
            }

            let twitch_chat = await readAndClearFile("./twitch_chat.txt");
            if (twitch_chat === "" || twitch_chat === null) { // Modified to handle null from readAndClearFile
                console.info("No content in Twitch chat file.");
                twitch_chat = "No Twitch messages since last turn.";
            }

            const currentPromptText = `Current game state:\n${currentGameInfoString}\n`;
            const currentTwitchChat = `Twitch Messages this turn:\n${twitch_chat}\n`;

            const currentUserPromptParts = [
                { inlineData: { mimeType: imageParts.mimeType, data: imageParts.data } },
                { text: currentPromptText },
                { text: currentTwitchChat },
            ];

            // Save the human-readable version of the prompt data
            await saveHumanReadablePromptToFile(
                currentGameInfoObject,
                imageParts,
                twitch_chat, // Pass the raw twitch_chat string for this turn
                HUMAN_READABLE_PROMPT_FILE_PATH
            );

            if (turnCounter >= CONFIGS.HISTORY_LENGTH) {
                console.log(`Turn limit (${CONFIGS.HISTORY_LENGTH}) reached. Attempting summarization...`);
                if (googleHistory.length > 0) {
                    const summaryText = await summarizeHistory(googleHistory);
                    if (summaryText) {
                        const newSummaryMessage = {
                            role: "model",
                            parts: [{ text: `Summary of last ${turnCounter} turns:\n${summaryText}` }]
                        };
                        summaryHistory.push(newSummaryMessage);
                        while (summaryHistory.length > CONFIGS.MAX_SUMMARIES) {
                            summaryHistory.shift();
                        }
                        googleHistory = [];
                        turnCounter = 0;
                        await saveHistoryToFile(googleHistory, HISTORY_FILE_PATH);
                        await saveHistoryToFile(summaryHistory, SUMMARY_HISTORY_FILE_PATH);
                        console.log("History summarized and replaced.");
                    } else {
                        console.warn("Summarization failed. Proceeding without summarizing.");
                    }
                } else {
                    console.log("No non-summary messages found to summarize. Resetting turn counter.");
                    turnCounter = 0;
                }
            }

            const messagesForApi = [
                ...summaryHistory,
                ...googleHistory,
                { role: "user", parts: currentUserPromptParts },
            ];

            console.log(`Sending request to Google AI (${CONFIGS.GOOGLE_MODEL_NAME})...`);
            const result = await genAI.models.generateContent({
                model: CONFIGS.GOOGLE_MODEL_NAME,
                contents: messagesForApi,
                config: CONFIGS.GENERATION_CONFIG,
            });

            let parsedResponse = {};
            let toolExecutionText = "No tool call processed.";
            let pathValidationResult = { isValid: true, reason: "Validation not performed or path was empty." };


            if (!result) {
                console.error("API Error: No response received from Google AI.");
            } else if (result.promptFeedback && result.promptFeedback.blockReason) {
                console.error(
                    `API Error: Prompt blocked. Reason: ${result.promptFeedback.blockReason}`
                );
                console.error("Block Details:", result.promptFeedback.safetyRatings);
            } else {
                try {
                    parsedResponse = JSON.parse(result.text);
                } catch (parseError) {
                    console.error("Error parsing LLM response text:", parseError);
                    console.error("Raw LLM response text:", result.text);
                    await delay(CONFIGS.LOOP_DELAY_MS);
                    continue;
                }

                console.log(
                    `Total tokens used: ${result.usageMetadata.totalTokenCount}`
                );

                // Process LLM response (this calls pressButtons, etc.)
                // Ensure currentMapState for processLLMResponse is visibleMapState
                const toolProcessingResult = await processLLMResponse(parsedResponse, visibleMapState);
                toolExecutionText = toolProcessingResult.toolExecutionText; // toolExecutionText defined here
                pathValidationResult = toolProcessingResult.pathValidationResult; // pathValidationResult defined here


                googleHistory.push({
                    role: "model",
                    parts: [
                        { text: `Commentary: ${parsedResponse.commentary ?? "No commentary."}` },
                        { text: (Array.isArray(parsedResponse.navigation) && parsedResponse.navigation.length > 0)
                            ? `Proposed Navigation: ${JSON.stringify(parsedResponse.navigation)}`
                            : "No navigation proposed." },
                        { text: `Mistakes Identified: ${parsedResponse.mistakes ?? "N/A"}` },
                        { text: `Long Term Goal: ${parsedResponse.goalMidTerm ?? "N/A"}` },
                        { text: `Mid Term Goal: ${parsedResponse.goalShortTerm ?? "N/A"}` },
                        { text: `Short Term Goal: ${parsedResponse.goalImmediateTerm ?? "N/A"}` },
                    ],
                });
                googleHistory.push({
                    role: "user",
                    parts: [
                        { text: `Tool Execution Outcome: ${toolExecutionText}` },
                        { text: `Path Validation Outcome: ${pathValidationResult ? JSON.stringify(pathValidationResult) : 'Validation not performed or path was empty.'}` }
                    ]
                });
                googleHistory.push({ role: "user", parts: [{ text: currentTwitchChat}] });
                turnCounter++;
                await saveHistoryToFile(googleHistory, HISTORY_FILE_PATH);
            }

            // --- Construct and broadcast data for overlay --- Modified ---
            const turnsUntilSummaryValue = Math.max(0, CONFIGS.HISTORY_LENGTH - turnCounter);
            const overlayData = {
                // visibleMapState already contains player_state, map_name, width, height, connections, etc.
                mapData: visibleMapState,
                commentary: parsedResponse.commentary || "AI is still processing...",
                navigation: parsedResponse.navigation || [],
                // Mapping goals based on how overlay.js interprets them:
                goalLongTerm: parsedResponse.goalMidTerm || "To be determined", // Agent's mid-term is overlay's long-term
                goalMidTerm: parsedResponse.goalShortTerm || "To be determined",  // Agent's short-term is overlay's mid-term
                goalShortTerm: parsedResponse.goalImmediateTerm || "To be determined", // Agent's immediate is overlay's short-term
                pokemon: currentGameInfoObject.pokemon || [],
                bag: currentGameInfoObject.bag || {},
                badges: currentGameInfoObject.badges || [],
                money: typeof currentGameInfoObject.money === 'number' ? currentGameInfoObject.money : 0,
                turnsUntilSummary: turnsUntilSummaryValue,
                // You can add other fields if your overlay needs them, e.g.:
                // mistakes: parsedResponse.mistakes || "N/A"
            };
            lastOverlayData = overlayData; // Update last known data
            broadcastToOverlays(overlayData);
            // --- End overlay data ---

        } catch (error) {
            console.error("Error during game loop iteration:", error);
            await saveHistoryToFile(googleHistory, HISTORY_FILE_PATH);
            await saveHistoryToFile(summaryHistory, SUMMARY_HISTORY_FILE_PATH);
        }

        console.log(`--- Waiting for ${CONFIGS.LOOP_DELAY_MS}ms ---`);
        await delay(CONFIGS.LOOP_DELAY_MS);
    }
}

runGameLoop();