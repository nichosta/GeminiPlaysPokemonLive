// E2-eval: build the held-out (state, intent) eval split + the complementary
// SFT train split from E2's state_intent.jsonl (981 rows: set_battle_strategy
// 480, press 310, goto 151, heal 23, use_item 17).
//
// Mirrors finetune/buildSFTDataset.js's split exactly: stratified by `source`,
// rows sorted by `id` within each source, every Nth (index % STRIDE === 0) ->
// eval. Deterministic + bit-identical re-runs (no Math.random).
//
//   Input : staticdata/frlg/state_intent.jsonl  ({id,source,windowIndex,
//            windowStart,windowEnd,state,intent,rationale}; 981 rows)
//   Output: dataset/eval.jsonl   -> held-out eval rows
//            {id,source,state,intent,rationale}  (~196 @ 20%)
//           dataset/train.jsonl  -> freesolo SFT rows
//            {"input": state, "output": "<intent+rationale JSON>"}  (~785)
//           dataset/eval_index.json -> split manifest
//
// Contamination rule: the eval is held out ONLY IF the intent SFT trains on
// train.jsonl (the complementary ~80%), NOT on all 981. The manifest
// records this; mirror buildSFTDataset.js's note.
//
//   node finetune-state-intent/buildStateIntentEval.js [--eval-ratio 0.20]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
const SRC = path.join(REPO, "staticdata/frlg/state_intent.jsonl");
const OUT_TRAIN = path.join(__dirname, "dataset/train.jsonl");
const OUT_EVAL = path.join(__dirname, "dataset/eval.jsonl");
const OUT_MANIFEST = path.join(__dirname, "dataset/eval_index.json");

const args = process.argv.slice(2).reduce((acc, a, i, arr) => {
  if (a.startsWith("--")) acc[a.slice(2)] = arr[i + 1];
  return acc;
}, {});
const RATIO = parseFloat(args["eval-ratio"] ?? process.env.EVAL_RATIO ?? "0.20");
const STRIDE = Math.max(1, Math.round(1 / RATIO)); // 0.20 -> 5

function readJsonl(p) {
  return fs
    .readFileSync(p, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

// Stratified-by-source split: within each source, sort by id, every Nth -> eval.
// Exported for the self-test. Returns {train, evalRows}.
export function split(rows) {
  const bySrc = {};
  for (const r of rows) (bySrc[r.source] ??= []).push(r);
  const train = [];
  const evalRows = [];
  for (const src of Object.keys(bySrc).sort()) {
    const g = bySrc[src].sort((a, b) => a.id.localeCompare(b.id));
    g.forEach((r, i) => (i % STRIDE === 0 ? evalRows : train).push(r));
  }
  return { train, evalRows };
}

const bySrcCount = (arr) =>
  arr.reduce((m, r) => ((m[r.source] = (m[r.source] || 0) + 1), m), {});

const byToolCount = (arr) =>
  arr.reduce((m, r) => {
    const t = r.intent?.name ?? "?";
    m[t] = (m[t] || 0) + 1;
    return m;
  }, {});

function main() {
  if (!fs.existsSync(SRC)) {
    console.error(
      `Source not found: ${SRC}\n` +
        `Run E2 (staticdata/extractStateIntent.js) first to generate state_intent.jsonl.`,
    );
    process.exit(1);
  }
  const rows = readJsonl(SRC);
  const { train, evalRows } = split(rows);

  fs.mkdirSync(path.dirname(OUT_TRAIN), { recursive: true });
  // SFT rows: input = the state window text, output = the {intent, rationale}
  // JSON the teacher emitted (so train/inference framing match the eval, which
  // parses this same shape).
  fs.writeFileSync(
    OUT_TRAIN,
    train
      .map((r) =>
        JSON.stringify({
          input: r.state,
          output: JSON.stringify({ intent: r.intent, rationale: r.rationale }),
        }),
      )
      .join("\n") + "\n",
  );
  fs.writeFileSync(
    OUT_EVAL,
    evalRows
      .map((r) =>
        JSON.stringify({
          id: r.id,
          source: r.source,
          state: r.state,
          intent: r.intent,
          rationale: r.rationale,
        }),
      )
      .join("\n") + "\n",
  );
  fs.writeFileSync(
    OUT_MANIFEST,
    JSON.stringify(
      {
        note:
          "Held-out (state,intent) eval split. state = A5 transcript window; intent = teacher-" +
          "generated D1 tool call (grounded, not distilled). Contamination rule: the eval is " +
          "held out ONLY IF the intent SFT trains on train.jsonl (the complementary ~80%), " +
          "NOT on all 981. Deterministic stratified-by-source: every Nth row by id within source -> eval.",
        source: "staticdata/frlg/state_intent.jsonl",
        sourceManifest: "../staticdata/frlg/state_intent_index.json",
        evalRatio: RATIO,
        stride: STRIDE,
        total: rows.length,
        train: train.length,
        eval: evalRows.length,
        evalBySource: bySrcCount(evalRows),
        trainBySource: bySrcCount(train),
        evalByTool: byToolCount(evalRows),
        trainByTool: byToolCount(train),
      },
      null,
      2,
    ) + "\n",
  );

  console.log(
    `train=${train.length} eval=${evalRows.length} (of ${rows.length}) -> ${path.relative(REPO, OUT_TRAIN)}, ${path.relative(REPO, OUT_EVAL)}`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
