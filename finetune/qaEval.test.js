// Offline pure-function self-test for the qaEval scoring helpers.
//   node --test finetune/qaEval.test.js
import test from "node:test";
import assert from "node:assert/strict";
import {
  normalize,
  tokenize,
  jaccard,
  fuzzyScore,
  parseJudgeJson,
  buildJudgeMessages,
} from "./qaEval.js";

test("normalize lowercases, strips punctuation, collapses whitespace", () => {
  assert.equal(normalize("Press the A Button, or Start!"), "press the a button or start");
  assert.equal(normalize("  Multiple\n  spaces\tand\nnewlines  "), "multiple spaces and newlines");
  // curly quotes normalized to straight, then straight double-quotes stripped
  // (only a-z0-9' and whitespace survive); apostrophes are kept.
  assert.equal(normalize("“Curly ‘quotes’”"), "curly 'quotes'");
  assert.equal(normalize(""), "");
  assert.equal(normalize(null), "");
});

test("tokenize splits normalized text on spaces", () => {
  assert.deepEqual(tokenize("Hello, World!"), ["hello", "world"]);
  assert.deepEqual(tokenize(""), []);
});

test("jaccard: identical -> 1, disjoint -> 0, partial in (0,1)", () => {
  assert.equal(jaccard("press a button", "press a button"), 1);
  assert.equal(jaccard("alpha", "zulu"), 0);
  assert.ok(jaccard("press the a button", "press a button") > 0.5);
  assert.ok(jaccard("press the a button", "press a button") < 1);
  // both empty -> 1 by convention
  assert.equal(jaccard("", ""), 1);
});

test("fuzzyScore: paraphrase beats disjoint; gold_substring tracks containment", () => {
  const gold = "Press the A Button or Start on the title screen after the brief cutscene.";
  const good = "Hit A or Start at the title screen once the cutscene ends.";
  const bad = "You must defeat the Elite Four first.";
  assert.ok(fuzzyScore(good, gold).jaccard > fuzzyScore(bad, gold).jaccard);
  assert.equal(fuzzyScore(gold, gold).gold_substring, true);
  assert.equal(fuzzyScore("nope", gold).gold_substring, false);
  // empty gold -> no substring claim
  assert.equal(fuzzyScore("anything", "").gold_substring, false);
});

test("parseJudgeJson: extracts {correct,reason} from fenced / wrapped output", () => {
  assert.deepEqual(parseJudgeJson('{"correct": true, "reason": "yes"}'), {
    correct: true,
    reason: "yes",
  });
  assert.deepEqual(
    parseJudgeJson('```json\n{"correct": false, "reason": "no"}\n```'),
    { correct: false, reason: "no" },
  );
  assert.deepEqual(
    parseJudgeJson('Sure! {"correct": true, "reason": "paraphrase"} hope that helps'),
    { correct: true, reason: "paraphrase" },
  );
  assert.equal(parseJudgeJson("not json at all"), null);
  assert.equal(parseJudgeJson('{"reason": "no bool"}'), null); // missing correct bool
  assert.equal(parseJudgeJson(""), null);
});

test("buildJudgeMessages: system + user with the three fields", () => {
  const m = buildJudgeMessages("Q?", "Gold", "Pred");
  assert.equal(m.length, 2);
  assert.equal(m[0].role, "system");
  assert.equal(m[1].role, "user");
  assert.ok(m[1].content.includes("Q?"));
  assert.ok(m[1].content.includes("Gold"));
  assert.ok(m[1].content.includes("Pred"));
});
