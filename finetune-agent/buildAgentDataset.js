// E3-eval: build the held-out (state, tool_call) eval split + the complementary
// SFT train split from E3's agent_traces.jsonl (423 rows: press 339,
// set_battle_strategy 37, goto 36, heal 8, fight_battle 3 — see
// staticdata/frlg/agent_traces_index.json).
//
// Mirrors finetune-state-intent/buildStateIntentEval.js exactly: stratified by
// `source` (here, the live run_id a row came from, so eval rows are held out at
// the RUN level as well as spread across runs), rows sorted by `id` within each
// source, every Nth (index % STRIDE === 0) -> eval. Deterministic + bit-identical
// re-runs (no Math.random).
//
//   Input : staticdata/frlg/agent_traces.jsonl  ({id,source,turn,model,
//            tool_interface_version,state,tool_call,commentary,is_escape_hatch,
//            outcome_status,steps_used}; 423 rows)
//   Output: dataset/eval.jsonl   -> held-out eval rows
//            {id,source,state,tool_call,commentary}  (~20%)
//           dataset/train.jsonl  -> freesolo SFT rows
//            {"input": state, "output": "<tool_call+commentary JSON>"}  (~80%)
//           dataset/eval_index.json -> split manifest
//
// Contamination rule: the eval is held out ONLY IF the SFT trains on
// train.jsonl (the complementary ~80%), NOT on all 423. The manifest records
// this, mirroring buildStateIntentEval.js's note.
//
// UNLIKE E1/E2, this dataset is genuine behavior distillation of gemini's own
// live play (see staticdata/extractAgentTraces.js's header) — not a teacher-
// generated grounded label.
//
//   node finetune-agent/buildAgentDataset.js [--eval-ratio 0.20]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
const SRC = path.join(REPO, "staticdata/frlg/agent_traces.jsonl");
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

// Stratified-by-source split: within each source (live run_id), sort by id,
// every Nth -> eval. Exported for the self-test. Returns {train, evalRows}.
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
    const t = r.tool_call?.name ?? "?";
    m[t] = (m[t] || 0) + 1;
    return m;
  }, {});

function main() {
  if (!fs.existsSync(SRC)) {
    console.error(
      `Source not found: ${SRC}\n` +
        `Run E3 (staticdata/extractAgentTraces.js) first to generate agent_traces.jsonl.`,
    );
    process.exit(1);
  }
  const rows = readJsonl(SRC);
  const { train, evalRows } = split(rows);

  fs.mkdirSync(path.dirname(OUT_TRAIN), { recursive: true });
  // SFT rows: input = the live state prompt gemini read, output = the
  // {tool_call, commentary} JSON it actually emitted (so train/inference
  // framing match the eval, which parses this same shape).
  fs.writeFileSync(
    OUT_TRAIN,
    train
      .map((r) =>
        JSON.stringify({
          input: r.state,
          output: JSON.stringify({ tool_call: r.tool_call, commentary: r.commentary }),
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
          tool_call: r.tool_call,
          commentary: r.commentary,
        }),
      )
      .join("\n") + "\n",
  );
  fs.writeFileSync(
    OUT_MANIFEST,
    JSON.stringify(
      {
        note:
          "Held-out (state, tool_call) eval split. state = the exact D2 buildStatePrompt() text a LIVE " +
          "gemini-3.5-flash run read; tool_call = the tool call it actually issued (real behavior, not a " +
          "teacher-generated grounded label — see staticdata/extractAgentTraces.js). Contamination rule: " +
          "the eval is held out ONLY IF the SFT trains on train.jsonl (the complementary ~80%), NOT on all " +
          "rows. Deterministic stratified-by-source (live run_id): every Nth row by id within source -> eval. " +
          "NOTE: 'press' (escape hatch) dominates the raw distribution (~80%) because manual battle/dialog " +
          "mashing generates many turns per LLM call vs one macro call for goto/heal/fight_battle — this is " +
          "the corpus's honest composition (outcome.status==='ok' only, no rebalancing), not a target ratio; " +
          "address via curriculum/reward if it skews the trained model toward over-using press.",
        source: "staticdata/frlg/agent_traces.jsonl",
        sourceManifest: "../staticdata/frlg/agent_traces_index.json",
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
