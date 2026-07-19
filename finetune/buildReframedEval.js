// E4-SFT (reframed lane): full-train dataset + reframed eval set.
//
// Replaces the old 80/20 held-out paradigm (buildSFTDataset.js). The held-out
// questions are independent facts, so training on 80% can't improve the unseen
// 20% — the before/after delta under-measures learned knowledge. This lane
// instead:
//   1. Trains on ALL wiki_qa pairs (no holdout) -> dataset/train.jsonl.
//   2. Builds a ~n*0.1 (56) eval set whose questions are LLM-reframed from
//      seed TRAINING questions (~80% rephrased singles + ~20% combined pairs),
//      so the eval tests whether the model LEARNED the facts, not whether it
//      memorized the exact training strings.
//
// GROUNDING INVARIANT (matches [[sft-data-is-grounded-not-distilled]]): the
// Cerebras teacher ONLY rewrites/combines QUESTIONS. It never produces answer
// text. Single gold = the seed's original answer verbatim; combined gold =
// the literal concatenation of the two seeds' answers. Zero fabrication.
//
// Mirrors staticdata/extractWikiQA.js: Cerebras OpenAI client, bounded-
// concurrency runPool, sha1-keyed .cache.json for idempotent re-runs, and a
// tracked manifest with prompt hashes + failure counts.
//
//   node finetune/buildReframedEval.js --dry-run      # skeleton, no API cost
//   node finetune/buildReframedEval.js --limit 4      # tiny API smoke
//   node finetune/buildReframedEval.js                # full run (~56 Cerebras calls)
//
// Inputs : staticdata/frlg/wiki_qa.jsonl  ({source,title,section,question,answer,id})
// Outputs: dataset/train.jsonl             -> all 558 rows {input:question, output:answer}
//          dataset/eval_reframed.jsonl     -> ~56 reframed eval rows (schema below)
//          dataset/eval_reframed_index.json-> tracked manifest
//          dataset/.eval_reframed_cache.json -> git-ignored sha1 cache
// =============================================================================

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import OpenAI from "openai";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
const SRC = path.join(REPO, "staticdata/frlg/wiki_qa.jsonl");
const OUT_DIR = path.join(__dirname, "dataset");
const OUT_TRAIN = path.join(OUT_DIR, "train.jsonl");
const OUT_EVAL = path.join(OUT_DIR, "eval_reframed.jsonl");
const OUT_MANIFEST = path.join(OUT_DIR, "eval_reframed_index.json");
const CACHE_PATH = path.join(OUT_DIR, ".eval_reframed_cache.json");

// --- CLI ---------------------------------------------------------------------

function parseArgs(argv) {
  const a = { limit: 0, model: null, concurrency: 2, dryRun: false, out: null };
  for (let i = 2; i < argv.length; i++) {
    const t = argv[i];
    if (t === "--limit") a.limit = parseInt(argv[++i], 10);
    else if (t === "--model") a.model = argv[++i];
    else if (t === "--concurrency") a.concurrency = parseInt(argv[++i], 10);
    else if (t === "--dry-run") a.dryRun = true;
    else if (t === "--out") a.out = argv[++i];
  }
  return a;
}

const MODEL = (parseArgs(process.argv).model) || process.env.CEREBRAS_MODEL_NAME || "gemma-4-31b";

// --- Teacher prompts (questions only; never answers) -------------------------

const REPHRASE_PROMPT = `You rephrase a Pokémon FireRed/LeafGreen gameplay question into different wording that asks for the SAME fact.

STRICT RULES:
- Output ONLY the rephrased question. Do NOT answer it. Do NOT add an answer, explanation, preamble, or any text other than the question.
- Preserve the exact factual scope of the original. Do NOT introduce facts, names, locations, or steps the original did not imply.
- Do NOT make the question easier or harder — keep the same difficulty and the same expected answer.
- Change wording, sentence structure, and perspective (e.g. "Where do I..." -> "After X, what's the next..."), but keep every named entity the original used.
- Do NOT copy the original question. If you cannot meaningfully rephrase, output the original verbatim.

Return ONLY a JSON object, no prose, no code fences: {"question":"<rephrased question>"}`;

