// =============================================================================
// TRACE LOGGER (D3)
// =============================================================================
//
// Records every model call as a (state_before, tool_call, outcome) tuple in
// exactly the format E3 (distillation trace collection) will consume. One JSON
// object per line (JSONL), appended to a single run file.
//
// The trace unit is the distillation unit: the SLM is trained to map
// `state_before` (the same pure-text prompt the live model read) → `tool_call`
// (the name+args the big model chose). `outcome` is kept alongside so E3/E4 can
// filter traces by success (SFT on ok/interrupted only) or mine them for RL
// reward signal (a failed/blocked outcome is a negative sample). Nothing here
// is invented or summarized — the record is a verbatim copy of what the loop
// already had in hand at each macro boundary.
//
// Shape is pinned to the FROZEN D1 tool interface: `tool_interface_version` is
// stamped on every record so a trace collected under v1.0.0 can never be
// silently replayed against a bumped interface. `press` calls are flagged
// `is_escape_hatch` (D1: every press is a candidate for a missing macro).
//
// Pure record-builder (makeTraceRecord) is separated from file I/O (TraceLogger)
// so the shape is unit-testable offline with no filesystem.
// =============================================================================

import { promises as fs } from "fs";
import path from "path";

import { TOOL_INTERFACE_VERSION, TOOLS_BY_NAME } from "./toolInterface.js";

/** Trace schema version (independent of the tool-interface version). */
export const TRACE_SCHEMA_VERSION = "trace/1.0";

/** Tools that count as escape-hatch uses (D1: signal for a missing macro). */
const ESCAPE_HATCH_TOOLS = new Set(["press"]);

/**
 * Build a single trace record (pure). The caller hands in exactly the three
 * things the loop already has at a macro boundary: the state prompt text the
 * model read, the tool call it issued (or null if it issued none), and the
 * outcome envelope the dispatcher returned (or null).
 *
 * `stateBefore` is the rendered TEXT prompt (buildStatePrompt output), not the
 * raw snapshot — that is what the SLM will see at inference, so that is what the
 * trace must train on. A compact `state_summary` (caller-supplied) is stamped
 * alongside for cheap filtering/sorting without re-parsing the full prompt.
 *
 * @param {object} input
 * @param {string} input.runId          Run identifier (one per agent.js boot).
 * @param {number} input.turn           Turn index within the run.
 * @param {string} input.model          Model id the call was made against.
 * @param {string} input.stateBefore    The text prompt fed to the model.
 * @param {{name:string,args:object}|null} input.toolCall  Parsed tool call, or null.
 * @param {string} input.commentary     The model's textual commentary (content).
 * @param {object|null} input.outcome   makeOutcome() envelope, or null.
 * @param {object} [input.stateSummary] Compact {map,position,inBattle,controlsLocked,badges} for filtering.
 * @param {object} [input.extra]        Free-form metadata merged in (e.g. usage tokens).
 * @returns {object} A JSON-serializable trace record.
 */
export function makeTraceRecord({
    runId,
    turn,
    model,
    stateBefore,
    toolCall,
    commentary,
    outcome,
    stateSummary = null,
    extra = null,
}) {
    const name = toolCall ? toolCall.name : null;
    const record = {
        schema_version: TRACE_SCHEMA_VERSION,
        tool_interface_version: TOOL_INTERFACE_VERSION,
        run_id: runId,
        turn,
        model,
        state_before: stateBefore ?? "",
        state_summary: stateSummary ?? null,
        tool_call: toolCall
            ? { name, args: toolCall.args ?? {} }
            : null,
        is_escape_hatch: name ? ESCAPE_HATCH_TOOLS.has(name) : false,
        commentary: commentary ?? "",
        outcome: outcome ?? null,
    };
    if (extra && typeof extra === "object") {
        record.metadata = extra;
    }
    return record;
}

/**
 * Derive a compact, cheap-to-filter summary from a B1 snapshot for stamping
 * alongside the full state prompt. Mirrors the fields E3/E4 will most likely
 * slice on (location, battle/lock flags, badges) without re-reading the prompt.
 * @param {object|null} state
 * @returns {object|null}
 */
export function summarizeState(state) {
    if (!state || typeof state !== "object") return null;
    const p = state.player || {};
    const map = p.map || {};
    const pos = p.position || {};
    const q = state.quest || {};
    const reached = q.reached || null;
    const next = q.next || null;
    return {
        map: map.name ?? null,
        bank: map.bank ?? null,
        number: map.number ?? null,
        position: { x: pos.x ?? null, y: pos.y ?? null },
        facing: p.facing ?? null,
        in_battle: state.battle ? !!state.battle.active : null,
        controls_locked: state.progress ? !!state.progress.controlsLocked : null,
        badges: Array.isArray(p.badges) ? p.badges : [],
        party_count: state.party ? (state.party.count ?? null) : null,
        money: typeof p.money === "number" ? p.money : null,
        reached_milestone: reached ? reached.id : null,
        reached_milestone_order: reached ? reached.order : null,
        next_milestone: next ? next.id : null,
        story_progress: typeof q.progress === "number" ? q.progress : null,
    };
}

