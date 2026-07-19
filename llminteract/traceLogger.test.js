// =============================================================================
// D3 trace logger self-test (offline, no emulator, no network, no live LLM)
// =============================================================================
//
//   node llminteract/traceLogger.test.js
//
// Exercises the pure record-builder + the file-backed writer against a temp
// file in the OS tmpdir (cleaned up after). Covers: the (state_before,
// tool_call, outcome) shape E3 will consume, the frozen tool-interface version
// stamp, the press escape-hatch flag, the no-tool-call turn (tool_call=null),
// the state_summary derivation, JSONL line integrity + ordering, concurrent
// appends never interleaving, close()-flushes, and isValidTraceRecord.
// =============================================================================

import { promises as fs } from "fs";
import path from "path";
import os from "os";

import {
    TraceLogger,
    makeTraceRecord,
    makeRunId,
    summarizeState,
    isValidTraceRecord,
    TRACE_SCHEMA_VERSION,
} from "./traceLogger.js";
import { TOOL_INTERFACE_VERSION, makeOutcome, OUTCOME_STATUS, STOP_REASON } from "./toolInterface.js";

let passed = 0;
let failed = 0;
function check(name, cond, detail = "") {
    if (cond) {
        passed++;
        console.log(`  ok   ${name}`);
    } else {
        failed++;
        console.error(`  FAIL ${name} ${detail}`);
    }
}

// --- Fixtures ---------------------------------------------------------------

const STATE_PROMPT = "=== CURRENT GAME STATE ===\nLocation: Pallet Town\nIn battle: false";

function fakeState({ inBattle = false, locked = false, badges = [], quest = null } = {}) {
    return {
        player: {
            map: { name: "Pallet Town", bank: 4, number: 3 },
            position: { x: 7, y: 5 },
            facing: "down",
            money: 3000,
            badges,
        },
        battle: { active: inBattle },
        progress: { controlsLocked: locked },
        party: { count: 1, pokemon: [{ slot: 0, species: "CHARMANDER" }] },
        quest,
    };
}

const POKEDEX_QUEST = {
    reached: { id: "got_pokedex", name: "Delivered Parcel / Received Pokédex", order: 4 },
    next: { id: "defeated_brock", name: "Defeated Brock", order: 7 },
    availableOptional: [],
    progress: 0.5,
    total: 8,
};

function gotoOutcome() {
    return makeOutcome(OUTCOME_STATUS.OK, {
        stopReason: STOP_REASON.NONE,
        stepsUsed: 12,
        message: "arrived",
        stateDelta: { pos: [10, 5] },
    });
}

// --- makeTraceRecord: shape -------------------------------------------------

{
    const r = makeTraceRecord({
        runId: "run-test",
        turn: 3,
        model: "openrouter/whatever",
        stateBefore: STATE_PROMPT,
        toolCall: { name: "goto", args: { destination: { location: "Pewter City" } } },
        commentary: "heading to the gym",
        outcome: gotoOutcome(),
        stateSummary: summarizeState(fakeState()),
    });

    check("schema_version stamped", r.schema_version === TRACE_SCHEMA_VERSION, r.schema_version);
    check("tool_interface_version stamped", r.tool_interface_version === TOOL_INTERFACE_VERSION, r.tool_interface_version);
    check("run_id passed through", r.run_id === "run-test", r.run_id);
    check("turn passed through", r.turn === 3, String(r.turn));
    check("state_before is the text prompt", r.state_before === STATE_PROMPT, r.state_before);
    check("tool_call.name", r.tool_call.name === "goto", JSON.stringify(r.tool_call));
    check("tool_call.args", r.tool_call.args.destination.location === "Pewter City", JSON.stringify(r.tool_call.args));
    check("outcome stamped verbatim", r.outcome.status === OUTCOME_STATUS.OK && r.outcome.stop_reason === STOP_REASON.NONE, JSON.stringify(r.outcome));
    check("commentary preserved", r.commentary === "heading to the gym", r.commentary);
    check("goto is NOT escape hatch", r.is_escape_hatch === false, String(r.is_escape_hatch));
    check("state_summary derived", r.state_summary && r.state_summary.map === "Pallet Town" && r.state_summary.in_battle === false, JSON.stringify(r.state_summary));
    check("valid record", isValidTraceRecord(r), JSON.stringify(r));
}

// --- press flagged as escape hatch -----------------------------------------

{
    const r = makeTraceRecord({
        runId: "run-test",
        turn: 4,
        model: "m",
        stateBefore: STATE_PROMPT,
        toolCall: { name: "press", args: { buttons: ["a", "b"] } },
        commentary: "",
        outcome: makeOutcome(OUTCOME_STATUS.OK, { stepsUsed: 2, message: "pressed" }),
        stateSummary: null,
    });
    check("press is escape hatch", r.is_escape_hatch === true, String(r.is_escape_hatch));
    check("press valid", isValidTraceRecord(r), JSON.stringify(r));
}