const COMBINE_PROMPT = `You combine TWO Pokémon FireRed/LeafGreen gameplay questions into ONE new question that asks for BOTH facts.

STRICT RULES:
- Output ONLY the combined question. Do NOT answer it. Do NOT add answers, explanations, preambles, or any text other than the question.
- The combined question must require answering BOTH seed facts. Phrase it so a complete answer must cover both (e.g. "What are the X and the Y...", "After doing A, what comes next and what do I need for it?").
- Use ONLY the named entities (Pokémon, items, NPCs, locations, buttons) that appear in the two seed questions. Do NOT invent or import any new fact, name, or location.
- Keep it a single natural-language question; do NOT just concatenate the two questions with "and".

Return ONLY a JSON object, no prose, no code fences: {"question":"<combined question>"}`;

const REPHRASE_HASH = crypto.createHash("sha1").update(REPHRASE_PROMPT).digest("hex").slice(0, 16);
const COMBINE_HASH = crypto.createHash("sha1").update(COMBINE_PROMPT).digest("hex").slice(0, 16);

// --- Pure helpers (exported for tests) ---------------------------------------

function readJsonl(p) {
  return fs
    .readFileSync(p, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

// Normalize a question for equivalence checks (lowercase, collapse ws, strip
// punctuation). Same approach as extractWikiQA.js's normQ.
export function normQ(q) {
  return String(q ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^a-z0-9 ?'-]/g, "")
    .trim();
}

// Allocate per-source single/combined counts proportionally, with remainder
// pushed to the largest source so the totals hit `target`/`combinedCount` exactly.
export function allocBySource(sourceCounts, { target, combinedRatio }) {
  const combinedCount = Math.round(target * combinedRatio);
  const singleCount = target - combinedCount;
  const total = Object.values(sourceCounts).reduce((a, b) => a + b, 0) || 1;
  const sources = Object.keys(sourceCounts).sort();
  const alloc = {};
  let sSum = 0, cSum = 0;
  for (const src of sources) {
    const cnt = sourceCounts[src];
    const s = Math.round((singleCount * cnt) / total);
    const c = Math.round((combinedCount * cnt) / total);
    alloc[src] = { single: s, combined: c };
    sSum += s;
    cSum += c;
  }
  // Fix up to exact totals on the largest source.
  const largest = sources.reduce((a, b) => (sourceCounts[b] > sourceCounts[a] ? b : a), sources[0]);
  alloc[largest].single += singleCount - sSum;
  alloc[largest].combined += combinedCount - cSum;
  return { alloc, singleCount, combinedCount };
}

// Deterministic seed selection. Singles stride across each source's id-sorted
// list; combined-pair anchors use a different offset so no row is both a single
// and a pair member. Pair partners share the seed's title (fallback: adjacent id).
// Returns { singles: [seed], pairs: [[s0,s1], ...], pairAdjacency: {counts} }.
export function selectSeeds(rows, { target = 56, combinedRatio = 0.2 } = {}) {
  const bySrc = {};
  for (const r of rows) (bySrc[r.source] ??= []).push(r);
  for (const src of Object.keys(bySrc)) bySrc[src].sort((a, b) => a.id.localeCompare(b.id));

  const sourceCounts = Object.fromEntries(Object.entries(bySrc).map(([k, v]) => [k, v.length]));
  const { alloc, singleCount, combinedCount } = allocBySource(sourceCounts, { target, combinedRatio });

  const used = new Set(); // ids already consumed (single or pair member)
  const singles = [];
  const pairs = [];
  const pairAdjacency = { "same-title": 0, "adjacent-id": 0 };

  for (const src of Object.keys(bySrc).sort()) {
    const g = bySrc[src];
    const wantSingle = alloc[src].single;
    const wantCombined = alloc[src].combined;

    // Singles: stride across the source list.
    const singleStride = Math.max(1, Math.floor(g.length / Math.max(1, wantSingle)));
    let pickedSingle = 0;
    for (let i = 0; i < g.length && pickedSingle < wantSingle; i++) {
      if (i % singleStride !== 0) continue;
      if (used.has(g[i].id)) continue;
      singles.push(g[i]);
      used.add(g[i].id);
      pickedSingle++;
    }

    // Combined-pair anchors: offset 1 within the same stride, so they don't
    // collide with single indices (modulo the stride).
    const pairStride = Math.max(1, Math.floor(g.length / Math.max(1, wantCombined)));
    let pickedCombined = 0;
    for (let i = 0; i < g.length && pickedCombined < wantCombined; i++) {
      if (i % pairStride !== 1) continue;
      const anchor = g[i];
      if (used.has(anchor.id)) continue;
      // Partner: next unused row in this source with the same title.
      let partner = null;
      let kind = "adjacent-id";
      for (let j = i + 1; j < g.length; j++) {
        if (used.has(g[j].id)) continue;
        if (g[j].title === anchor.title) { partner = g[j]; kind = "same-title"; break; }
      }
      if (!partner) {
        // Fallback: next unused adjacent-id row (still thematically close).
        for (let j = i + 1; j < g.length; j++) {
          if (used.has(g[j].id)) continue;
          partner = g[j]; kind = "adjacent-id"; break;
        }
      }
      if (!partner) continue; // not enough unused rows left in source
      pairs.push([anchor, partner]);
      used.add(anchor.id);
      used.add(partner.id);
      pairAdjacency[kind]++;
      pickedCombined++;
    }
  }

  return { singles, pairs, pairAdjacency, singleCount, combinedCount, target };
}

// Gold construction — grounded, no LLM in the loop.
export function buildGold(seed) {
  return Array.isArray(seed) ? seed.map((s) => s.answer).join(" ") : seed.answer;
}

// Rephrase guard. Returns {ok, reason}. A rephrase must be meaningfully
// different from the original (not normQ-identical) and not degenerate.
export function validateRephrase(original, rephrase) {
  const nO = normQ(original);
  const nR = normQ(rephrase);
  if (!nR) return { ok: false, reason: "empty" };
  if (nR === nO) return { ok: false, reason: "identical" };
  if (nR.length < 12) return { ok: false, reason: "too-short" };
  if (nR.split(" ").length < 4) return { ok: false, reason: "too-few-words" };
  return { ok: true, reason: "ok" };
}

// Template fallback so the eval row still exists even if the teacher fails to
// produce a usable rephrase. Deterministic, no API.
export function fallbackRephrase(seed) {
  const q = seed.question.charAt(0).toLowerCase() + seed.question.slice(1);
  return `Regarding ${seed.title}, ${q}`;
}

// Parse {"question":"..."} from a teacher response. Brace-counted, fence-stripped,
// mirrors extractWikiQA.js's parsePairs but for the single-field shape.
export function parseQuestionObj(content) {
  if (!content) return null;
  let s = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const start = s.indexOf("{");
  if (start < 0) return null;
  let depth = 0, end = -1;
  for (let i = start; i < s.length; i++) {
    if (s[i] === "{") depth++;
    else if (s[i] === "}") {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  if (end < 0) return null;
  try {
    const obj = JSON.parse(s.slice(start, end + 1));
    if (typeof obj?.question !== "string") return null;
    const q = obj.question.trim();
    return q || null;
  } catch {
    return null;
  }
}

export function evalCacheKey(kind, model, promptHash, seedQuestions) {
  const payload = Array.isArray(seedQuestions) ? seedQuestions.join("\n␟\n") : String(seedQuestions);
  return crypto.createHash("sha1").update(`${model}\n${promptHash}\n${kind}\n${payload}`).digest("hex");
}

// --- HTTP / cache (mirror extractWikiQA) -------------------------------------

function makeClient() {
  const apiKey = process.env.CEREBRAS_API_KEY;
  if (!apiKey) {
    console.error("Error: CEREBRAS_API_KEY not set. (Set it in .env, or pass --dry-run.)");
    process.exit(1);
  }
  return new OpenAI({ apiKey, baseURL: "https://api.cerebras.ai/v1" });
}

async function chatOnce(client, systemPrompt, userText) {
  const result = await client.chat.completions.create({
    model: MODEL,
    temperature: 0,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userText },
    ],
  });
  return result.choices?.[0]?.message?.content ?? "";
}

async function runPool(items, concurrency, fn, onProgress) {
  const results = new Array(items.length);
  let next = 0, done = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      try {
        results[i] = await fn(items[i], i);
      } catch (e) {
        results[i] = { __error: e?.message || String(e) };
      }
      done++;
      onProgress?.(done, items.length);
    }
  }
  const n = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}

function loadCache(p) {
  if (!fs.existsSync(p)) return {};
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return {}; }
}
function saveCache(p, c) { fs.writeFileSync(p, JSON.stringify(c, null, 2)); }

