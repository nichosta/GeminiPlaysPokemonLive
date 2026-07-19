// E3-eval: (state -> tool_call) before/after/gemini comparison harness.
//
// Loads the held-out agent-trace eval split (default finetune-agent/dataset/eval.jsonl,
// 92 rows from buildAgentDataset.js) and asks each model: given this LIVE game
// state, emit the next tool call. The system prompt defaults to this lane's
// SYSTEM_MESSAGE (system_message.txt) — the SAME framing the SFT trains on, so
// before/after/gemini are apples-to-apples.
//
// UNLIKE the state-intent lane's eval, the gold label here is gemini's OWN real
// choice (not a teacher-generated grounded label), so "gemini" is not a
// baseline lane to compare against here — it's the source of the gold itself.
// Run it anyway if you want to sanity-check gemini's self-consistency (temp-0
// gemini reproducing its own earlier, possibly temp>0, decision).
//
// Scoring (per item, all pure — exported for the self-test):
//   parse_ok  — parseAgentTraceObj returned {tool_call, commentary}
//   valid     — the tool_call passes validateIntent against the frozen D1 schemas
//   name_match— predicted tool name == gold tool name      (HEADLINE metric)
//   exact     — name + all args deep-equal to gold (stable-stringified)
//   arg_match — name + per-tool primary-arg equal, lenient on wording
//
// Writes eval/agent-trace-eval-<label>-<ts>.json.  `compare` prints a
// side-by-side table over N reports (before / after / gemini).
//
//   node finetune-agent/agentTraceEval.js run --endpoint URL [--model M] --key-env KEY --label before
//   node finetune-agent/agentTraceEval.js compare eval/agent-trace-eval-before-*.json eval/agent-trace-eval-after-*.json
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
// cross-folder rather than duplicating the module. The D1 schema validator
// comes from staticdata/extractStateIntent.js (repo-level, shared — it
// operates on any {name,args} object regardless of field name). The brace-
// counted parser is this lane's own (staticdata/extractAgentTraces.js), keyed
// on tool_call/commentary instead of intent/rationale.
import { chatComplete, runPool, normalize, parseJudgeJson } from "../finetune/qaEval.js";
import { validateIntent } from "../staticdata/extractStateIntent.js";
import { parseAgentTraceObj } from "../staticdata/extractAgentTraces.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
const DEFAULT_EVAL = path.join(__dirname, "dataset/eval.jsonl");
const DEFAULT_SYSTEM_FILE = path.join(__dirname, "system_message.txt");
const EVAL_DIR = path.join(REPO, "eval");

// --- pure scoring helpers (exported for tests) ------------------------------

// Deterministic deep-stringify: object keys sorted recursively so two tool
// calls with the same name+args stringify identically regardless of key order.
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

// Per-tool primary-arg match, lenient on wording. Only meaningful when the
// tool names already match (caller checks name first).
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
    case "fight_battle":
      return (pa.strategy ?? null) === (ga.strategy ?? null);
    case "heal":
      return (pa.method ?? "auto") === (ga.method ?? "auto");
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

// Score one raw model response against the gold tool_call.
export function scoreToolCall(rawText, goldToolCall) {
  const out = {
    parse_ok: false,
    valid: false,
    name_match: false,
    exact: false,
    arg_match: false,
    pred_tool_call: null,
    commentary: null,
    invalid_reason: null,
    parse_error: null,
  };
  if (typeof rawText !== "string" || !rawText.trim()) {
    out.parse_error = "empty response";
    return out;
  }
  const parsed = parseAgentTraceObj(rawText);
  if (!parsed || !parsed.tool_call) {
    out.parse_error = "unparseable: no {tool_call,...} object";
    return out;
  }
  out.parse_ok = true;
  out.pred_tool_call = parsed.tool_call;
  out.commentary = parsed.commentary ?? null;
  const v = validateIntent(parsed.tool_call);
  if (!v.ok) {
    out.invalid_reason = v.reason;
    return out;
  }
  out.valid = true;
  out.name_match = parsed.tool_call.name === goldToolCall.name;
  out.exact = out.name_match && stableStringify(parsed.tool_call) === stableStringify(goldToolCall);
  out.arg_match = out.name_match && argMatch(parsed.tool_call, goldToolCall);
  return out;
}

export function buildToolCallJudgeMessages(state, goldToolCall, predToolCall) {
  return [
    {
      role: "system",
      content:
        "You judge whether a candidate next tool call for a Pokémon FireRed/LeafGreen agent is correct, given the live game state and a reference tool call. The reference is what a real run actually did, but it's one valid action, not the only one — a candidate that picks a different reasonable tool for the depicted state can still be correct. Be strict on facts: a candidate that misreads the state (e.g. calling set_battle_strategy when no battle UI is shown, or navigating during a locked-controls dialog) is incorrect. Reply ONLY with JSON: {\"correct\": true|false, \"reason\": \"one short sentence\"}.",
    },
    {
      role: "user",
      content:
        `Current game state:\n${state}\n\n` +
        `Reference tool call: ${JSON.stringify(goldToolCall)}\n` +
        `Candidate tool call: ${JSON.stringify(predToolCall)}`,
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
    : "";
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
      return { id: r.id, source: r.source, gold_tool_call: r.tool_call, error: String(e?.message || e) };
    }
    const s = scoreToolCall(raw, r.tool_call);
    let judge = null;
    if (useJudge && s.pred_tool_call) {
      try {
        const jraw = await chatComplete({
          endpoint: opts.judgeEndpoint,
          model: opts.judgeModel,
          key: judgeKey,
          messages: buildToolCallJudgeMessages(r.state, r.tool_call, s.pred_tool_call),
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
      gold_tool_call: r.tool_call,
      raw: opts.keepRaw ? raw : undefined,
      prediction: s.pred_tool_call,
      commentary: s.commentary,
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

  // name_accuracy by gold tool — press dominates the split (~80%), so the
  // aggregate hides per-tool behavior. n = answered rows for that gold tool.
  const byTool = {};
  for (const p of ok) {
    const t = p.gold_tool_call?.name ?? "?";
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
    schema: "agent-trace-eval/1.0",
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
  const outPath = path.join(EVAL_DIR, `agent-trace-eval-${opts.label}-${ts}.json`);
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
      console.error("usage: agentTraceEval.js compare <a.json> <b.json> [c.json ...]");
      process.exit(1);
    }
    compare(rest);
    return;
  }
  if (sub !== "run") {
    console.error(
      "usage:\n  agentTraceEval.js run --endpoint URL [--model M] --key-env KEY --label L [--limit N] [--no-judge]\n  agentTraceEval.js compare <a.json> <b.json> [c.json ...]",
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
