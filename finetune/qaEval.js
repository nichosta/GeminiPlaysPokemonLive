// E4-SFT: before/after QA-knowledge eval harness.
//
// Loads an eval split (default finetune/dataset/eval.jsonl — the 80/20 held-out
// split; the reframed full-train lane uses --eval finetune/dataset/eval_reframed.jsonl),
// asks each question to any OpenAI-compatible chat endpoint (OpenRouter base Qwen
// for "before", the deployed freesolo LoRA for "after"), and scores each answer
// two ways:
//   - fuzzy : normalized token-overlap (Jaccard) + gold-substring flag
//   - judge : Cerebras gemma-4-31b (temp 0) binary correct/incorrect
// Writes eval/qa-eval-<label>-<ts>.json.  `compare` prints a before/after delta.
//
//   node finetune/qaEval.js run --endpoint URL --model M --key-env KEY --label before
//   node finetune/qaEval.js compare eval/qa-eval-before-*.json eval/qa-eval-after-*.json
//
// Fetch-based (not the openai SDK) so OpenRouter (/chat/completions) and freesolo
// (/v1/runs/<RUN_ID>/chat) share one code path: POST {model,messages,temperature,
// max_tokens}, read choices[0].message.content. The judge reuses the Cerebras
// client pattern + brace-matched JSON parse from staticdata/extractWikiQA.js.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
const DEFAULT_EVAL = path.join(__dirname, "dataset/eval.jsonl");
const EVAL_DIR = path.join(REPO, "eval");

// --- pure scoring helpers (exported for tests) ------------------------------

export function normalize(s) {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^a-z0-9'\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenize(s) {
  const n = normalize(s);
  return n ? n.split(" ") : [];
}

