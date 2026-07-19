// =============================================================================
// AGENT LOOP (D2 — rewired, event-driven)
// =============================================================================
//
// The loop is now EVENT-DRIVEN: the model is called only on a macro boundary
// (after a tool returns its outcome envelope), never on a fixed timer. Each
// iteration:
//   1. Snapshot the game via B1's getState() (one full read per macro boundary,
//      not the old 5s poll).
//   2. Render that snapshot to pure text via buildStatePrompt() — NO screenshot,
//      NO Cerebras vision call (dropped in D2). The model reads only RAM text.
//   3. Call OpenRouter with the frozen D1 tools (toOpenAITools()) and parse the
//      native tool_calls[0] the SDK returns (no more JSON "functionCall" blob).
//   4. Dispatch {name, args} via toolDispatcher → an outcome envelope.
//   5. Feed the outcome back as a `tool` message; the next iteration's user
//      message carries the fresh snapshot. Loop.
//
// What changed vs. the pre-D2 loop:
//   - Cerebras client + describeScreenshot + getGameImagesBase64/parseDataURI:
//     GONE. No second model, no image over the wire. (CEREBRAS_API_KEY no longer
//     required; describeScreenshot.js / processResponse.js are now dead code on
//     disk — left in place rather than deleted to keep the diff reviewable.)
//   - getGameInfoText/saveHumanReadablePromptToFile: replaced by getState() +
//     buildStatePrompt().
//   - The model's action is now ONE high-level tool (goto/press/...) that runs
//     to completion/interrupt, not a 1-7 button press batch. The harness owns
//     pathfinding/battles/menus; the model decides intent at macro boundaries.
//
// What is preserved:
//   - History save/load + summarization (adapted to the tool-call message
//     shape; tool-call pairs are flattened to text for the summarization call
//     so that request stays plain-text and provider-portable).
//   - The WebSocket overlay server (broadcast shape updated to carry the tool
//     call + outcome instead of the old navigation/goal fields).
// =============================================================================

import "dotenv/config";
import * as CONFIGS from "./CONFIGS.js";

import { getState } from "./gamestate/getState.js";
import { toOpenAITools, OUTCOME_STATUS } from "./llminteract/toolInterface.js";
import { buildStatePrompt, renderOutcomeText } from "./llminteract/buildStatePrompt.js";
import { dispatchTool } from "./llminteract/toolDispatcher.js";
import {
    TraceLogger,
    makeTraceRecord,
    makeRunId,
    summarizeState,
} from "./llminteract/traceLogger.js";
import { EvalHarness } from "./skills/evalHarness.js";

import { OpenAI } from "openai";

import { promises as fs } from 'fs';
import path from 'path';
import { WebSocketServer } from 'ws';

// --- Configuration ---
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const SUMMARY_HISTORY_FILE_PATH = path.join(process.cwd(), 'summary_history.json');
const HUMAN_READABLE_PROMPT_FILE_PATH = path.join(process.cwd(), 'human_readable_prompt_details.txt');
const HISTORY_FILE_PATH = path.join(process.cwd(), 'chat_history.json');
// Consecutive clean `press` turns are collapsed into one history triple (see
// the merge in runGameLoop) so a manual button-mash sequence (e.g. Oak's lab
// dialog/menus with no macro coverage) doesn't re-store the full state prompt
// (map grid + party + bag) once per single button. Capped at the tool's own
// per-call button limit so a merged entry stays a valid `press` call.
const MAX_MERGED_PRESS_BUTTONS = 32;

// --- D3 trace logger ---
// Every model call is recorded as a (state_before, tool_call, outcome) tuple in
// the shape E3's distillation trace collection will consume. One JSONL file per
// run; path/configurable via env (regenerable, git-ignored). Writes never throw
// into the loop — a trace gap is preferable to crashing a live run.
const TRACE_FILE_PATH = process.env.TRACE_FILE_PATH
    || path.join(process.cwd(), 'traces', `trace-${makeRunId(Date.now())}.jsonl`);
const RUN_ID = makeRunId(Date.now());
const traceLogger = new TraceLogger({
    filePath: TRACE_FILE_PATH,
    runId: RUN_ID,
    model: CONFIGS.OPENROUTER_MODEL_NAME,
});
traceLogger.ensureDir().then((ok) => {
    if (ok) console.log(`[trace] logging model calls to ${TRACE_FILE_PATH} (run ${RUN_ID})`);
    else console.warn(`[trace] could not create trace dir ${TRACE_FILE_PATH}; traces will be skipped`);
});