// --- Generation: one rephrase (with retry+fallback) and one combine -----------

async function genRephrase(client, seed) {
  const userText = `Original question: ${seed.question}`;
  const raw = await chatOnce(client, REPHRASE_PROMPT, userText);
  let q = parseQuestionObj(raw);
  let method = "first-try";
  if (q && validateRephrase(seed.question, q).ok) return { question: q, method };
  // Retry once with a nudge.
  const raw2 = await chatOnce(
    client,
    REPHRASE_PROMPT,
    `${userText}\n\nThat was too close to the original or too short. Produce a meaningfully different wording of the same question, still asking for the same fact.`,
  );
  q = parseQuestionObj(raw2);
  if (q && validateRephrase(seed.question, q).ok) return { question: q, method: "retry" };
  return { question: fallbackRephrase(seed), method: "fallback" };
}

async function genCombine(client, pair) {
  const userText = `Question 1: ${pair[0].question}\nQuestion 2: ${pair[1].question}`;
  const raw = await chatOnce(client, COMBINE_PROMPT, userText);
  const q = parseQuestionObj(raw);
  if (q && q.length >= 8) return { question: q, method: "first-try" };
  // Retry once.
  const raw2 = await chatOnce(client, COMBINE_PROMPT, `${userText}\n\nCombine them into one question that requires answering both facts.`);
  const q2 = parseQuestionObj(raw2);
  if (q2 && q2.length >= 8) return { question: q2, method: "retry" };
  // Fallback: a deterministic "and"-join (still asks both, no new facts).
  return { question: `${pair[0].question} Also: ${pair[1].question}`, method: "fallback" };
}

