// =============================================================================
// Workstream E3: distillation trace collection (state -> tool_call from a REAL
// gemini run, not a teacher-generated label)
// =============================================================================
//
// Unlike E1/E2 (staticdata/extractWikiQA.js, staticdata/extractStateIntent.js),
// which generate GROUNDED labels from wiki/walkthrough text with a teacher model
// that never plays the game, this script does no LLM call at all: it reads the
// D3 trace files that agent.js already writes on every live `node agent.js` run
// (llminteract/traceLogger.js, one JSONL per run under traces/) and reshapes the
// big model's (state_before, tool_call) pairs into the SFT record shape E4 (SFT
// on FreeSolo) consumes. This IS the model's actual behavior — genuine
// distillation, consistent with [[sft-data-is-grounded-not-distilled]] which
// only ever claimed that of E1/E2.
//
// Filtering: only outcome.status === "ok" turns (configurable via --status)
// pass through. This drops:
//   - failed / invalid_args / precondition_failed turns (the model's mistakes)
//   - budget_exhausted turns (the tool call didn't resolve anything)
//   - interrupted turns of EVERY stop_reason, including every hp_low /
//     about_to_faint low-health interrupt, battle_started/dialog escalations,
//     warp_completed, and choice_required — none of these are "the model chose
//     well and the harness carried it out", they're the harness handing control
//     back mid-execution, which is a different training signal than a clean
//     decision-outcome pair.
//   - no-tool-call nudge turns (tool_call === null)
// per TRAINING.md: "SFT can only be as good as the answers you show it."
//
//   node staticdata/extractAgentTraces.js [--traces-dir traces] [--out frlg]
//     [--status ok] [--limit N] [--dry-run]
// =============================================================================

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

import { TOOL_INTERFACE_VERSION } from "../llminteract/toolInterface.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");

function parseArgs(argv) {
    const args = { tracesDir: "traces", out: "frlg", status: "ok" };
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--traces-dir") args.tracesDir = argv[++i];
        else if (a === "--out") args.out = argv[++i];
        else if (a === "--status") args.status = argv[++i];
        else if (a === "--limit") args.limit = parseInt(argv[++i], 10);
        else if (a === "--dry-run") args.dryRun = true;
    }
    return args;
}

const cli = parseArgs(process.argv);
const TRACES_DIR = path.resolve(REPO, cli.tracesDir);
const OUT_DIR = path.resolve(__dirname, cli.out || "frlg");
const ALLOWED_STATUSES = new Set(cli.status.split(",").map((s) => s.trim()).filter(Boolean));

/**
 * List trace-*.jsonl files under a directory, sorted for determinism.
 * @param {string} dir
 * @returns {string[]} absolute file paths
 */
export function listTraceFiles(dir) {
    let names;
    try {
        names = fs.readdirSync(dir);
    } catch {
        return [];
    }
    return names
        .filter((f) => f.endsWith(".jsonl"))
        .sort()
        .map((f) => path.join(dir, f));
}

/**
 * Parse a JSONL file's lines, skipping unparseable ones (a live-killed process
 * can leave a torn final line — never let one bad line drop a whole file).
 * @param {string} text
 * @returns {object[]}
 */
export function parseJsonlLines(text) {
    const out = [];
    for (const line of text.split("\n")) {
        if (!line.trim()) continue;
        try {
            out.push(JSON.parse(line));
        } catch {
            // torn/partial line from a killed process — skip, don't abort the file
        }
    }
    return out;
}

const MOVEMENT_BUTTONS = new Set(["up", "down", "left", "right"]);

/**
 * True iff a `press` record is the model manually walking the overworld
 * instead of calling `goto` — a degenerate fallback (usually triggered by a
 * prior goto failure the model gave up retrying, e.g. a bad destination
 * format or a routing gap), not a legitimate escape-hatch use. `goto` should
 * ALWAYS be preferred for movement per the system prompt/docs; a live run
 * (2026-07-19) confirmed every such fallback is directional buttons while
 * `state_summary.in_battle === false` AND `state_summary.controls_locked ===
 * false` (free walking) — every genuine dialog/cutscene press (locked===true)
 * uses only a/b, and never mixes in movement buttons under that condition.
 * @param {object} record
 * @returns {boolean}
 */