// --- D4 eval harness ---
// Milestone savestate checkpoints (one .ss per story beat, branched-from by E3
// for distillation coverage) + a timed run-to-Brock benchmark report (the
// number a model/harness change moves). Checkpoint dir + report path are
// configurable via env (regenerable, git-ignored). Like the trace logger, this
// only reads RAM + writes files at macro boundaries — never throws into the
// loop; a missing checkpoint / report is preferable to crashing a live run.
const CHECKPOINT_DIR = process.env.CHECKPOINT_DIR
    || path.join(process.cwd(), 'checkpoints', RUN_ID);
const EVAL_REPORT_PATH = process.env.EVAL_REPORT_PATH
    || path.join(process.cwd(), 'eval', `benchmark-${RUN_ID}.json`);
const evalHarness = new EvalHarness({
    checkpointDir: CHECKPOINT_DIR,
    reportPath: EVAL_REPORT_PATH,
});
evalHarness.ensureCheckpointDir().then((ok) => {
    if (ok) console.log(`[eval] checkpoints -> ${CHECKPOINT_DIR}, report -> ${EVAL_REPORT_PATH} (run ${RUN_ID})`);
    else console.warn(`[eval] could not create checkpoint dir ${CHECKPOINT_DIR}; checkpoints will be skipped`);
});
// Start the benchmark timer at boot (start wall-clock + emulator frame).
evalHarness.start({ runId: RUN_ID, model: CONFIGS.OPENROUTER_MODEL_NAME });

if (!OPENROUTER_API_KEY) {
    console.error("Error: OPENROUTER_API_KEY environment variable not set.");
    process.exit(1);
}

// --- SDK Clients ---
// D2 dropped the Cerebras vision model: the model now reads only the text state
// prompt, so only the OpenRouter (OpenAI-compatible) client remains.
const openrouter = new OpenAI({
    apiKey: OPENROUTER_API_KEY,
    baseURL: "https://openrouter.ai/api/v1",
});

// --- WebSocket Server Setup ---
const WSS_PORT = 8080;
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
        if (client.readyState === client.OPEN) {
            try {
                client.send(jsonData);
            } catch (e) {
                console.error("Error sending data to an overlay client:", e);
            }
        }
    });
}

// --- History Management ---
// History now carries OpenAI tool-calling messages: an assistant turn can hold
// `tool_calls` (with content possibly null), followed by a `{role:"tool",
// tool_call_id, content}` message. The load validator accepts that shape; at
// summarization time the tool-call pairs are flattened to plain text (see
// flattenHistoryForSummary) so the summarization request stays text-only.
let chatHistory = []; // Holds the current conversation segment
let summaryHistory = [];

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
 * A chat-history message is valid if it has a string role and EITHER a string
 * content OR (for assistant) tool_calls OR (for tool) a tool_call_id+content.
 * Anything else (e.g. the pre-D2 JSON "functionCall" shape) is rejected so the
 * loop starts fresh rather than feeding the API a stale, incompatible history.
 * @param {object} item
 * @returns {boolean}
 */
