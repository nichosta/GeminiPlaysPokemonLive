// E2-eval: (state → intent) before/after/gemini comparison harness.
//
// Loads the held-out intent eval split (default finetune-state-intent/dataset/eval.jsonl,
// 197 rows from buildStateIntentEval.js) and asks each model: given this game-state
// window, emit the next high-level intent (one D1 tool call). The system prompt
// defaults to E2's SYSTEM_PROMPT (system_message.txt) — the SAME framing the labels
// were generated under and the SFT trains on, so before/after/gemini are
// apples-to-apples.
//
// Scoring (per item, all pure — exported for the self-test):
//   parse_ok  — parseIntentObj returned {intent, rationale}  (E2's brace parser)
//   valid     — the intent passes validateIntent against the frozen D1 schemas
//   name_match— predicted tool name == gold tool name      (HEADLINE metric)
//   exact     — name + all args deep-equal to gold (stable-stringified)
//   arg_match — name + per-tool primary-arg equal, lenient on wording
//               (goto: location normalized-equal | x,y equal; press: buttons array
//                equal; strategy/method/item: equal). Softer than exact.
//   llm_correct (optional) — Cerebras gemma-4-31b judge: is pred a correct next
//               action given the state + gold? Fairer than exact since the gold
//               label is teacher-generated and a different valid intent can exist.
//
// Writes eval/intent-eval-<label>-<ts>.json.  `compare` prints a side-by-side
// table over N reports (before / after / gemini).
//
//   node finetune-state-intent/intentEval.js run --endpoint URL [--model M] --key-env KEY --label before
//   node finetune-state-intent/intentEval.js compare eval/intent-eval-before-*.json eval/intent-eval-gemini-*.json [eval/intent-eval-after-*.json]
//
// Lanes (OpenAI-compatible endpoints):
//   before  : https://openrouter.ai/api/v1/chat/completions  --model qwen/qwen3.5-9b   --key-env OPENROUTER_API_KEY
//   gemini  : https://openrouter.ai/api/v1/chat/completions  --model google/gemini-3.5-flash --key-env OPENROUTER_API_KEY
//   after   : <freesolo deployed> /v1/runs/<RUN_ID>/chat     (no --model; in-url)      --key-env FREESOLO_API_KEY
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
// Shared LLM-eval helpers (chatComplete, runPool, normalize, parseJudgeJson)
// live with the wiki-QA lane in finetune/qaEval.js; this lane imports them
// cross-folder rather than duplicating the module. The D1 intent schemas come
// from staticdata/extractStateIntent.js (repo-level, shared).
import { chatComplete, runPool, normalize, parseJudgeJson } from "../finetune/qaEval.js";
import { SYSTEM_PROMPT, parseIntentObj, validateIntent } from "../staticdata/extractStateIntent.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
const DEFAULT_EVAL = path.join(__dirname, "dataset/eval.jsonl");
const DEFAULT_SYSTEM_FILE = path.join(__dirname, "system_message.txt");
const EVAL_DIR = path.join(REPO, "eval");

// --- pure scoring helpers (exported for tests) ------------------------------

// Deterministic deep-stringify: object keys sorted recursively so two intents
// with the same name+args stringify identically regardless of key order.
export function stableStringify(obj) {
  return JSON.stringify(sortKeys(obj));
}
function sortKeys(o) {
  if (o === null || typeof o !== "object") return o;
  if (Array.isArray(o)) return o.map(sortKeys);
  const out = {};
  for (const k of Object.keys(o).sort()) out[k] = sortKeys(o[k]);
  return out;
}

// Per-tool primary-arg match, lenient on wording. Only meaningful when the tool
// names already match (caller checks name first). goto tolerates location casing
// / punctuation; press compares the button array; others compare the single key.
export function argMatch(pred, gold) {
  const pa = pred?.args || {};
  const ga = gold?.args || {};
  switch (pred?.name) {
    case "goto": {
      const pd = pa.destination;
      const gd = ga.destination;
      if (!pd || !gd) return false;
      if (gd.location && pd.location) return normalize(pd.location) === normalize(gd.location);
      if (Number.isInteger(gd.x) && Number.isInteger(gd.y))
        return pd.x === gd.x && pd.y === gd.y;
      return false;
    }
    case "set_battle_strategy":
      return pa.strategy === ga.strategy;
    case "heal":
      return pa.method === ga.method;
    case "press":
      return (
        Array.isArray(pa.buttons) &&
        Array.isArray(ga.buttons) &&
        JSON.stringify(pa.buttons) === JSON.stringify(ga.buttons)
      );
    case "use_item":
      return normalize(pa.item) === normalize(ga.item);
    default:
      return false;
  }
}