export function jaccard(a, b) {
  const A = new Set(tokenize(a));
  const B = new Set(tokenize(b));
  if (A.size === 0 && B.size === 0) return 1;
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

// Free-form answers are often paraphrases; a gold-string-in-prediction check is
// too generous for long golds and too harsh for short ones. Jaccard is the
// primary fuzzy signal; substring is a secondary "did it contain the gold" flag.
export function fuzzyScore(prediction, gold) {
  return {
    jaccard: Number(jaccard(prediction, gold).toFixed(4)),
    gold_substring: normalize(gold).length > 0 && normalize(prediction).includes(normalize(gold)),
  };
}

// Pull the outermost {...} via brace counting (gemma wraps/surrounds JSON).
export function parseJudgeJson(content) {
  if (!content) return null;
  let s = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const start = s.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let end = -1;
  for (let i = start; i < s.length; i++) {
    if (s[i] === "{") depth++;
    else if (s[i] === "}") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end < 0) return null;
  try {
    const obj = JSON.parse(s.slice(start, end + 1));
    return typeof obj?.correct === "boolean" ? obj : null;
  } catch {
    return null;
  }
}

export function buildJudgeMessages(question, gold, prediction) {
  return [
    {
      role: "system",
      content:
        "You judge whether a candidate answer to a Pokémon FireRed/LeafGreen gameplay question is factually correct, given a reference answer. Be lenient on wording but strict on facts. Reply ONLY with JSON: {\"correct\": true|false, \"reason\": \"one short sentence\"}. A paraphrase that preserves the facts is correct; a contradiction or a missing key fact is incorrect.",
    },
    {
      role: "user",
      content: `Question: ${question}\nReference answer: ${gold}\nCandidate answer: ${prediction}`,
    },
  ];
}

// --- HTTP -------------------------------------------------------------------

export async function chatComplete({ endpoint, model, key, messages, temperature = 0, maxTokens = 512, disableThinking = true }) {
  const body = { messages, temperature, max_tokens: maxTokens };
  if (model) body.model = model;
  // Qwen3.5 is a thinking model; with thinking on, short max_tokens can be
  // consumed entirely by the reasoning trace -> empty content + finish=length.
  // freesolo trains our LoRA with --no-reasoning, so disable thinking here for
  // before/after parity. Both OpenRouter (`reasoning.enabled`) and raw Qwen
  // (`enable_thinking`) conventions are set; harmless if a server ignores them.
  if (disableThinking) {
    body.reasoning = { enabled: false };
    body.enable_thinking = false;
  }
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
      "HTTP-Referer": "https://github.com/dmrgn/GeminiPlaysPokemonLive",
      "X-Title": "GeminiPlaysPokemonLive E4 eval",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} from ${endpoint}: ${t.slice(0, 300)}`);
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error(`no content in response: ${JSON.stringify(data).slice(0, 300)}`);
  return content.trim();
}

// Bounded-concurrency pool, preserves input order, failures -> {error}.
export async function runPool(items, concurrency, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      try {
        out[i] = await fn(items[i], i);
      } catch (e) {
        out[i] = { error: String(e?.message || e) };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return out;
}

function readJsonl(p) {
  return fs.readFileSync(p, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
}

// --- run / compare ----------------------------------------------------------

async function runEval(opts) {
  const rows = readJsonl(opts.eval);
  const systemMessage = opts.systemFile
    ? fs.readFileSync(opts.systemFile, "utf8").trim()
    : "";
  const key = process.env[opts.keyEnv];
  if (!key) throw new Error(`env var ${opts.keyEnv} not set`);
  const judgeKey = opts.judgeKeyEnv ? process.env[opts.judgeKeyEnv] : null;
  const useJudge = !opts.noJudge && !!judgeKey && !!opts.judgeEndpoint;

  console.error(`[${opts.label}] endpoint=${opts.endpoint} model=${opts.model||"(in-url)"} n=${rows.length} judge=${useJudge}`);

  const perItem = await runPool(rows, opts.concurrency, async (r) => {
    let prediction;
    try {
      prediction = await chatComplete({
        endpoint: opts.endpoint,
        model: opts.model,
        key,
        messages: systemMessage
          ? [
              { role: "system", content: systemMessage },
              { role: "user", content: r.question },
            ]
          : [{ role: "user", content: r.question }],
        temperature: 0,
        maxTokens: opts.maxTokens,
        disableThinking: !opts.thinking,
      });
    } catch (e) {
      return { id: r.id, question: r.question, gold: r.answer, error: String(e?.message || e) };
    }
    const fuzzy = fuzzyScore(prediction, r.answer);
    let judge = null;
    if (useJudge) {
      try {
        const raw = await chatComplete({
          endpoint: opts.judgeEndpoint,
          model: opts.judgeModel,
          key: judgeKey,
          messages: buildJudgeMessages(r.question, r.answer, prediction),
          temperature: 0,
          maxTokens: 128,
          disableThinking: false, // Cerebras gemma is not a thinking model
        });
        judge = parseJudgeJson(raw) || { correct: null, reason: `unparseable: ${raw.slice(0, 120)}` };
      } catch (e) {
        judge = { correct: null, reason: `judge error: ${String(e?.message || e)}` };
      }
    }
    return {
      id: r.id,
      source: r.source,
      kind: r.kind ?? null,
      question: r.question,
      gold: r.answer,
      prediction,
      fuzzy_jaccard: fuzzy.jaccard,
      gold_substring: fuzzy.gold_substring,
      llm_correct: judge?.correct ?? null,
      llm_reason: judge?.reason ?? null,
    };
  });

  const ok = perItem.filter((p) => !p.error);
  const fuzzyMean = mean(ok.map((p) => p.fuzzy_jaccard));
  const judged = ok.filter((p) => typeof p.llm_correct === "boolean");
  const llmAcc = judged.length ? mean(judged.map((p) => (p.llm_correct ? 1 : 0))) : null;
  const subStr = mean(ok.map((p) => (p.gold_substring ? 1 : 0)));

  // Per-kind judge accuracy. Reframed-eval rows carry a `kind` ("single" |
  // "combined"); combined questions require recalling BOTH seed facts, so their
  // bar is higher — break this out so the delta isn't misread. Rows without a
  // kind fall under null.
  const byKind = {};
  for (const p of judged) {
    const k = p.kind ?? "none";
    byKind[k] ??= { n: 0, correct: 0 };
    byKind[k].n++;
    if (p.llm_correct) byKind[k].correct++;
  }
  const llmJudgeAccuracyByKind = Object.fromEntries(
    Object.entries(byKind).map(([k, v]) => [k, { n: v.n, correct: v.correct, accuracy: round(v.correct / v.n) }]),
  );

  const report = {
    schema: "qa-eval/1.0",
    label: opts.label,
    endpoint: opts.endpoint,
    model: opts.model || null,
    n: rows.length,
    n_answered: ok.length,
    n_judged: judged.length,
    fuzzy_jaccard_mean: round(fuzzyMean),
    gold_substring_rate: round(subStr),
    llm_judge_accuracy: llmAcc === null ? null : round(llmAcc),
    llm_judge_accuracy_by_kind: llmJudgeAccuracyByKind,
    per_item: perItem,
  };

  fs.mkdirSync(EVAL_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = path.join(EVAL_DIR, `qa-eval-${opts.label}-${ts}.json`);
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n");
  console.log(`wrote ${outPath}`);
  console.log(`  fuzzy_jaccard_mean=${report.fuzzy_jaccard_mean}  gold_substring_rate=${report.gold_substring_rate}  llm_judge_accuracy=${report.llm_judge_accuracy}  (n_judged=${report.n_judged})`);
  return outPath;
}

function mean(xs) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}
function round(x) {
  return Number(x.toFixed(4));
}

function compare(aPath, bPath) {
  const a = JSON.parse(fs.readFileSync(aPath, "utf8"));
  const b = JSON.parse(fs.readFileSync(bPath, "utf8"));
  const row = (label, r) =>
    `${label.padEnd(10)} fuzzy_jaccard=${r.fuzzy_jaccard_mean}  gold_substring=${r.gold_substring_rate}  llm_judge_acc=${r.llm_judge_accuracy}  (n=${r.n_answered}/${r.n})`;
  console.log(row(a.label || "before", a));
  console.log(row(b.label || "after", b));
  const dFuzzy = (b.fuzzy_jaccard_mean - a.fuzzy_jaccard_mean).toFixed(4);
  const dSub = (b.gold_substring_rate - a.gold_substring_rate).toFixed(4);
  const dLlm =
    a.llm_judge_accuracy != null && b.llm_judge_accuracy != null
      ? (b.llm_judge_accuracy - a.llm_judge_accuracy).toFixed(4)
      : "n/a";
  console.log(`${"delta".padEnd(10)} fuzzy_jaccard=${dFuzzy}  gold_substring=${dSub}  llm_judge_acc=${dLlm}`);
}

// --- CLI --------------------------------------------------------------------

function parseFlags(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2).replace(/-./g, (m) => m[1].toUpperCase());
      // --no-judge is a boolean flag
      if (k === "noJudge") o.noJudge = true;
      else o[k] = argv[++i];
    }
  }
  return o;
}

async function main() {
  const [sub, ...rest] = process.argv.slice(2);
  const f = parseFlags(rest);
  if (sub === "compare") {
    compare(rest[0], rest[1]);
    return;
  }
  if (sub !== "run") {
    console.error("usage:\n  qaEval.js run --endpoint URL --model M --key-env KEY --label L [--no-judge]\n  qaEval.js compare <before.json> <after.json>");
    process.exit(1);
  }
  const opts = {
    eval: f.eval || DEFAULT_EVAL,
    systemFile: f.systemFile || null,
    endpoint: f.endpoint,
    model: f.model || null,
    keyEnv: f.keyEnv || "OPENROUTER_API_KEY",
    label: f.label || (f.model || "model"),
    concurrency: parseInt(f.concurrency || "2", 10),
    maxTokens: parseInt(f.maxTokens || "512", 10),
    thinking: !!f.thinking,
    judgeEndpoint: f.judgeEndpoint || "https://api.cerebras.ai/v1/chat/completions",
    judgeModel: f.judgeModel || "gemma-4-31b",
    judgeKeyEnv: f.judgeKeyEnv || "CEREBRAS_API_KEY",
    noJudge: !!f.noJudge,
  };
  if (!opts.endpoint) {
    console.error("--endpoint is required (e.g. https://openrouter.ai/api/v1/chat/completions)");
    process.exit(1);
  }
  await runEval(opts);
}

// Only run CLI when invoked directly, not when imported (e.g. by the test file).
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((e) => {
    console.error(e?.stack || e);
    process.exit(1);
  });
}
