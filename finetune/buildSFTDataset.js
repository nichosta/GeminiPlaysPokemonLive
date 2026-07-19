// E4-SFT: build the freesolo SFT dataset + held-out eval split from E1's wiki QA pairs.
//
// SUPERSEDED for the freesolo lane by finetune/buildReframedEval.js, which trains
// on ALL wiki_qa pairs (no holdout) and evaluates on a reframed eval set. This
// file remains for the 80/20 held-out benchmark (its eval.jsonl is still valid
// for comparing to the old before/after numbers). Note: buildReframedEval.js also
// writes dataset/train.jsonl (the 558-row full set); do NOT re-run this script
// without re-running buildReframedEval.js afterward, or train.jsonl will revert
// to the 446-row split.
//
// Input : staticdata/frlg/wiki_qa.jsonl  ({source,title,section,question,answer,id}; 558 rows)
// Output: dataset/train.jsonl  -> freesolo SFT rows {"input": question, "output": answer}
//         dataset/eval.jsonl   -> held-out eval rows {id,source,title,section,question,answer}
//         dataset/eval_index.json -> split manifest (counts, ratio, by-source)
//
// Split is deterministic + stratified by source: within each source, rows are
// sorted by id and every Nth (index % STRIDE === 0) goes to eval. No overlap.
// Re-runs are bit-identical for the same input (no Math.random).
//
//   node finetune/buildSFTDataset.js [--eval-ratio 0.20]
//
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
const SRC = path.join(REPO, "staticdata/frlg/wiki_qa.jsonl");
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

function split(rows) {
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

function main() {
  if (!fs.existsSync(SRC)) {
    console.error(`Source not found: ${SRC}\nRun E1 (staticdata/extractWikiQA.js) first.`);
    process.exit(1);
  }
  const rows = readJsonl(SRC);
  const { train, evalRows } = split(rows);

  fs.mkdirSync(path.dirname(OUT_TRAIN), { recursive: true });
  fs.writeFileSync(
    OUT_TRAIN,
    train.map((r) => JSON.stringify({ input: r.question, output: r.answer })).join("\n") + "\n",
  );
  fs.writeFileSync(
    OUT_EVAL,
    evalRows
      .map((r) =>
        JSON.stringify({
          id: r.id,
          source: r.source,
          title: r.title,
          section: r.section,
          question: r.question,
          answer: r.answer,
        }),
      )
      .join("\n") + "\n",
  );
  fs.writeFileSync(
    OUT_MANIFEST,
    JSON.stringify(
      {
        note: "Held-out QA eval split (never trained on). Deterministic stratified-by-source: every Nth row by id within source -> eval.",
        source: "staticdata/frlg/wiki_qa.jsonl",
        sourceManifest: "../staticdata/frlg/wiki_qa_index.json",
        evalRatio: RATIO,
        stride: STRIDE,
        total: rows.length,
        train: train.length,
        eval: evalRows.length,
        trainBySource: bySrcCount(train),
        evalBySource: bySrcCount(evalRows),
      },
      null,
      2,
    ) + "\n",
  );

  console.log(
    `train=${train.length} eval=${evalRows.length} (of ${rows.length}) -> ${OUT_TRAIN}, ${OUT_EVAL}`,
  );
}

main();