// Score one raw model response against the gold intent.
export function scoreIntent(rawText, goldIntent) {
  const out = {
    parse_ok: false,
    valid: false,
    name_match: false,
    exact: false,
    arg_match: false,
    pred_intent: null,
    rationale: null,
    invalid_reason: null,
    parse_error: null,
  };
  if (typeof rawText !== "string" || !rawText.trim()) {
    out.parse_error = "empty response";
    return out;
  }
  const parsed = parseIntentObj(rawText);
  if (!parsed || !parsed.intent) {
    out.parse_error = "unparseable: no {intent,...} object";
    return out;
  }
  out.parse_ok = true;
  out.pred_intent = parsed.intent;
  out.rationale = parsed.rationale ?? null;
  const v = validateIntent(parsed.intent);
  if (!v.ok) {
    out.invalid_reason = v.reason;
    return out;
  }
  out.valid = true;
  out.name_match = parsed.intent.name === goldIntent.name;
  out.exact = out.name_match && stableStringify(parsed.intent) === stableStringify(goldIntent);
  out.arg_match = out.name_match && argMatch(parsed.intent, goldIntent);
  return out;
}

export function buildIntentJudgeMessages(state, goldIntent, predIntent) {
  return [
    {
      role: "system",
      content:
        "You judge whether a candidate next-intent for a Pokémon FireRed/LeafGreen agent is correct, given the recent game-state window and a reference intent. The reference is one valid intent but not the only valid one — a candidate that picks a different reasonable tool for the depicted state can still be correct. Be strict on facts: a candidate that misreads the state (e.g. calling a battle strategy when no battle UI is shown, or navigating during a menu) is incorrect. Reply ONLY with JSON: {\"correct\": true|false, \"reason\": \"one short sentence\"}.",
    },
    {
      role: "user",
      content:
        `Recent game-state window (last frame = current state):\n${state}\n\n` +
        `Reference intent: ${JSON.stringify(goldIntent)}\n` +
        `Candidate intent: ${JSON.stringify(predIntent)}`,
    },
  ];
}

// --- run / compare ----------------------------------------------------------

function readJsonl(p) {
  return fs.readFileSync(p, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
}
function mean(xs) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}
function round(x) {
  return Number(x.toFixed(4));
}