/**
 * Validate that a parsed object is a well-formed trace record produced by
 * makeTraceRecord. Used by tests and (later) by E3's loader to reject corrupt
 * lines rather than abort the whole dataset.
 * @param {object} r
 * @returns {boolean}
 */
export function isValidTraceRecord(r) {
    if (!r || typeof r !== "object") return false;
    if (r.schema_version !== TRACE_SCHEMA_VERSION) return false;
    if (typeof r.tool_interface_version !== "string") return false;
    if (typeof r.run_id !== "string" && typeof r.run_id !== "number") return false;
    if (typeof r.turn !== "number") return false;
    if (typeof r.state_before !== "string") return false;
    if (typeof r.model !== "string") return false;
    // tool_call is null (no-tool nudge turn) or {name,args}.
    if (r.tool_call === null) {
        // allowed — model issued no tool call this turn
    } else if (
        !r.tool_call ||
        typeof r.tool_call.name !== "string" ||
        typeof r.tool_call.args !== "object"
    ) {
        return false;
    }
    // outcome is null or an envelope with a known status.
    if (r.outcome !== null) {
        if (!r.outcome || typeof r.outcome.status !== "string") return false;
    }
    if (typeof r.is_escape_hatch !== "boolean") return false;
    if (typeof r.commentary !== "string") return false;
    return true;
}

/**
 * File-backed trace writer. Appends one JSON record per line to a run file.
 * Lines are written with a trailing newline so JSONL parsers (and `wc -l`)
 * work. Writes are serialized through a single promise chain so concurrent
 * appends from an async loop never interleave partial lines.
 *
 * The file is created on first append (mkdir -p the dir). It is NOT flushed
 * per-line beyond Node's normal fs buffering; `close()` awaits the queue so a
 * clean shutdown leaves a complete file.
 */
export class TraceLogger {
    /**
     * @param {object} opts
     * @param {string} opts.filePath   JSONL path to append to.
     * @param {string} [opts.runId]   Run id stamped into each record if the
     *                                 record itself doesn't carry one.
     * @param {string} [opts.model]   Default model stamped if record lacks one.
     */
    constructor({ filePath, runId, model } = {}) {
        if (!filePath) throw new Error("TraceLogger requires a filePath");
        this.filePath = filePath;
        this.runId = runId;
        this.model = model;
        this._chain = Promise.resolve();
        this._count = 0;
        this._closed = false;
    }

    /**
     * Append a trace record (or many) to the JSONL file. Accepts a pre-built
     * record from makeTraceRecord() or the raw inputs, in which case the record
     * is built here. Returns a promise that resolves once the write is durable.
     * @param {object|object[]} recordOrInput
     * @returns {Promise<number>} The number of records appended.
     */
    append(recordOrInput) {
        if (this._closed) {
            // After close, drops silently rather than throwing — a trace gap is
            // preferable to crashing the agent loop on shutdown.
            return Promise.resolve(0);
        }
        const records = Array.isArray(recordOrInput) ? recordOrInput : [recordOrInput];
        const built = records.map((r) => {
            if (r && r.schema_version === TRACE_SCHEMA_VERSION) return r; // already built
            return makeTraceRecord({ runId: this.runId, model: this.model, ...r });
        });
        if (built.length === 0) return Promise.resolve(0);
        const block = built.map((r) => JSON.stringify(r)).join("\n") + "\n";
        this._chain = this._chain.then(() => fs.appendFile(this.filePath, block, "utf8"))
            .catch((err) => {
                // Never let a trace write failure take down the agent loop.
                console.error(`[traceLogger] append failed (${this.filePath}):`, err?.message ?? err);
            });
        this._count += built.length;
        return this._chain.then(() => built.length);
    }

    /** Number of records queued so far. */
    get count() {
        return this._count;
    }

    /**
     * Ensure the directory exists and is writable. Resolves true on success.
     * Safe to call before append (append also mkdirs lazily).
     * @returns {Promise<boolean>}
     */
    async ensureDir() {
        try {
            await fs.mkdir(path.dirname(this.filePath) || ".", { recursive: true });
            return true;
        } catch (err) {
            console.error(`[traceLogger] mkdir failed:`, err?.message ?? err);
            return false;
        }
    }

    /**
     * Wait for all queued writes to finish and mark the logger closed. Call on
     * shutdown so the final records are durable before the process exits.
     * @returns {Promise<void>}
     */
    async close() {
        this._closed = true;
        await this._chain;
    }
}

/**
 * Build a run id. Kept here so agent.js and any ad-hoc runner share the format.
 * Format: `run-<seconds>-<rand>` (no Date.now in module-scope top-level so the
 * module is importable in contexts that forbid it; this is only called from the
 * runtime loop).
 * @param {number} nowMs  Timestamp (e.g. Date.now()) from the caller.
 * @returns {string}
 */
export function makeRunId(nowMs) {
    const rand = Math.floor(Math.random() * 0x10000).toString(16).padStart(4, "0");
    return `run-${Math.floor(nowMs / 1000).toString(36)}-${rand}`;
}