export function isManualMovementFallback(record) {
    if (record?.tool_call?.name !== "press") return false;
    const buttons = record.tool_call.args?.buttons;
    if (!Array.isArray(buttons) || !buttons.some((b) => MOVEMENT_BUTTONS.has(b))) return false;
    const s = record.state_summary;
    return !!s && s.in_battle === false && s.controls_locked === false;
}

/**
 * True iff a trace record should become a training example: a real tool call
 * whose outcome status is in the allowed set (default: {"ok"} only), and NOT
 * a manual-movement fallback (see isManualMovementFallback).
 * @param {object} record
 * @param {Set<string>} allowedStatuses
 * @returns {boolean}
 */
export function isDistillable(record, allowedStatuses) {
    if (!record || typeof record !== "object") return false;
    if (!record.tool_call || typeof record.tool_call.name !== "string") return false;
    const status = record.outcome?.status;
    if (!(typeof status === "string" && allowedStatuses.has(status))) return false;
    return !isManualMovementFallback(record);
}

/**
 * Exact-duplicate key over (state, tool_call) so re-derived identical turns
 * (e.g. a restarted run replaying the same stretch) collapse to one row.
 * Mirrors staticdata/extractStateIntent.js's dedupKey convention.
 * @param {string} stateText
 * @param {{name:string,args:object}} toolCall
 * @returns {string}
 */
export function dedupKey(stateText, toolCall) {
    const normState = stateText.toLowerCase().replace(/\s+/g, " ").trim();
    return crypto.createHash("sha1").update(`${normState}\n${JSON.stringify(toolCall)}`).digest("hex");
}

/**
 * Reshape one valid D3 trace record into the E3 SFT-source record shape.
 * @param {object} record
 * @returns {object}
 */
export function toAgentTraceRecord(record) {
    return {
        source: record.run_id,
        turn: record.turn,
        model: record.model,
        tool_interface_version: record.tool_interface_version,
        state: record.state_before ?? "",
        tool_call: { name: record.tool_call.name, args: record.tool_call.args ?? {} },
        commentary: record.commentary ?? "",
        is_escape_hatch: !!record.is_escape_hatch,
        outcome_status: record.outcome?.status ?? null,
        steps_used: record.outcome?.steps_used ?? 0,
    };
}

// --- Robust JSON parse (shared with finetune-agent/agentTraceEval.js) -------