function isValidHistoryItem(item) {
    if (!item || typeof item.role !== 'string') return false;
    if (typeof item.content === 'string') return true;
    if (item.role === 'assistant' && Array.isArray(item.tool_calls) && item.tool_calls.length) return true;
    if (item.role === 'tool' && typeof item.tool_call_id === 'string' && typeof item.content === 'string') return true;
    return false;
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
        if (Array.isArray(loadedHistory) && loadedHistory.every(isValidHistoryItem)) {
            return loadedHistory;
        } else {
            console.warn(`Invalid or incompatible ${historyName} history format found in ${filePath} (likely pre-D2 shape). Starting fresh.`);
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
 * Flatten a tool-call-bearing history slice into plain-text user/assistant
 * messages for the summarization call. The summarization request is text-only
 * (no tools advertised), so assistant tool_calls + tool results are rendered as
 * readable text instead of carried as tool-role messages some providers reject.
 * @param {Array} history
 * @returns {Array}
 */
function flattenHistoryForSummary(history) {
    const out = [];
    for (const item of history) {
        if (item.role === 'user') {
            out.push({ role: 'user', content: typeof item.content === 'string' ? item.content : '' });
        } else if (item.role === 'assistant') {
            const parts = [];
            if (typeof item.content === 'string' && item.content.trim()) parts.push(item.content);
            for (const tc of item.tool_calls || []) {
                const fn = tc?.function;
                let args = fn?.arguments;
                try { args = JSON.stringify(JSON.parse(args || '{}')); } catch { /* leave raw */ }
                parts.push(`[tool_call: ${fn?.name}(${args})]`);
            }
            out.push({ role: 'assistant', content: parts.join('\n') || '(no content)' });
        } else if (item.role === 'tool') {
            out.push({ role: 'user', content: `[tool outcome] ${item.content}` });
        } else {
            out.push({ role: 'user', content: JSON.stringify(item) });
        }
    }
    return out;
}

/**
 * @description Summarizes the provided history using the OpenRouter model.
 * @param {Array} historyToSummarize The portion of the chat history to summarize.
 * @returns {Promise<string|null>} The summary text, or null if summarization fails.
 */
async function summarizeHistory(historyToSummarize) {
    if (!historyToSummarize || historyToSummarize.length === 0) {
        console.log("No history provided for summarization.");
        return null;
    }

    console.log(`--- Summarizing History (${historyToSummarize.length} messages) and saving gamestate ---`);

    try {
        await fetch(`http://localhost:5000/core/savestateslot?slot=8`, { method: "POST" });
    } catch (error) {
        console.warn("Could not write savestate slot 8 during summarization:", error?.message ?? error);
    }

    try {
        const result = await openrouter.chat.completions.create({
            model: CONFIGS.OPENROUTER_MODEL_NAME,
            messages: [
                { role: "system", content: CONFIGS.SYSTEM_PROMPT_SUMMARY },
                ...flattenHistoryForSummary(historyToSummarize),
            ],
            temperature: CONFIGS.SUMMARIZATION_CONFIG.temperature,
        });

        const summaryText = result?.choices?.[0]?.message?.content;
        if (!summaryText) {
            console.error("Summarization Error: No response text received from OpenRouter.");
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

/**
 * Extract the model's single intended tool call (if any) from an OpenRouter
 * chat-completions assistant message. Returns {id, name, args} or null.
 * @param {object} message
 * @returns {{id:string,name:string,args:object}|null}
 */
function extractToolCall(message) {
    const toolCalls = Array.isArray(message?.tool_calls) ? message.tool_calls : [];
    const first = toolCalls[0];
    if (!first || first.type !== "function") return null;
    const name = first.function?.name;
    if (typeof name !== "string") return null;
    let args = {};
    try {
        args = JSON.parse(first.function?.arguments || "{}") || {};
    } catch (parseError) {
        console.warn("Could not parse tool-call arguments as JSON:", parseError?.message);
        args = {};
    }
    return { id: first.id ?? `${name}-${Date.now()}`, name, args };
}

/**
 * @description Main game loop that continuously interacts with the emulator, LLM, and overlay.
 * @returns {Promise<void>}
 */
async function runGameLoop() {
    // Default is a fresh session every run (no chat_history.json /
    // summary_history.json carried over); pass --keep to resume the previous
    // conversation from disk instead.
    const keepSession = process.argv.includes('--keep');
    if (keepSession) {
        chatHistory = await loadHistoryFromFile(HISTORY_FILE_PATH, "Main");
        summaryHistory = await loadHistoryFromFile(SUMMARY_HISTORY_FILE_PATH, "Summary");
    } else {
        console.log("Starting a new session (pass --keep to resume from chat_history.json / summary_history.json).");
    }
    // Each turn contributes user+assistant+tool = 3 history messages; a "turn"
    // here is one user/model exchange, so divide by the messages per turn.
    let turnCounter = Math.floor(chatHistory.length / 3);
    // Tracks the trailing run of clean `press` turns already merged into the
    // last chatHistory triple, so the next clean press turn can extend it
    // instead of appending a new one. Reset (null) by any non-press tool call,
    // a non-OK press outcome, or a fresh process start (history reload can't
    // recover this cheaply, so a restart just starts a new streak).
    let lastPressStreak = null;

    while (true) {
        let parsedResponseCommentary = "AI is still processing...";
        let toolCallName = "";
        let toolCallArgs = {};
        let outcome = null;

        try {
            console.log("\n--- New Iteration (event-driven: model called on macro boundary) ---");
            console.log(`Turns Till Summary: ${Math.max(0, CONFIGS.HISTORY_LENGTH - turnCounter)}`);

            // 1. Snapshot (one full read per macro boundary, not a fixed poll).
            // includeQuest reads the A4 milestone flags so the model's prompt
            // (and D3 trace summary / D4 final_state) carry story progress.
            const state = await getState({ includeMap: true, includeBag: true, includeParty: true, includeQuest: true });
            if (!state) {
                console.error("Critical: getState() returned null. Skipping iteration.");
                await delay(CONFIGS.LOOP_DELAY_MS);
                continue;
            }

            // D4: poll milestone flags + checkpoint any newly-complete beat,
            // and record crossing times for the benchmark. Reads the story
            // flags by their resolved bit-offsets (A4), not B1's snapshot
            // (which only knows the 8 badge flags). Swallows failures — never
            // throws into the loop. On the terminal Boulder Badge beat it
            // finalizes + writes the benchmark report.
            try {
                const evalResult = await evalHarness.update(state);
                if (evalResult.newCheckpoints.length) {
                    console.log(`[eval] checkpointed: ${evalResult.newCheckpoints.map((c) => c.id).join(", ")}`);
                }
            } catch (e) {
                console.warn("[eval] update failed (non-fatal):", e?.message ?? e);
            }

            // 2. Pure-text prompt from the snapshot — no screenshot, no vision.
            const currentPromptText = buildStatePrompt(state);

            // Persist a human-readable copy of what the model was shown (debugging).
            try {
                await fs.writeFile(
                    HUMAN_READABLE_PROMPT_FILE_PATH,
                    `=== STATE PROMPT (D2, pure text, no vision) ===\n${currentPromptText}\n`,
                    'utf8'
                );
            } catch (error) {
                console.error(`Error saving human-readable prompt to ${HUMAN_READABLE_PROMPT_FILE_PATH}:`, error);
            }

            // Perform summarizing if necessary (before adding the new user turn).
            if (turnCounter >= CONFIGS.HISTORY_LENGTH) {
                console.log(`Turn limit (${CONFIGS.HISTORY_LENGTH}) reached. Attempting summarization...`);
                if (chatHistory.length > 0) {
                    const summaryText = await summarizeHistory(chatHistory);
                    if (summaryText) {
                        const newSummaryMessage = {
                            role: "assistant",
                            content: `Summary of last ${turnCounter} turns:\n${summaryText}`
                        };
                        summaryHistory.push(newSummaryMessage);
                        while (summaryHistory.length > CONFIGS.MAX_SUMMARIES) {
                            summaryHistory.shift();
                        }
                        chatHistory = [];
                        turnCounter = 0;
                        lastPressStreak = null; // the mergeable triple just got wiped into the summary
                        await saveHistoryToFile(chatHistory, HISTORY_FILE_PATH);
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

            // 3. Add the fresh state as this turn's user message, then build the
            //    API request from the full conversation.
            const userMessage = { role: "user", content: currentPromptText };
            const messagesForApi = [
                { role: "system", content: CONFIGS.SYSTEM_PROMPT_FULL },
                ...summaryHistory,
                ...chatHistory,
                userMessage,
            ];

            console.log(`Sending request to OpenRouter (${CONFIGS.OPENROUTER_MODEL_NAME}) with tools...`);
            const result = await openrouter.chat.completions.create({
                model: CONFIGS.OPENROUTER_MODEL_NAME,
                messages: messagesForApi,
                tools: toOpenAITools(),
                tool_choice: "auto",
                temperature: CONFIGS.GENERATION_CONFIG.temperature,
                top_p: CONFIGS.GENERATION_CONFIG.top_p,
            });

            const responseMessage = result?.choices?.[0]?.message;
            if (!responseMessage) {
                console.error("API Error: No response received from OpenRouter.");
                await saveHistoryToFile(chatHistory, HISTORY_FILE_PATH);
                await delay(CONFIGS.LOOP_DELAY_MS);
                continue;
            }

            console.log(`Total tokens used: ${result.usage?.total_tokens ?? "unknown"}`);
            parsedResponseCommentary = typeof responseMessage.content === "string" && responseMessage.content.trim()
                ? responseMessage.content
                : "(no commentary)";

            const toolCall = extractToolCall(responseMessage);

            if (!toolCall) {
                // No tool call: nudge the model to issue one rather than spin.
                console.warn("Warning: No tool call in model response. Nudging.");
                console.log("Full model response:", JSON.stringify(responseMessage, null, 2));
                // D3: still record the call (tool_call=null, outcome=null) so the
                // trace is a complete log of every model invocation — E3 can filter
                // these out as non-distillable rather than wonder where the turn went.
                traceLogger.append(makeTraceRecord({
                    runId: RUN_ID,
                    turn: turnCounter,
                    model: CONFIGS.OPENROUTER_MODEL_NAME,
                    stateBefore: currentPromptText,
                    toolCall: null,
                    commentary: parsedResponseCommentary,
                    outcome: null,
                    stateSummary: summarizeState(state),
                    extra: { usage: result?.usage ?? null, no_tool_call: true },
                }));
                chatHistory.push(userMessage);
                chatHistory.push({
                    role: "assistant",
                    content: parsedResponseCommentary,
                });
                chatHistory.push({
                    role: "user",
                    content: "You did not issue a tool call. You MUST issue exactly one tool call (goto, set_battle_strategy, heal, use_item, or press) next turn.",
                });
                lastPressStreak = null; // not a press turn: ends any merge streak
                turnCounter++;
                evalHarness.markTurn(); // D4: count the (no-tool) model turn.
                await saveHistoryToFile(chatHistory, HISTORY_FILE_PATH);
                broadcastOverlay(state, parsedResponseCommentary, null, null, turnCounter);
                continue;
            }

            toolCallName = toolCall.name;
            toolCallArgs = toolCall.args;
            console.log(`Model tool call: ${toolCallName} ${JSON.stringify(toolCallArgs)}`);

            // 4. Dispatch the tool call → outcome envelope.
            outcome = await dispatchTool(toolCall.name, toolCall.args);
            console.log(`Tool outcome: ${renderOutcomeText(outcome)}`);

            // D3: record the (state_before, tool_call, outcome) tuple for this
            // model call, in the exact shape E3 distillation will consume. The
            // press escape hatch is flagged is_escape_hatch inside makeTraceRecord.
            traceLogger.append(makeTraceRecord({
                runId: RUN_ID,
                turn: turnCounter,
                model: CONFIGS.OPENROUTER_MODEL_NAME,
                stateBefore: currentPromptText,
                toolCall,
                commentary: parsedResponseCommentary,
                outcome,
                stateSummary: summarizeState(state),
                extra: { usage: result?.usage ?? null },
            }));

            // 5. Record the turn in history: the user state prompt, the assistant
            //    tool_call, and the tool outcome message the model reads next.
            //
            // Consecutive clean `press` calls are merged into a single triple
            // instead of each getting their own: a manual button-mash sequence
            // (no macro covers it) would otherwise re-store the full state
            // prompt — map grid, party, bag — once per single button, which is
            // almost entirely duplicate content across those turns. Merging
            // keeps the freshest state prompt (most relevant) and folds the
            // button lists + outcomes together; any non-press tool call or a
            // non-OK press outcome ends the streak so a real interrupt is never
            // silently absorbed into a merged entry.
            const isPressCall = toolCall.name === "press";
            const pressButtons = isPressCall && Array.isArray(toolCall.args?.buttons) ? toolCall.args.buttons : [];
            const outcomeOk = outcome?.status === OUTCOME_STATUS.OK;
            const canMergeWithPrev = isPressCall
                && outcomeOk
                && lastPressStreak
                && (lastPressStreak.buttons.length + pressButtons.length) <= MAX_MERGED_PRESS_BUTTONS;

            if (canMergeWithPrev) {
                const mergedButtons = [...lastPressStreak.buttons, ...pressButtons];
                chatHistory.splice(chatHistory.length - 3, 3); // drop the previous triple, replaced below
                chatHistory.push(userMessage);
                chatHistory.push({
                    role: "assistant",
                    content: parsedResponseCommentary,
                    tool_calls: [{
                        id: toolCall.id,
                        type: "function",
                        function: {
                            name: "press",
                            arguments: JSON.stringify({ ...toolCall.args, buttons: mergedButtons }),
                        },
                    }],
                });
                chatHistory.push({
                    role: "tool",
                    tool_call_id: toolCall.id,
                    content: `${renderOutcomeText(outcome)} | merged with ${lastPressStreak.buttons.length} prior press${lastPressStreak.buttons.length === 1 ? "" : "es"} this streak`,
                });
                lastPressStreak = { buttons: mergedButtons };
            } else {
                chatHistory.push(userMessage);
                chatHistory.push({
                    role: "assistant",
                    content: parsedResponseCommentary,
                    tool_calls: [{
                        id: toolCall.id,
                        type: "function",
                        function: {
                            name: toolCall.name,
                            arguments: JSON.stringify(toolCall.args),
                        },
                    }],
                });
                chatHistory.push({
                    role: "tool",
                    tool_call_id: toolCall.id,
                    content: renderOutcomeText(outcome),
                });
                lastPressStreak = (isPressCall && outcomeOk) ? { buttons: pressButtons } : null;
            }
            turnCounter++;
            // D4: account this model turn + the tool's consumed step budget so
            // the benchmark report reflects turns-to-Brock and step efficiency.
            evalHarness.markTurn();
            evalHarness.markSteps(Number(outcome?.steps_used) || 0);
            await saveHistoryToFile(chatHistory, HISTORY_FILE_PATH);
        } catch (error) {
            console.error("Error during game loop iteration:", error);
            await saveHistoryToFile(chatHistory, HISTORY_FILE_PATH);
            await saveHistoryToFile(summaryHistory, SUMMARY_HISTORY_FILE_PATH);
            broadcastOverlay(null, parsedResponseCommentary, toolCallName, outcome, turnCounter);
            console.log(`--- Waiting for ${CONFIGS.LOOP_DELAY_MS}ms after error ---`);
            await delay(CONFIGS.LOOP_DELAY_MS);
            continue;
        }

        broadcastOverlay(null, parsedResponseCommentary, toolCallName, outcome, turnCounter);
    }
}

/**
 * Broadcast the latest state + last tool call + outcome to overlay clients.
 * Shape updated for D2: the old navigation/goal fields are gone (the model no
 * longer emits them); we now send the tool call + outcome + snapshot sections.
 * @param {object|null} state
 * @param {string} commentary
 * @param {string} toolName
 * @param {object|null} outcome
 * @param {number} turnCounter
 */
function broadcastOverlay(state, commentary, toolName, outcome, turnCounter) {
    const turnsUntilSummaryValue = Math.max(0, CONFIGS.HISTORY_LENGTH - turnCounter);
    const overlayData = {
        mapData: state?.map ?? lastOverlayData?.mapData ?? null,
        commentary: commentary || "AI is still processing...",
        toolCall: toolName ? { name: toolName } : (lastOverlayData?.toolCall ?? null),
        outcome: outcome ?? (lastOverlayData?.outcome ?? null),
        // Backward-compat fields the overlay may still reference:
        navigation: [],
        goalLongTerm: "n/a",
        goalMidTerm: "n/a",
        goalShortTerm: "n/a",
        pokemon: state?.party?.pokemon ?? (lastOverlayData?.pokemon ?? []),
        bag: state?.bag ?? (lastOverlayData?.bag ?? {}),
        badges: state?.player?.badges ?? (lastOverlayData?.badges ?? []),
        money: typeof state?.player?.money === 'number' ? state.player.money : (lastOverlayData?.money ?? 0),
        turnsUntilSummary: turnsUntilSummaryValue,
    };
    lastOverlayData = overlayData; // Update last known data
    broadcastToOverlays(overlayData);
}

runGameLoop();

// --- Graceful shutdown: flush D3 trace + write D4 benchmark report -----------
// The loop runs forever; on SIGINT/SIGTERM, await the trace logger's write queue
// and finalize the eval harness's benchmark report (stamps finish time + writes
// the report even if the terminal Boulder Badge milestone was never reached)
// so the last few records land on disk before the process dies.
async function shutdown(signal) {
    console.log(`\n[${signal}] shutting down — flushing trace file ${TRACE_FILE_PATH}...`);
    try {
        await traceLogger.close();
    } catch (e) {
        console.error("Error flushing trace file on shutdown:", e?.message ?? e);
    }
    try {
        const report = await evalHarness.close();
        console.log(`[eval] benchmark report written to ${EVAL_REPORT_PATH} (reached: ${report.reached_milestone ?? "none"}, turns: ${report.turns})`);
    } catch (e) {
        console.error("Error writing benchmark report on shutdown:", e?.message ?? e);
    }
    process.exit(0);
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
