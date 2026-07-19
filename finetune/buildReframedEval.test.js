// Offline pure-function self-test for the reframed-eval generator.
//   node --test finetune/buildReframedEval.test.js
import test from "node:test";
import assert from "node:assert/strict";
import {
  normQ,
  allocBySource,
  selectSeeds,
  buildGold,
  validateRephrase,
  fallbackRephrase,
  parseQuestionObj,
  evalCacheKey,
} from "./buildReframedEval.js";

// Synthetic wiki_qa rows. ids sort lexicographically; pad so order is stable.
function row(id, source, title, q, a) {
  return { id, source, title, section: "S", question: q, answer: a };
}

const sampleRows = [
  ...Array.from({ length: 4 }, (_, k) => row(`frlg-wiki-${String(k + 1).padStart(4, "0")}`, "bulbapedia", "Pallet Town", `Pallet question ${k}?`, `Pallet answer ${k}.`)),
  ...Array.from({ length: 4 }, (_, k) => row(`frlg-wiki-${String(k + 5).padStart(4, "0")}`, "bulbapedia", "Route 1", `Route1 question ${k}?`, `Route1 answer ${k}.`)),
  ...Array.from({ length: 12 }, (_, k) => row(`frlg-wiki-${String(k + 9).padStart(4, "0")}`, "strategywiki", "Viridian City", `Viridian question ${k}?`, `Viridian answer ${k}.`)),
];

test("normQ lowercases, strips punctuation (keeps ?), collapses whitespace", () => {
  assert.equal(normQ("How Do I... Start?!"), "how do i start?");
  assert.equal(normQ("  multiple\n  spaces "), "multiple spaces");
  assert.equal(normQ(""), "");
});

test("allocBySource hits exact target totals", () => {
  const counts = { bulbapedia: 8, strategywiki: 12 };
  const { alloc, singleCount, combinedCount } = allocBySource(counts, { target: 20, combinedRatio: 0.2 });
  const s = Object.values(alloc).reduce((a, b) => a + b.single, 0);
  const c = Object.values(alloc).reduce((a, b) => a + b.combined, 0);
  assert.equal(s, singleCount);
  assert.equal(c, combinedCount);
  assert.equal(s + c, 20);
});

test("selectSeeds is deterministic + order-independent", () => {
  const a = selectSeeds(sampleRows, { target: 8, combinedRatio: 0.25 });
  const b = selectSeeds([...sampleRows].reverse(), { target: 8, combinedRatio: 0.25 });
  // after internal id-sort, both produce the same seed_ids.
  const ids = (r) => [...r.singles.map((s) => s.id), ...r.pairs.flat().map((s) => s.id)].sort();
  assert.deepEqual(ids(a), ids(b));
});

test("selectSeeds: singles and pairs use disjoint seed sets", () => {
  const r = selectSeeds(sampleRows, { target: 8, combinedRatio: 0.5 });
  const singleIds = new Set(r.singles.map((s) => s.id));
  for (const [s0, s1] of r.pairs) {
    assert.ok(!singleIds.has(s0.id), `pair seed ${s0.id} also used as single`);
    assert.ok(!singleIds.has(s1.id), `pair seed ${s1.id} also used as single`);
    assert.notEqual(s0.id, s1.id, "paired a row with itself");
  }
});

test("selectSeeds: combined pairs prefer same-title adjacency", () => {
  // 4 contiguous same-title rows per title -> pairs should be same-title.
  const r = selectSeeds(sampleRows, { target: 6, combinedRatio: 0.66 });
  assert.ok(r.pairAdjacency["same-title"] >= 1, "expected at least one same-title pair");
  for (const [s0, s1] of r.pairs) {
    // never pair across sources
    assert.equal(s0.source, s1.source, "cross-source pair detected");
  }
});

test("buildGold: single = seed.answer; combined = space-join of two", () => {
  const s = row("x", "a", "t", "q?", "Alpha.");
  const p = [row("y", "a", "t", "q2?", "Beta."), row("z", "a", "t", "q3?", "Gamma.")];
  assert.equal(buildGold(s), "Alpha.");
  assert.equal(buildGold(p), "Beta. Gamma.");
});

test("validateRephrase rejects identical/short, accepts meaningful", () => {
  const o = "How do I start the game after the cutscene?";
  assert.equal(validateRephrase(o, o).ok, false);
  assert.equal(validateRephrase(o, "How do I start the game after the cutscene?").reason, "identical");
  assert.equal(validateRephrase(o, "Hi?").ok, false);
  // long enough but fewer than 4 words
  assert.equal(validateRephrase(o, "supercalifragilistic").reason, "too-few-words");
  assert.ok(validateRephrase(o, "After the intro cutscene ends, what button begins the game?").ok);
});

test("fallbackRephrase is deterministic and mentions the title", () => {
  const s = row("x", "a", "Pallet Town", "How do I start?", "Press A.");
  const f = fallbackRephrase(s);
  assert.ok(f.includes("Pallet Town"));
  assert.ok(f.includes("how do I start?"));
});

test("parseQuestionObj: fenced/wrapped/empty/missing-field", () => {
  assert.equal(parseQuestionObj('{"question":"After X, what next?"}'), "After X, what next?");
  assert.equal(parseQuestionObj('```json\n{"question":"Q?"}\n```'), "Q?");
  assert.equal(parseQuestionObj('Sure! {"question":"Q?"} hope that helps'), "Q?");
  assert.equal(parseQuestionObj('{"answer":"no question"}'), null);
  assert.equal(parseQuestionObj(""), null);
  assert.equal(parseQuestionObj("not json at all"), null);
});

test("evalCacheKey is stable per inputs, changes on any field change", () => {
  const a = evalCacheKey("single", "gemma-4-31b", "abc123", "Q1?");
  const b = evalCacheKey("single", "gemma-4-31b", "abc123", "Q1?");
  const c = evalCacheKey("combined", "gemma-4-31b", "abc123", ["Q1?", "Q2?"]);
  assert.equal(a, b);
  assert.notEqual(a, c);
});