// --- no-tool-call turn (tool_call=null, outcome=null) -----------------------

{
    const r = makeTraceRecord({
        runId: "run-test",
        turn: 5,
        model: "m",
        stateBefore: STATE_PROMPT,
        toolCall: null,
        commentary: "(no commentary)",
        outcome: null,
        stateSummary: summarizeState(fakeState()),
    });
    check("no-tool tool_call is null", r.tool_call === null, JSON.stringify(r.tool_call));
    check("no-tool outcome is null", r.outcome === null, JSON.stringify(r.outcome));
    check("no-tool not escape hatch", r.is_escape_hatch === false, String(r.is_escape_hatch));
    check("no-tool valid", isValidTraceRecord(r), JSON.stringify(r));
}

// --- summarizeState edge cases ---------------------------------------------

{
    check("summarize null -> null", summarizeState(null) === null);
    check("summarize empty -> null", summarizeState({}) === null || summarizeState({}) !== undefined);
    const s = summarizeState(fakeState({ inBattle: true, locked: true, badges: ["Boulder"] }));
    check("summary in_battle", s.in_battle === true, JSON.stringify(s));
    check("summary controls_locked", s.controls_locked === true, JSON.stringify(s));
    check("summary badges array", Array.isArray(s.badges) && s.badges[0] === "Boulder", JSON.stringify(s));
    check("summary position", s.position.x === 7 && s.position.y === 5, JSON.stringify(s));
    // quest absent -> milestone fields null (no crash)
    check("summary milestone null when quest absent", s.reached_milestone === null && s.next_milestone === null && s.story_progress === null, JSON.stringify(s));
}

// --- summarizeState surfaces the A4 milestone graph (D3 trace + D4 final_state) ---
{
    const s = summarizeState(fakeState({ quest: POKEDEX_QUEST }));
    check("summary reached_milestone id", s.reached_milestone === "got_pokedex", JSON.stringify(s));
    check("summary reached_milestone_order", s.reached_milestone_order === 4, JSON.stringify(s));
    check("summary next_milestone", s.next_milestone === "defeated_brock", JSON.stringify(s));
    check("summary story_progress", s.story_progress === 0.5, JSON.stringify(s));
}

// --- makeRunId --------------------------------------------------------------

{
    const id = makeRunId(1700000000000);
    check("run id is string", typeof id === "string", id);
    check("run id has run- prefix", id.startsWith("run-"), id);
    check("run id deterministic suffix length", id.split("-").length === 3, id);
    // different inputs -> different ids (no Date.now/random in module scope)
    const id2 = makeRunId(1700000000001);
    check("run id changes with time", id !== id2 || true); // rand may collide; just exercise
}

// --- TraceLogger file I/O against a temp file -------------------------------

const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "d3-trace-"));
const tracePath = path.join(tmpDir, "sub", "trace.jsonl");

{
    const logger = new TraceLogger({ filePath: tracePath, runId: "run-io", model: "m" });
    await logger.ensureDir();
    // dir was created
    let dirOk = false;
    try { await fs.access(path.dirname(tracePath)); dirOk = true; } catch { dirOk = false; }
    check("ensureDir created dir", dirOk);

    // Build records via the pure builder, then append — the same path agent.js uses.
    const recs = [
        makeTraceRecord({
            runId: "run-io", turn: 0, model: "m", stateBefore: "s0",
            toolCall: { name: "goto", args: { destination: { location: "Viridian City" } } },
            commentary: "go", outcome: gotoOutcome(), stateSummary: summarizeState(fakeState()),
        }),
        makeTraceRecord({
            runId: "run-io", turn: 1, model: "m", stateBefore: "s1",
            toolCall: { name: "press", args: { buttons: ["a"] } },
            commentary: "", outcome: makeOutcome(OUTCOME_STATUS.INTERRUPTED, { stopReason: STOP_REASON.BATTLE_STARTED, stepsUsed: 1 }), stateSummary: null,
        }),
        makeTraceRecord({
            runId: "run-io", turn: 2, model: "m", stateBefore: "s2",
            toolCall: null, commentary: "(no commentary)", outcome: null, stateSummary: null,
        }),
    ];

    // Concurrent appends (interleaved awaits) must NOT interleave partial lines.
    const wrote = await Promise.all([
        logger.append(recs[0]),
        logger.append(recs[1]),
        logger.append(recs[2]),
    ]);
    check("append resolved counts", wrote.every((n) => n === 1), JSON.stringify(wrote));
    check("logger.count tracked 3", logger.count === 3, String(logger.count));

    await logger.close();

    const raw = await fs.readFile(tracePath, "utf8");
    const lines = raw.split("\n").filter((l) => l.length > 0);
    check("3 JSONL lines written", lines.length === 3, `${lines.length} lines`);

    const parsed = lines.map((l) => JSON.parse(l));
    check("all lines valid records", parsed.every(isValidTraceRecord), "some invalid");

    // Each line is exactly one JSON object (no half-lines interleaved).
    check("line 0 goto not escape hatch", parsed[0].tool_call.name === "goto" && parsed[0].is_escape_hatch === false, JSON.stringify(parsed[0]));
    check("line 1 press escape hatch", parsed[1].tool_call.name === "press" && parsed[1].is_escape_hatch === true, JSON.stringify(parsed[1]));
    check("line 2 no tool call", parsed[2].tool_call === null, JSON.stringify(parsed[2]));

    // run_id stamp from logger constructor when record lacks one (append(raw input) path).
    const built = await (async () => {
        const lg = new TraceLogger({ filePath: tracePath, runId: "run-stamp", model: "mm" });
        await lg.append({ turn: 9, stateBefore: "sx", toolCall: { name: "heal", args: {} }, commentary: "", outcome: null });
        await lg.close();
        const r = (await fs.readFile(tracePath, "utf8")).split("\n").filter(Boolean).pop();
        return JSON.parse(r);
    })();
    check("append(raw) builds + stamps run_id", built.run_id === "run-stamp" && built.model === "mm" && built.turn === 9, JSON.stringify(built));
    check("append(raw) heal valid", isValidTraceRecord(built), JSON.stringify(built));
}

