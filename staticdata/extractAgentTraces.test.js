// Pure-function self-test for staticdata/extractAgentTraces.js (E3). No file
// I/O, no emulator, no LLM call — everything here is offline-testable per the
// repo's convention (mirrors extractStateIntent.test.js).
import { test } from "node:test";
import assert from "node:assert/strict";

import {
    parseJsonlLines,
    isDistillable,
    isManualMovementFallback,
    dedupKey,
    toAgentTraceRecord,
    parseAgentTraceObj,
} from "./extractAgentTraces.js";

test("parseJsonlLines: parses well-formed lines, skips torn ones", () => {
    const text = '{"a":1}\n{"a":2}\n{bad json\n\n{"a":3}\n';
    const out = parseJsonlLines(text);
    assert.deepEqual(out, [{ a: 1 }, { a: 2 }, { a: 3 }]);
});

test("parseJsonlLines: empty text -> empty array", () => {
    assert.deepEqual(parseJsonlLines(""), []);
    assert.deepEqual(parseJsonlLines("\n\n"), []);
});

const OK_RECORD = Object.freeze({
    schema_version: "trace/1.0",
    tool_interface_version: "1.1.0",
    run_id: "run-abc-1",
    turn: 5,
    model: "google/gemini-3.5-flash",
    state_before: "=== CURRENT GAME STATE ===\nLocation: MAP_ROUTE1",
    tool_call: { name: "goto", args: { destination: { location: "Viridian City" } } },
    commentary: "Heading to Viridian.",
    is_escape_hatch: false,
    outcome: { status: "ok", stop_reason: "none", steps_used: 42, message: "arrived" },
});

test("isDistillable: accepts an ok-status record with a tool call", () => {
    assert.equal(isDistillable(OK_RECORD, new Set(["ok"])), true);
});

test("isDistillable: rejects a null tool_call (no-tool-call nudge turn)", () => {
    const r = { ...OK_RECORD, tool_call: null };
    assert.equal(isDistillable(r, new Set(["ok"])), false);
});

test("isDistillable: rejects interrupted status when only 'ok' is allowed (covers low-HP interrupts)", () => {
    const r = { ...OK_RECORD, outcome: { status: "interrupted", stop_reason: "hp_low" } };
    assert.equal(isDistillable(r, new Set(["ok"])), false);
});

test("isDistillable: rejects failed / invalid_args and budget_exhausted", () => {
    assert.equal(isDistillable({ ...OK_RECORD, outcome: { status: "failed" } }, new Set(["ok"])), false);
    assert.equal(isDistillable({ ...OK_RECORD, outcome: { status: "budget_exhausted" } }, new Set(["ok"])), false);
});

test("isDistillable: honors a wider allowed-status set when explicitly configured", () => {
    const r = { ...OK_RECORD, outcome: { status: "interrupted", stop_reason: "battle_started" } };
    assert.equal(isDistillable(r, new Set(["ok", "interrupted"])), true);
});

const PRESS_RECORD = (buttons, stateSummary) => ({
    ...OK_RECORD,
    tool_call: { name: "press", args: { buttons } },
    state_summary: stateSummary,
});

test("isManualMovementFallback: flags directional press while free-walking (not in battle, controls unlocked)", () => {
    const r = PRESS_RECORD(["left", "up", "up"], { in_battle: false, controls_locked: false });
    assert.equal(isManualMovementFallback(r), true);
});

test("isManualMovementFallback: does NOT flag a-only dialog-advance presses", () => {
    const r = PRESS_RECORD(["a", "a", "a"], { in_battle: false, controls_locked: true });
    assert.equal(isManualMovementFallback(r), false);
});

test("isManualMovementFallback: does NOT flag directional presses while controls are locked (dialog/cutscene)", () => {
    const r = PRESS_RECORD(["up", "up"], { in_battle: false, controls_locked: true });
    assert.equal(isManualMovementFallback(r), false);
});

test("isManualMovementFallback: does NOT flag directional presses mid-battle (manual battle nav)", () => {
    const r = PRESS_RECORD(["down", "a"], { in_battle: true, controls_locked: false });
    assert.equal(isManualMovementFallback(r), false);
});