// Extract a `{tool_call, commentary}` object via brace counting (a model may
// prepend a sentence or wrap the JSON in code fences). Mirrors
// staticdata/extractStateIntent.js's parseIntentObj but keyed on this lane's
// field names (tool_call/commentary instead of intent/rationale).
export function parseAgentTraceObj(content) {
    if (!content) return null;
    let s = content.trim();
    s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
    const start = s.indexOf("{");
    if (start < 0) return null;
    let depth = 0;
    let end = -1;
    for (let i = start; i < s.length; i++) {
        const c = s[i];
        if (c === "{") depth++;
        else if (c === "}") {
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
        if (!obj || typeof obj.tool_call !== "object" || obj.tool_call === null) return null;
        return {
            tool_call: obj.tool_call,
            commentary: typeof obj.commentary === "string" ? obj.commentary.trim() : "",
        };
    } catch {
        return null;
    }
}

function main() {
    const startMs = Date.now();
    console.log("=== Workstream E3: distillation trace collection ===");
    console.log(`Traces dir: ${path.relative(REPO, TRACES_DIR)}  Output dir: ${path.relative(REPO, OUT_DIR)}`);
    console.log(`Allowed outcome statuses: ${[...ALLOWED_STATUSES].join(", ")}  tool interface: v${TOOL_INTERFACE_VERSION}`);

    const files = listTraceFiles(TRACES_DIR);
    console.log(`Trace files: ${files.length}`);

    let totalRaw = 0;
    const byStatus = {};
    const records = [];
    let manualMovementDropped = 0;
    for (const file of files) {
        const lines = parseJsonlLines(fs.readFileSync(file, "utf8"));
        totalRaw += lines.length;
        for (const r of lines) {
            const status = r?.outcome?.status ?? (r?.tool_call === null ? "no_tool_call" : "null_outcome");
            byStatus[status] = (byStatus[status] || 0) + 1;
            if (isManualMovementFallback(r)) {
                manualMovementDropped++;
                continue;
            }
            if (isDistillable(r, ALLOWED_STATUSES)) records.push(toAgentTraceRecord(r));
        }
    }
    console.log(`Raw trace lines: ${totalRaw}  status mix: ${JSON.stringify(byStatus)}`);
    console.log(`Manual-movement fallback presses dropped (goto abandoned for free walking): ${manualMovementDropped}`);
    console.log(`Distillable candidates (status in allowed set, movement-fallback excluded): ${records.length}`);

    let limited = records;
    if (cli.limit) {
        limited = limited.slice(0, cli.limit);
        console.log(`--limit ${cli.limit} -> using ${limited.length} record(s)`);
    }

    // Dedup exact (state, tool_call) duplicates.
    const seen = new Set();
    const deduped = [];
    let dupes = 0;
    for (const r of limited) {
        const k = dedupKey(r.state, r.tool_call);
        if (seen.has(k)) {
            dupes++;
            continue;
        }
        seen.add(k);
        deduped.push(r);
    }

    // Assign ids (mirrors E1/E2's id-added-last convention).
    deduped.forEach((r, i) => {
        r.id = `frlg-trace-${String(i + 1).padStart(4, "0")}`;
    });

    const byTool = {};
    const bySource = {};
    for (const r of deduped) {
        byTool[r.tool_call.name] = (byTool[r.tool_call.name] || 0) + 1;
        bySource[r.source] = (bySource[r.source] || 0) + 1;
    }

    console.log(`Deduped: ${deduped.length} (${dupes} exact dupes dropped)`);
    console.log(`By tool: ${JSON.stringify(byTool)}`);

    if (cli.dryRun) {
        console.log("\n[dry-run] Not writing output files.");
        return;
    }

    fs.mkdirSync(OUT_DIR, { recursive: true });
    const jsonlPath = path.join(OUT_DIR, "agent_traces.jsonl");
    fs.writeFileSync(jsonlPath, deduped.map((r) => JSON.stringify(r)).join("\n") + (deduped.length ? "\n" : ""));

    const manifest = {
        note:
            "E3 distillation trace pairs. state = the exact D2 buildStatePrompt() text the LIVE " +
            "gemini-3.5-flash model read (llminteract/traceLogger.js state_before); tool_call = the " +
            "tool call it actually issued. This IS the model's real behavior (unlike E1/E2's grounded, " +
            "non-distilled labels) — feeds E4 SFT/OPD to distill gemini's play into qwen3.5-9b. " +
            "Manual-movement fallback presses (goto abandoned for free walking after a prior goto " +
            "failure — directional press while in_battle===false and controls_locked===false) are " +
            "EXCLUDED regardless of outcome status: see isManualMovementFallback().",
        toolInterfaceVersion: TOOL_INTERFACE_VERSION,
        allowedStatuses: [...ALLOWED_STATUSES],
        sourceFiles: files.map((f) => path.relative(REPO, f)),
        totalRawLines: totalRaw,
        rawStatusMix: byStatus,
        manualMovementFallbackDropped: manualMovementDropped,
        distillableCandidates: records.length,
        totalPairs: deduped.length,
        dupesDropped: dupes,
        pairsByTool: byTool,
        pairsBySource: bySource,
        generatedAtMs: startMs,
    };
    const manifestPath = path.join(OUT_DIR, "agent_traces_index.json");
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

    console.log(
        `\nWrote ${deduped.length} state->tool_call pairs (${dupes} dupes dropped) from ${files.length} trace file(s) ` +
        `in ${((Date.now() - startMs) / 1000).toFixed(1)}s -> ${path.relative(REPO, jsonlPath)}`,
    );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main();
}