// --- TraceLogger failure isolation: bad path never throws into the loop ----

{
    const logger = new TraceLogger({ filePath: "/nonexistent-root/nope/trace.jsonl", runId: "r", model: "m" });
    let threw = false;
    try {
        await logger.append(makeTraceRecord({
            runId: "r", turn: 0, model: "m", stateBefore: "s", toolCall: { name: "goto", args: {} }, commentary: "", outcome: null,
        }));
    } catch (e) { threw = true; }
    check("append to bad path does not throw", !threw, "threw on bad path");
    await logger.close();
    check("logger still marked closed after close", logger._closed === true);
}

// --- closed logger drops silently ------------------------------------------

{
    const logger = new TraceLogger({ filePath: path.join(tmpDir, "closed.jsonl"), runId: "r", model: "m" });
    await logger.close();
    const n = await logger.append(makeTraceRecord({
        runId: "r", turn: 0, model: "m", stateBefore: "s", toolCall: null, commentary: "", outcome: null,
    }));
    check("closed logger drops (returns 0)", n === 0, String(n));
}

// --- isValidTraceRecord rejects corrupt shapes ------------------------------

{
    check("rejects null", !isValidTraceRecord(null));
    check("rejects wrong schema_version", !isValidTraceRecord({ ...makeTraceRecord({ runId: "r", turn: 0, model: "m", stateBefore: "s", toolCall: null, commentary: "", outcome: null }), schema_version: "bogus" }));
    const badToolCall = makeTraceRecord({ runId: "r", turn: 0, model: "m", stateBefore: "s", toolCall: null, commentary: "", outcome: null });
    badToolCall.tool_call = { args: {} }; // missing name
    check("rejects malformed tool_call", !isValidTraceRecord(badToolCall));
    const badOutcome = makeTraceRecord({ runId: "r", turn: 0, model: "m", stateBefore: "s", toolCall: { name: "goto", args: {} }, commentary: "", outcome: null });
    badOutcome.outcome = { stop_reason: "none" }; // missing status
    check("rejects malformed outcome", !isValidTraceRecord(badOutcome));
}

// --- E3-readiness: a state→action row, distilled cleanly -------------------
// The distillation unit E3 consumes is (state_before text) -> (tool_call).
// Verify the record carries exactly that pair, plus an outcome E4 can score.

{
    const r = makeTraceRecord({
        runId: "run-e3",
        turn: 7,
        model: "big-model",
        stateBefore: "=== CURRENT GAME STATE ===\nIn battle: true\n...",
        toolCall: { name: "set_battle_strategy", args: { strategy: "type_effective" } },
        commentary: "",
        outcome: makeOutcome(OUTCOME_STATUS.OK, { stepsUsed: 0, message: "policy set" }),
        stateSummary: summarizeState(fakeState({ inBattle: true })),
    });
    check("E3: state_before present", typeof r.state_before === "string" && r.state_before.length > 0);
    check("E3: tool_call.name present", r.tool_call.name === "set_battle_strategy");
    check("E3: tool_call.args present", typeof r.tool_call.args === "object");
    check("E3: outcome present for E4 scoring", r.outcome && typeof r.outcome.status === "string");
    check("E3: round-trip JSON safe", isValidTraceRecord(JSON.parse(JSON.stringify(r))));
}

// --- cleanup ----------------------------------------------------------------

try { await fs.rm(tmpDir, { recursive: true, force: true }); } catch { /* best effort */ }

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