test("isManualMovementFallback: does NOT flag non-press tool calls or missing state_summary", () => {
    assert.equal(isManualMovementFallback(OK_RECORD), false); // goto
    const noSummary = { ...OK_RECORD, tool_call: { name: "press", args: { buttons: ["up"] } }, state_summary: null };
    assert.equal(isManualMovementFallback(noSummary), false);
});

test("isDistillable: excludes a manual-movement fallback even though status is ok", () => {
    const r = PRESS_RECORD(["left", "left", "up"], { in_battle: false, controls_locked: false });
    assert.equal(isDistillable(r, new Set(["ok"])), false);
});

test("isDistillable: rejects malformed/missing records", () => {
    assert.equal(isDistillable(null, new Set(["ok"])), false);
    assert.equal(isDistillable({}, new Set(["ok"])), false);
    assert.equal(isDistillable({ tool_call: { name: 5 } }, new Set(["ok"])), false);
});

test("dedupKey: identical (state, tool_call) pairs produce the same key", () => {
    const k1 = dedupKey("Location: MAP_ROUTE1", { name: "goto", args: { destination: { location: "X" } } });
    const k2 = dedupKey("Location: MAP_ROUTE1", { name: "goto", args: { destination: { location: "X" } } });
    assert.equal(k1, k2);
});

test("dedupKey: whitespace-only differences in state normalize to the same key", () => {
    const k1 = dedupKey("Location:   MAP_ROUTE1\n\nfacing up", { name: "press", args: { buttons: ["a"] } });
    const k2 = dedupKey("location: map_route1 facing up", { name: "press", args: { buttons: ["a"] } });
    assert.equal(k1, k2);
});

test("dedupKey: a different tool_call changes the key even for identical state", () => {
    const k1 = dedupKey("same state", { name: "press", args: { buttons: ["a"] } });
    const k2 = dedupKey("same state", { name: "press", args: { buttons: ["b"] } });
    assert.notEqual(k1, k2);
});

test("toAgentTraceRecord: reshapes a D3 trace record into the E3 source shape", () => {
    const r = toAgentTraceRecord(OK_RECORD);
    assert.equal(r.source, "run-abc-1");
    assert.equal(r.turn, 5);
    assert.equal(r.model, "google/gemini-3.5-flash");
    assert.equal(r.tool_interface_version, "1.1.0");
    assert.equal(r.state, OK_RECORD.state_before);
    assert.deepEqual(r.tool_call, { name: "goto", args: { destination: { location: "Viridian City" } } });
    assert.equal(r.commentary, "Heading to Viridian.");
    assert.equal(r.is_escape_hatch, false);
    assert.equal(r.outcome_status, "ok");
    assert.equal(r.steps_used, 42);
});

test("parseAgentTraceObj: parses a clean {tool_call, commentary} object", () => {
    const r = parseAgentTraceObj('{"tool_call":{"name":"press","args":{"buttons":["a"]}},"commentary":"advance text"}');
    assert.deepEqual(r, { tool_call: { name: "press", args: { buttons: ["a"] } }, commentary: "advance text" });
});

test("parseAgentTraceObj: strips a leading sentence and code fences", () => {
    const r = parseAgentTraceObj('Sure, here you go:\n```json\n{"tool_call":{"name":"heal","args":{}},"commentary":"low hp"}\n```');
    assert.deepEqual(r, { tool_call: { name: "heal", args: {} }, commentary: "low hp" });
});

test("parseAgentTraceObj: returns null for missing tool_call / unparseable input", () => {
    assert.equal(parseAgentTraceObj(""), null);
    assert.equal(parseAgentTraceObj("not json at all"), null);
    assert.equal(parseAgentTraceObj('{"commentary":"no tool_call here"}'), null);
});

test("toAgentTraceRecord: defaults missing args/commentary safely", () => {
    const r = toAgentTraceRecord({
        run_id: "r1",
        turn: 0,
        model: "m",
        tool_interface_version: "1.1.0",
        state_before: "s",
        tool_call: { name: "press" },
        outcome: { status: "ok" },
    });
    assert.deepEqual(r.tool_call, { name: "press", args: {} });
    assert.equal(r.commentary, "");
    assert.equal(r.steps_used, 0);
});