async function runEval(opts) {
  let rows = readJsonl(opts.eval);
  if (opts.limit) rows = rows.slice(0, opts.limit);
  const systemMessage = opts.systemFile
    ? fs.readFileSync(opts.systemFile, "utf8").trim()
    : SYSTEM_PROMPT;
  const key = process.env[opts.keyEnv];
  if (!key) throw new Error(`env var ${opts.keyEnv} not set`);
  const judgeKey = opts.judgeKeyEnv ? process.env[opts.judgeKeyEnv] : null;
  const useJudge = !opts.noJudge && !!judgeKey && !!opts.judgeEndpoint;

  console.error(
    `[${opts.label}] endpoint=${opts.endpoint} model=${opts.model || "(in-url)"} n=${rows.length} judge=${useJudge}`,
  );

  const perItem = await runPool(rows, opts.concurrency, async (r) => {
    let raw;
    try {
      raw = await chatComplete({
        endpoint: opts.endpoint,
        model: opts.model,
        key,
        messages: [
          { role: "system", content: systemMessage },
          { role: "user", content: r.state },
        ],
        temperature: 0,
        maxTokens: opts.maxTokens,
        disableThinking: !opts.thinking,
      });
    } catch (e) {
      return { id: r.id, source: r.source, gold_intent: r.intent, error: String(e?.message || e) };
    }
    const s = scoreIntent(raw, r.intent);
    let judge = null;
    if (useJudge && s.pred_intent) {
      try {
        const jraw = await chatComplete({
          endpoint: opts.judgeEndpoint,
          model: opts.judgeModel,
          key: judgeKey,
          messages: buildIntentJudgeMessages(r.state, r.intent, s.pred_intent),
          temperature: 0,
          maxTokens: 128,
          disableThinking: false,
        });
        judge = parseJudgeJson(jraw) || { correct: null, reason: `unparseable: ${jraw.slice(0, 120)}` };
      } catch (e) {
        judge = { correct: null, reason: `judge error: ${String(e?.message || e)}` };
      }
    }
    return {
      id: r.id,
      source: r.source,
      gold_intent: r.intent,
      raw: opts.keepRaw ? raw : undefined,
      prediction: s.pred_intent,
      rationale: s.rationale,
      parse_ok: s.parse_ok,
      valid: s.valid,
      name_match: s.name_match,
      exact: s.exact,
      arg_match: s.arg_match,
      invalid_reason: s.invalid_reason,
      parse_error: s.parse_error,
      llm_correct: judge?.correct ?? null,
      llm_reason: judge?.reason ?? null,
    };
  });

  const ok = perItem.filter((p) => !p.error);
  const validRate = mean(ok.map((p) => (p.valid ? 1 : 0)));
  const nameAcc = mean(ok.map((p) => (p.name_match ? 1 : 0)));
  const exactAcc = mean(ok.map((p) => (p.exact ? 1 : 0)));
  const argRate = mean(ok.map((p) => (p.arg_match ? 1 : 0)));
  const judged = ok.filter((p) => typeof p.llm_correct === "boolean");
  const llmAcc = judged.length ? mean(judged.map((p) => (p.llm_correct ? 1 : 0))) : null;

  // name_accuracy by gold tool — set_battle_strategy dominates the split, so the
  // aggregate hides per-tool behavior. n = answered rows for that gold tool.
  const byTool = {};
  for (const p of ok) {
    const t = p.gold_intent?.name ?? "?";
    byTool[t] ??= { n: 0, name_correct: 0, exact_correct: 0 };
    byTool[t].n++;
    if (p.name_match) byTool[t].name_correct++;
    if (p.exact) byTool[t].exact_correct++;
  }
  const byToolOut = Object.fromEntries(
    Object.entries(byTool)
      .sort((a, b) => b[1].n - a[1].n)
      .map(([k, v]) => [
        k,
        { n: v.n, name_accuracy: round(v.name_correct / v.n), exact_accuracy: round(v.exact_correct / v.n) },
      ]),
  );

  const report = {
    schema: "intent-eval/1.0",
    label: opts.label,
    endpoint: opts.endpoint,
    model: opts.model || null,
    n: rows.length,
    n_answered: ok.length,
    n_judged: judged.length,
    valid_rate: round(validRate),
    name_accuracy: round(nameAcc),
    exact_accuracy: round(exactAcc),
    arg_match_rate: round(argRate),
    llm_judge_accuracy: llmAcc === null ? null : round(llmAcc),
    name_accuracy_by_tool: byToolOut,
    per_item: perItem,
  };

  fs.mkdirSync(EVAL_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = path.join(EVAL_DIR, `intent-eval-${opts.label}-${ts}.json`);
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n");
  console.log(`wrote ${outPath}`);
  console.log(
    `  valid_rate=${report.valid_rate}  name_accuracy=${report.name_accuracy}  exact_accuracy=${report.exact_accuracy}  arg_match=${report.arg_match_rate}  llm_judge=${report.llm_judge_accuracy}  (n_answered=${report.n_answered}/${report.n}, n_judged=${report.n_judged})`,
  );
  return outPath;
}

function compare(paths) {
  const reports = paths.map((p) => JSON.parse(fs.readFileSync(p, "utf8")));
  const hdr = `${"label".padEnd(10)} ${"valid".padStart(7)} ${"name_acc".padStart(8)} ${"exact_acc".padStart(10)} ${"arg_match".padStart(9)} ${"llm_judge".padStart(9)  }  n`;
  console.log(hdr);
  console.log("-".repeat(hdr.length));
  for (const r of reports) {
    console.log(
      `${(r.label || "?").padEnd(10)} ${String(r.valid_rate).padStart(7)} ${String(r.name_accuracy).padStart(8)} ${String(r.exact_accuracy).padStart(10)} ${String(r.arg_match_rate).padStart(9)} ${String(r.llm_judge_accuracy ?? "-").padStart(9)}  ${r.n_answered}/${r.n}`,
    );
  }
  // per-tool name_accuracy across reports (compact)
  const tools = Array.from(new Set(reports.flatMap((r) => Object.keys(r.name_accuracy_by_tool || {}))));
  if (tools.length) {
    console.log("\nname_accuracy by gold tool:");
    console.log(`  ${"tool".padEnd(22)} ${reports.map((r) => (r.label || "?").padStart(10)).join(" ")}`);
    for (const t of tools) {
      const cells = reports.map((r) => {
        const e = r.name_accuracy_by_tool?.[t];
        return e ? `${e.name_accuracy}(${e.n})`.padStart(10) : "-".padStart(10);
      });
      console.log(`  ${t.padEnd(22)} ${cells.join(" ")}`);
    }
  }
}

// --- CLI --------------------------------------------------------------------

function parseFlags(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2).replace(/-./g, (m) => m[1].toUpperCase());
      if (k === "noJudge") o.noJudge = true;
      else if (k === "keepRaw") o.keepRaw = true;
      else o[k] = argv[++i];
    }
  }
  return o;
}

async function main() {
  const [sub, ...rest] = process.argv.slice(2);
  const f = parseFlags(rest);
  if (sub === "compare") {
    if (rest.length < 1) {
      console.error("usage: intentEval.js compare <a.json> <b.json> [c.json ...]");
      process.exit(1);
    }
    compare(rest);
    return;
  }
  if (sub !== "run") {
    console.error(
      "usage:\n  intentEval.js run --endpoint URL [--model M] --key-env KEY --label L [--limit N] [--no-judge]\n  intentEval.js compare <a.json> <b.json> [c.json ...]",
    );
    process.exit(1);
  }
  const opts = {
    eval: f.eval || DEFAULT_EVAL,
    systemFile: f.systemFile || DEFAULT_SYSTEM_FILE,
    endpoint: f.endpoint,
    model: f.model || null,
    keyEnv: f.keyEnv || "OPENROUTER_API_KEY",
    label: f.label || (f.model || "model"),
    concurrency: parseInt(f.concurrency || "4", 10),
    maxTokens: parseInt(f.maxTokens || "512", 10),
    thinking: !!f.thinking,
    limit: f.limit ? parseInt(f.limit, 10) : 0,
    keepRaw: !!f.keepRaw,
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

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((e) => {
    console.error(e?.stack || e);
    process.exit(1);
  });
}