// --- Main --------------------------------------------------------------------

function rowFor(kind, idx, seed, question) {
  const seeds = Array.isArray(seed) ? seed : [seed];
  return {
    id: `frlg-eval-ref-${String(idx).padStart(4, "0")}`,
    kind,
    source: seeds[0].source,
    title: Array.isArray(seed) ? `${seeds[0].title} + ${seeds[1].title}` : seed.title,
    section: Array.isArray(seed) ? "combined" : seed.section,
    seed_ids: seeds.map((s) => s.id),
    original_questions: seeds.map((s) => s.question),
    question,
    answer: buildGold(seed),
  };
}

async function main() {
  const cli = parseArgs(process.argv);
  const model = cli.model || MODEL;
  console.log("=== E4 reframed-eval generator (full-train + reframed eval) ===");
  if (!fs.existsSync(SRC)) {
    console.error(`Source not found: ${SRC}\nRun E1 (staticdata/extractWikiQA.js) first.`);
    process.exit(1);
  }
  const rows = readJsonl(SRC);
  console.log(`source: ${rows.length} wiki_qa rows`);

  // 1. Full-train dataset (all rows).
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(
    OUT_TRAIN,
    rows.map((r) => JSON.stringify({ input: r.question, output: r.answer })).join("\n") + "\n",
  );
  console.log(`wrote ${path.relative(REPO, OUT_TRAIN)} (${rows.length} rows, full set)`);

  // 2. Seed selection. --limit N shrinks the eval target to N (smoke); default 56.
  const target = cli.limit > 0 ? cli.limit : 56;
  const { singles, pairs, pairAdjacency, singleCount, combinedCount } = selectSeeds(rows, {
    target,
    combinedRatio: 0.2,
  });
  console.log(`seeds: ${singles.length} singles + ${pairs.length} combined (target ${target})`);
  console.log(`  pair adjacency: same-title=${pairAdjacency["same-title"]} adjacent-id=${pairAdjacency["adjacent-id"]}`);

  // 3. Generate reframed questions (cached, idempotent).
  const cache = cli.dryRun ? {} : loadCache(CACHE_PATH);
  const rephraseMethod = { "first-try": 0, retry: 0, fallback: 0 };
  const failures = [];
  let asked = 0, fromCache = 0;

  const tasks = [
    ...singles.map((seed) => ({ kind: "single", seed })),
    ...pairs.map((pair) => ({ kind: "combined", seed: pair })),
  ];

  const client = cli.dryRun ? null : makeClient();

  const results = cli.dryRun
    ? tasks.map((t) => ({
        question: t.kind === "single" ? fallbackRephrase(t.seed) : `${t.seed[0].question} Also: ${t.seed[1].question}`,
        method: "dry-run",
      }))
    : await runPool(tasks, cli.concurrency, async (t) => {
        const ph = t.kind === "single" ? REPHRASE_HASH : COMBINE_HASH;
        const seedQs = t.kind === "single" ? t.seed.question : [t.seed[0].question, t.seed[1].question];
        const key = evalCacheKey(t.kind, model, ph, seedQs);
        if (cache[key]) { fromCache++; return cache[key]; }
        asked++;
        try {
          const r = t.kind === "single" ? await genRephrase(client, t.seed) : await genCombine(client, t.seed);
          cache[key] = r;
          return r;
        } catch (e) {
          failures.push({ kind: t.kind, seed: Array.isArray(t.seed) ? t.seed.map((s) => s.id) : t.seed.id, error: String(e?.message || e) });
          // Fallback so the row still exists.
          return t.kind === "single"
            ? { question: fallbackRephrase(t.seed), method: "fallback" }
            : { question: `${t.seed[0].question} Also: ${t.seed[1].question}`, method: "fallback" };
        }
      });

  if (!cli.dryRun) {
    saveCache(CACHE_PATH, cache);
    for (const r of results) if (r?.method) rephraseMethod[r.method] = (rephraseMethod[r.method] || 0) + 1;
  }

  // 4. Eval rows.
  let idx = 1;
  const evalRows = [];
  for (let i = 0; i < singles.length; i++) {
    evalRows.push(rowFor("single", idx++, singles[i], results[i]?.question || fallbackRephrase(singles[i])));
  }
  for (let j = 0; j < pairs.length; j++) {
    const r = results[singles.length + j];
    evalRows.push(rowFor("combined", idx++, pairs[j], r?.question || `${pairs[j][0].question} Also: ${pairs[j][1].question}`));
  }
  fs.writeFileSync(OUT_EVAL, evalRows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  console.log(`wrote ${path.relative(REPO, OUT_EVAL)} (${evalRows.length} rows)`);

  // 5. Manifest.
  const bySource = evalRows.reduce((m, r) => ((m[r.source] = (m[r.source] || 0) + 1), m), {});
  const byKind = evalRows.reduce((m, r) => ((m[r.kind] = (m[r.kind] || 0) + 1), m), {});
  const manifest = {
    note: "Reframed eval set. Seeds are TRAINED-ON rows; questions are LLM-reframed (singles) or combined (pairs) so the eval tests learned knowledge, not memorized strings. Gold answers are NEVER LLM-produced: single gold = seed.answer; combined gold = concatenation of two seed answers. Trains-on-all + evals-on-reframed.",
    grounding: "STRICT — teacher rewrites/combines QUESTIONS only; answers are copied/concatenated from seeds, never generated.",
    model,
    temperature: 0,
    rephrasePromptHash: REPHRASE_HASH,
    combinePromptHash: COMBINE_HASH,
    source: "staticdata/frlg/wiki_qa.jsonl",
    sourceManifest: "../staticdata/frlg/wiki_qa_index.json",
    evalTarget: target,
    combinedRatio: 0.2,
    singleCount,
    combinedCount,
    strideSelection: "deterministic stride by id within source; combined pairs share title (fallback: adjacent id); singles and pairs use disjoint seed sets",
    pairAdjacency,
    bySource,
    byKind,
    rephraseMethod: cli.dryRun ? { "dry-run": evalRows.length } : rephraseMethod,
    asked,
    fromCache,
    failures,
    outputs: {
      train: path.relative(REPO, OUT_TRAIN),
      eval: path.relative(REPO, OUT_EVAL),
      cache: path.relative(REPO, CACHE_PATH),
    },
  };
  fs.writeFileSync(OUT_MANIFEST, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`wrote ${path.relative(REPO, OUT_MANIFEST)}`);
  if (!cli.dryRun) console.log(`Cache: ${fromCache} hits, ${asked} asked, ${failures.length} failures`);
}

// CLI guard so tests can import without triggering main().
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((e) => {
    console.error(e?.stack || e);
    process.exit(1);
  });
}
