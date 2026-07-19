// Offline pure-function self-test for the intent-eval scoring helpers.
//   node --test finetune-state-intent/intentEval.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { stableStringify, argMatch, scoreIntent, buildIntentJudgeMessages } from "./intentEval.js";

const I = (name, args) => ({ name, args });

test("stableStringify is key-order independent", () => {
  assert.equal(
    stableStringify({ a: 1, b: { y: 2, x: 1 } }),
    stableStringify({ b: { x: 1, y: 2 }, a: 1 }),
  );
  assert.equal(stableStringify(I("press", { buttons: ["a", "b"] })), stableStringify({ args: { buttons: ["a", "b"] }, name: "press" }));
});

test("argMatch: goto location is case/punct-tolerant", () => {
  const gold = I("goto", { destination: { location: "Pewter City" } });
  assert.equal(argMatch(I("goto", { destination: { location: "pewter city" } }), gold), true);
  assert.equal(argMatch(I("goto", { destination: { location: "Pewter City!" } }), gold), true);
  assert.equal(argMatch(I("goto", { destination: { location: "Viridian City" } }), gold), false);
  // different arg shape (x,y vs location) -> no lenient match
  assert.equal(argMatch(I("goto", { destination: { x: 3, y: 4 } }), gold), false);
});

test("argMatch: goto x,y must match exactly", () => {
  const gold = I("goto", { destination: { x: 3, y: 4 } });
  assert.equal(argMatch(I("goto", { destination: { x: 3, y: 4 } }), gold), true);
  assert.equal(argMatch(I("goto", { destination: { x: 3, y: 5 } }), gold), false);
});

test("argMatch: press compares the button array", () => {
  const gold = I("press", { buttons: ["a", "b"] });
  assert.equal(argMatch(I("press", { buttons: ["a", "b"] }), gold), true);
  assert.equal(argMatch(I("press", { buttons: ["b", "a"] }), gold), false); // order matters
  assert.equal(argMatch(I("press", { buttons: ["a"] }), gold), false);
});

test("argMatch: strategy / method / item equality", () => {
  assert.equal(
    argMatch(I("set_battle_strategy", { strategy: "type_effective" }), I("set_battle_strategy", { strategy: "type_effective" })),
    true,
  );
  assert.equal(
    argMatch(I("set_battle_strategy", { strategy: "highest_damage" }), I("set_battle_strategy", { strategy: "type_effective" })),
    false,
  );
  assert.equal(argMatch(I("heal", { method: "pokecenter" }), I("heal", { method: "pokecenter" })), true);
  // use_item item is normalized -> case-insensitive
  assert.equal(argMatch(I("use_item", { item: "potion" }), I("use_item", { item: "Potion" })), true);
  assert.equal(argMatch(I("use_item", { item: "Antidote" }), I("use_item", { item: "Potion" })), false);
});

test("argMatch: different tool names never match", () => {
  assert.equal(argMatch(I("press", { buttons: ["a"] }), I("goto", { destination: { location: "X" } })), false);
});

// --- scoreIntent end-to-end on raw model text -------------------------------

const RAW = (intent, rationale = "r") => JSON.stringify({ intent, rationale });

test("scoreIntent: exact match on a clean press", () => {
  const gold = I("press", { buttons: ["a"] });
  const s = scoreIntent(RAW(I("press", { buttons: ["a"] })), gold);
  assert.equal(s.parse_ok, true);
  assert.equal(s.valid, true);
  assert.equal(s.name_match, true);
  assert.equal(s.exact, true);
  assert.equal(s.arg_match, true);
  assert.equal(s.invalid_reason, null);
});

test("scoreIntent: parses JSON wrapped in prose / fenced", () => {
  const gold = I("press", { buttons: ["a"] });
  const wrapped = `Sure! ${RAW(I("press", { buttons: ["a"] }))} hope that helps`;
  assert.equal(scoreIntent(wrapped, gold).exact, true);
  const fenced = "```json\n" + RAW(I("press", { buttons: ["a"] })) + "\n```";
  assert.equal(scoreIntent(fenced, gold).exact, true);
});

test("scoreIntent: empty / unparseable responses", () => {
  const gold = I("press", { buttons: ["a"] });
  const e = scoreIntent("", gold);
  assert.equal(e.parse_ok, false);
  assert.equal(e.valid, false);
  assert.equal(e.parse_error, "empty response");
  const u = scoreIntent("I cannot help with that.", gold);
  assert.equal(u.parse_ok, false);
  assert.equal(u.parse_error, "unparseable: no {intent,...} object");
});

test("scoreIntent: parse_ok but invalid (bad enum / missing required)", () => {
  const gold = I("press", { buttons: ["a"] });
  // bad button not in the D1 enum -> validateIntent rejects
  const badBtn = scoreIntent(RAW(I("press", { buttons: ["zzz"] })), gold);
  assert.equal(badBtn.parse_ok, true);
  assert.equal(badBtn.valid, false);
  assert.equal(badBtn.name_match, false); // validity gate
  assert.equal(badBtn.invalid_reason && badBtn.invalid_reason.includes("button"), true);
  // missing required arg
  const noArgs = scoreIntent(RAW({ name: "goto", args: {} }), I("goto", { destination: { location: "X" } }));
  assert.equal(noArgs.valid, false);
});

test("scoreIntent: right name, wrong args -> name_match true, exact false", () => {
  const gold = I("set_battle_strategy", { strategy: "type_effective" });
  const s = scoreIntent(RAW(I("set_battle_strategy", { strategy: "highest_damage" })), gold);
  assert.equal(s.name_match, true);
  assert.equal(s.exact, false);
  assert.equal(s.arg_match, false);
});

test("scoreIntent: goto location case difference -> arg_match true, exact false", () => {
  const gold = I("goto", { destination: { location: "Pewter City" } });
  const s = scoreIntent(RAW(I("goto", { destination: { location: "pewter city" } })), gold);
  assert.equal(s.name_match, true);
  assert.equal(s.exact, false);
  assert.equal(s.arg_match, true);
});

test("scoreIntent: wrong tool name -> everything false", () => {
  const gold = I("press", { buttons: ["a"] });
  const s = scoreIntent(RAW(I("goto", { destination: { location: "Pewter City" } })), gold);
  assert.equal(s.valid, true);
  assert.equal(s.name_match, false);
  assert.equal(s.exact, false);
  assert.equal(s.arg_match, false);
});

test("buildIntentJudgeMessages: system + user with state, gold, pred", () => {
  const m = buildIntentJudgeMessages("[0s] a frame", I("press", { buttons: ["a"] }), I("press", { buttons: ["b"] }));
  assert.equal(m.length, 2);
  assert.equal(m[0].role, "system");
  assert.equal(m[1].role, "user");
  assert.ok(m[1].content.includes("[0s] a frame"));
  assert.ok(m[1].content.includes("Reference intent"));
  assert.ok(m[1].content.includes("Candidate intent"));
});
