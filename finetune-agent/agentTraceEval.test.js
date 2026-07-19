// Offline pure-function self-test for the agent-trace-eval scoring helpers.
//   node --test finetune-agent/agentTraceEval.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { stableStringify, argMatch, scoreToolCall, buildToolCallJudgeMessages } from "./agentTraceEval.js";

const T = (name, args) => ({ name, args });

test("stableStringify is key-order independent", () => {
  assert.equal(
    stableStringify({ a: 1, b: { y: 2, x: 1 } }),
    stableStringify({ b: { x: 1, y: 2 }, a: 1 }),
  );
  assert.equal(stableStringify(T("press", { buttons: ["a", "b"] })), stableStringify({ args: { buttons: ["a", "b"] }, name: "press" }));
});

test("argMatch: goto location is case/punct-tolerant", () => {
  const gold = T("goto", { destination: { location: "Pewter City" } });
  assert.equal(argMatch(T("goto", { destination: { location: "pewter city" } }), gold), true);
  assert.equal(argMatch(T("goto", { destination: { location: "Pewter City!" } }), gold), true);
  assert.equal(argMatch(T("goto", { destination: { location: "Viridian City" } }), gold), false);
  assert.equal(argMatch(T("goto", { destination: { x: 3, y: 4 } }), gold), false);
});

test("argMatch: goto x,y must match exactly", () => {
  const gold = T("goto", { destination: { x: 3, y: 4 } });
  assert.equal(argMatch(T("goto", { destination: { x: 3, y: 4 } }), gold), true);
  assert.equal(argMatch(T("goto", { destination: { x: 3, y: 5 } }), gold), false);
});

test("argMatch: press compares the button array", () => {
  const gold = T("press", { buttons: ["a", "b"] });
  assert.equal(argMatch(T("press", { buttons: ["a", "b"] }), gold), true);
  assert.equal(argMatch(T("press", { buttons: ["b", "a"] }), gold), false); // order matters
  assert.equal(argMatch(T("press", { buttons: ["a"] }), gold), false);
});

test("argMatch: strategy / method / item equality, fight_battle shares set_battle_strategy's rule", () => {
  assert.equal(
    argMatch(T("set_battle_strategy", { strategy: "type_effective" }), T("set_battle_strategy", { strategy: "type_effective" })),
    true,
  );
  assert.equal(
    argMatch(T("set_battle_strategy", { strategy: "highest_damage" }), T("set_battle_strategy", { strategy: "type_effective" })),
    false,
  );
  assert.equal(argMatch(T("fight_battle", {}), T("fight_battle", {})), true); // both omit strategy (standing policy)
  assert.equal(argMatch(T("heal", { method: "pokecenter" }), T("heal", { method: "pokecenter" })), true);
  assert.equal(argMatch(T("use_item", { item: "potion" }), T("use_item", { item: "Potion" })), true);
  assert.equal(argMatch(T("use_item", { item: "Antidote" }), T("use_item", { item: "Potion" })), false);
});

test("argMatch: different tool names never match", () => {
  assert.equal(argMatch(T("press", { buttons: ["a"] }), T("goto", { destination: { location: "X" } })), false);
});

// --- scoreToolCall end-to-end on raw model text -----------------------------

const RAW = (tool_call, commentary = "c") => JSON.stringify({ tool_call, commentary });

test("scoreToolCall: exact match on a clean press", () => {
  const gold = T("press", { buttons: ["a"] });
  const s = scoreToolCall(RAW(T("press", { buttons: ["a"] })), gold);
  assert.equal(s.parse_ok, true);
  assert.equal(s.valid, true);
  assert.equal(s.name_match, true);
  assert.equal(s.exact, true);
  assert.equal(s.arg_match, true);
  assert.equal(s.invalid_reason, null);
});

test("scoreToolCall: parses JSON wrapped in prose / fenced", () => {
  const gold = T("press", { buttons: ["a"] });
  const wrapped = `Sure! ${RAW(T("press", { buttons: ["a"] }))} hope that helps`;
  assert.equal(scoreToolCall(wrapped, gold).exact, true);
  const fenced = "```json\n" + RAW(T("press", { buttons: ["a"] })) + "\n```";
  assert.equal(scoreToolCall(fenced, gold).exact, true);
});

test("scoreToolCall: empty / unparseable responses", () => {
  const gold = T("press", { buttons: ["a"] });
  const e = scoreToolCall("", gold);
  assert.equal(e.parse_ok, false);
  assert.equal(e.valid, false);
  assert.equal(e.parse_error, "empty response");
  const u = scoreToolCall("I cannot help with that.", gold);
  assert.equal(u.parse_ok, false);
  assert.equal(u.parse_error, "unparseable: no {tool_call,...} object");
});

test("scoreToolCall: parse_ok but invalid (bad enum / missing required)", () => {
  const gold = T("press", { buttons: ["a"] });
  const badBtn = scoreToolCall(RAW(T("press", { buttons: ["zzz"] })), gold);
  assert.equal(badBtn.parse_ok, true);
  assert.equal(badBtn.valid, false);
  assert.equal(badBtn.name_match, false); // validity gate
  assert.equal(badBtn.invalid_reason && badBtn.invalid_reason.includes("button"), true);
  const noArgs = scoreToolCall(RAW({ name: "goto", args: {} }), T("goto", { destination: { location: "X" } }));
  assert.equal(noArgs.valid, false);
});

test("scoreToolCall: right name, wrong args -> name_match true, exact false", () => {
  const gold = T("set_battle_strategy", { strategy: "type_effective" });
  const s = scoreToolCall(RAW(T("set_battle_strategy", { strategy: "highest_damage" })), gold);
  assert.equal(s.name_match, true);
  assert.equal(s.exact, false);
  assert.equal(s.arg_match, false);
});

test("scoreToolCall: goto location case difference -> arg_match true, exact false", () => {
  const gold = T("goto", { destination: { location: "Pewter City" } });
  const s = scoreToolCall(RAW(T("goto", { destination: { location: "pewter city" } })), gold);
  assert.equal(s.name_match, true);
  assert.equal(s.exact, false);
  assert.equal(s.arg_match, true);
});

test("scoreToolCall: wrong tool name -> everything false", () => {
  const gold = T("press", { buttons: ["a"] });
  const s = scoreToolCall(RAW(T("goto", { destination: { location: "Pewter City" } })), gold);
  assert.equal(s.valid, true);
  assert.equal(s.name_match, false);
  assert.equal(s.exact, false);
  assert.equal(s.arg_match, false);
});

test("buildToolCallJudgeMessages: system + user with state, gold, pred", () => {
  const m = buildToolCallJudgeMessages("Location: MAP_ROUTE1", T("press", { buttons: ["a"] }), T("press", { buttons: ["b"] }));
  assert.equal(m.length, 2);
  assert.equal(m[0].role, "system");
  assert.equal(m[1].role, "user");
  assert.ok(m[1].content.includes("Location: MAP_ROUTE1"));
  assert.ok(m[1].content.includes("Reference tool call"));
  assert.ok(m[1].content.includes("Candidate tool call"));
});
