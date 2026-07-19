// =============================================================================
// EVAL HARNESS (D4)
// =============================================================================
//
// Makes harness and model changes measurable, two ways:
//
//   1. Milestone savestate checkpoints. The first time each story milestone
//      completes (its flag(s) turn set in RAM), the harness writes an mGBA
//      savestate to a file named for the milestone. E3 (distillation trace
//      collection) branches runs from these checkpoints for coverage — instead
//      of always replaying Pallet Town, a distillation run can resume from
//      "got_pokedex" or "defeated_brock" and collect trace in a later story
//      beat. They also let a real run resume from a known story state.
//
//   2. Timed run-to-Brock benchmark. Tracks wall-clock time, model turns,
//      tool-step budget, and (optionally) emulator frames from run start to the
//      terminal Boulder Badge milestone, with per-milestone crossing times. The
//      report JSON is the number a model swap or harness change moves — "did
//      switching to model X get to Brock faster, in fewer turns, with fewer
//      failed outcomes?".
//
// Milestone completion is read straight from RAM via A4's resolved flag
// bit-offsets (skills/milestones.js → flagBit → readPlayerFlag). The runtime
// flag map (constant/savestate_flag_map_frlg.js) currently only knows the 8
// badge flags; D4 does NOT depend on that map being extended — it reads the
// story flags by their resolved numeric bit-offset directly, which is the
// whole point of A4 having resolved them authoritatively from the decomp.
//
// Design mirrors D3's traceLogger: a pure record-builder + validator
// (makeBenchmarkReport / isValidBenchmarkReport) separated from the live
// transport (EvalHarness) so the shape and decision logic are unit-testable
// offline with injected fakes (no emulator, no API key). Live end-to-end play
// against a running emulator is exercised by driving the real agent loop —
// same convention as D2/D3.
//
// mGBA-http savestate endpoints (src/mGBAHttp/Endpoints/SaveStateApi.cs, per
// the repo's swagger.json):
//   POST /core/savestatefile?path=<abs>&flags=<int>   save state to a file
//   POST /core/loadstatefile?path=<abs>&flags=<int>   load state from a file
//   POST /core/savestateslot?slot=<n>&flags=<int>     save state to a slot
//   POST /core/loadstateslot?slot=<n>&flags=<int>     load state from a slot
// `flags` is the mGBA SAVESTATE bitmask (SCREENSHOT=1|SAVEDATA=2|CHEATS=4|
// RTC=8|METADATA=16; ALL=31). Save defaults to 31 (ALL), load to 29 (no
// METADATA) — mGBA's own scripting defaults.
// =============================================================================

import { promises as fs } from "fs";
import path from "path";

import {
    milestones,
    isComplete,
    currentMilestone,
    resolveMilestone,
    readFlagSet,
    allMilestoneFlagNames,
} from "./milestones.js";

// Re-export the pure flag-read helpers (now defined in the query layer) so
// this module's existing import surface — `import { readFlagSet,
// allMilestoneFlagNames } from "./evalHarness.js"` — keeps working. New
// consumers (e.g. B1's getState) import them from milestones.js directly to
// avoid the gamestate -> skills -> tools -> gamestate import cycle.
export { readFlagSet, allMilestoneFlagNames };

// Optional, injected by default from the live transport below. Imported lazily
// via the default-transport getters so a pure import of this module never
// requires a running emulator (tests pass a fake instead).
import { readPlayerFlag } from "../gamestate/overworld/playerData.js";
import { readCurrentFrame } from "../tools/inputExecutor.js";

/** Eval-report schema version (independent of the tool-interface version). */
export const EVAL_SCHEMA_VERSION = "eval/1.0";

/** The terminal pre-Brock milestone — when reached, the benchmark is done. */
export const TERMINAL_MILESTONE = "got_boulder_badge";

/** mGBA SAVESTATE flag bitmask. Save=ALL(31), load=29 (no METADATA). */
export const SAVESTATE_FLAGS_SAVE = 31;
export const SAVESTATE_FLAGS_LOAD = 29;

const CORE_ENDPOINT = "http://localhost:5000/core";

// -----------------------------------------------------------------------------
// Savestate transport — thin wrappers over the mGBA-http endpoints. The
// `io` param is injectable (tests pass a fake); default hits the live server.
// -----------------------------------------------------------------------------

async function httpPost(url) {
    const res = await fetch(url, { method: "POST" });
    if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status} ${res.statusText}${body ? `: ${body}` : ""} (${url})`);
    }
}

/** Default transport: real HTTP against a running mGBA-http server. */
export const httpIo = Object.freeze({ post: httpPost });

/**
 * POST /core/savestatefile — save the current emulator state to `absPath`.
 * @param {string} absPath absolute filesystem path for the savestate.
 * @param {object} [io] injectable transport (test hook).
 */
export async function saveStateFile(absPath, io = httpIo) {
    const url = `${CORE_ENDPOINT}/savestatefile?path=${encodeURIComponent(absPath)}&flags=${SAVESTATE_FLAGS_SAVE}`;
    await io.post(url);
}

/** POST /core/loadstatefile — load `absPath` into the emulator. */
export async function loadStateFile(absPath, io = httpIo) {
    const url = `${CORE_ENDPOINT}/loadstatefile?path=${encodeURIComponent(absPath)}&flags=${SAVESTATE_FLAGS_LOAD}`;
    await io.post(url);
}

/** POST /core/savestateslot — save state to mGBA slot `slot` (0–9). */
export async function saveStateSlot(slot, io = httpIo) {
    const url = `${CORE_ENDPOINT}/savestateslot?slot=${encodeURIComponent(String(slot))}&flags=${SAVESTATE_FLAGS_SAVE}`;
    await io.post(url);
}

/** POST /core/loadstateslot — load state from mGBA slot `slot`. */
export async function loadStateSlot(slot, io = httpIo) {
    const url = `${CORE_ENDPOINT}/loadstateslot?slot=${encodeURIComponent(String(slot))}&flags=${SAVESTATE_FLAGS_LOAD}`;
    await io.post(url);
}

/**
 * Resolve a milestone's checkpoint savestate path. The CheckpointManager writes
 * to `<dir>/<milestone-id>.ss`; this is the inverse E3 calls to load one by
 * milestone id.
 * @param {string} dir checkpoint directory
 * @param {string} milestoneIdOrName id, name, or alias
 * @returns {string|null} absolute-ish path, or null if the milestone is unknown
 */
export function checkpointPath(dir, milestoneIdOrName) {
    const m = resolveMilestone(milestoneIdOrName);
    if (!m) return null;
    return path.join(dir, `${m.id}.ss`);
}

// -----------------------------------------------------------------------------
// Pure benchmark-report builder + validator (testable offline, no I/O).
// -----------------------------------------------------------------------------

/**
 * Serialize the crossings Map (milestoneId → {at_ms, turn, frame}) into an
 * ordered array for the report, in story order, only including crossed beats.
 * @param {Map<string,object>} crossings
 * @returns {Array<object>}
 */
function serializeCrossings(crossings) {
    const out = [];
    for (const m of milestones()) {
        const c = crossings.get(m.id);
        if (!c) continue;
        out.push({
            id: m.id,
            name: m.name,
            order: m.order,
            optional: !!m.optional,
            at_ms: c.atMs,
            turn: c.turn,
            frame: c.frame,
        });
    }
    return out;
}

/**
 * Build a benchmark report (pure). The caller hands in the EvalHarness's
 * accumulated state; nothing is read or written here.
 * @param {object} input
 * @returns {object} a JSON-serializable benchmark report.
 */
export function makeBenchmarkReport(input = {}) {
    const {
        runId = null,
        model = null,
        startedAtMs = null,
        finishedAtMs = null,
        turns = 0,
        steps = 0,
        startFrame = null,
        endFrame = null,
        reached = null,
        terminal = false,
        progress = 0,
        crossings = new Map(),
        finalStateSummary = null,
        note = null,
    } = input;

    const elapsedMs =
        typeof startedAtMs === "number" && typeof finishedAtMs === "number"
            ? finishedAtMs - startedAtMs
            : null;
    const frames =
        typeof startFrame === "number" && typeof endFrame === "number"
            ? endFrame - startFrame
            : null;

    const report = {
        schema_version: EVAL_SCHEMA_VERSION,
        run_id: runId,
        model,
        started_at_ms: startedAtMs,
        finished_at_ms: finishedAtMs,
        elapsed_ms: elapsedMs,
        turns,
        steps,
        start_frame: startFrame,
        end_frame: endFrame,
        frames,
        reached_milestone: reached,
        terminal: !!terminal,
        progress,
        milestones: serializeCrossings(crossings),
    };
    if (finalStateSummary && typeof finalStateSummary === "object") {
        report.final_state = finalStateSummary;
    }
    if (note && typeof note === "string") {
        report.note = note;
    }
    return report;
}

/**
 * Validate a parsed object is a well-formed benchmark report. Used by tests
 * and (later) by anyone loading a report from disk to reject a corrupt file
 * rather than misread it.
 * @param {object} r
 * @returns {boolean}
 */
export function isValidBenchmarkReport(r) {
    if (!r || typeof r !== "object") return false;
    if (r.schema_version !== EVAL_SCHEMA_VERSION) return false;
    if (typeof r.run_id !== "string" && r.run_id !== null) return false;
    if (typeof r.model !== "string" && r.model !== null) return false;
    if (typeof r.turns !== "number") return false;
    if (typeof r.steps !== "number") return false;
    if (typeof r.terminal !== "boolean") return false;
    if (typeof r.progress !== "number") return false;
    if (typeof r.reached_milestone !== "string" && r.reached_milestone !== null) return false;
    if (!Array.isArray(r.milestones)) return false;
    for (const c of r.milestones) {
        if (!c || typeof c.id !== "string") return false;
        if (typeof c.order !== "number") return false;
        if (typeof c.turn !== "number") return false;
    }
    return true;
}

// -----------------------------------------------------------------------------
// EvalHarness — checkpoint monitor + benchmark timer, with injectable
// transport. This is what agent.js constructs at boot and calls per macro
// boundary.
// -----------------------------------------------------------------------------

const defaultClock = () => Date.now();
async function defaultReadFrame() {
    try {
        return await readCurrentFrame();
    } catch {
        return null;
    }
}

/**
 * @typedef {Object} EvalHarnessOptions
 * @property {string} [checkpointDir] Directory to write per-milestone savestates.
 * @property {string} [reportPath] File path for the benchmark report JSON.
 * @property {(bitOffset:number)=>Promise<boolean>} [readFlag] Flag-bit reader
 *           (default: readPlayerFlag from the live RAM reader).
 * @property {(absPath:string)=>Promise<void>} [saveState] Savestate writer
 *           (default: saveStateFile against the live server).
 * @property {()=>number} [clock] Wall-clock source (default Date.now).
 * @property {()=>Promise<number|null>} [readFrame] Emulator frame-counter
 *           source (default readCurrentFrame; null when unavailable).
 * @property {(state:object)=>object|null} [stateSummary] Optional snapshot
 *           summarizer stamped into the final report (default null).
 */

export class EvalHarness {
    /**
     * @param {EvalHarnessOptions} [opts]
     */
    constructor({
        checkpointDir,
        reportPath,
        readFlag = (bit) => readPlayerFlag(bit),
        saveState = (absPath) => saveStateFile(absPath),
        clock = defaultClock,
        readFrame = defaultReadFrame,
        stateSummary = null,
    } = {}) {
        this.checkpointDir = checkpointDir ?? null;
        this.reportPath = reportPath ?? null;
        this.readFlag = readFlag;
        this.saveState = saveState;
        this.clock = clock;
        this.readFrame = readFrame;
        this.stateSummary = stateSummary;

        // Benchmark timing state.
        this._running = false;
        this._closed = false;
        this._reported = false;
        this._model = null;
        this._runId = null;
        this._startedAtMs = null;
        this._startFrame = null;
        this._finishedAtMs = null;
        this._endFrame = null;
        this._turns = 0;
        this._steps = 0;

        // Milestone state.
        this._checkpointed = new Set(); // milestone ids already saved
        this._crossings = new Map(); // milestone id -> {atMs, turn, frame}
        this._reached = null; // furthest reached milestone id this run
        this._progress = 0;
    }

    /**
     * Begin the benchmark: record start wall-clock + (if available) start frame.
     * Idempotent — calling twice is a no-op after the first.
     * @param {{runId?:string, model?:string}} [meta]
     * @returns {Promise<void>}
     */
    async start({ runId = null, model = null } = {}) {
        if (this._running) return;
        this._runId = runId;
        this._model = model;
        this._startedAtMs = this.clock();
        if (this.readFrame) {
            try {
                this._startFrame = await this.readFrame();
            } catch {
                this._startFrame = null;
            }
        }
        this._running = true;
    }

    /**
     * Poll the milestone graph against RAM and checkpoint any newly-complete
     * milestone. Called once per macro boundary (after a B1 snapshot).
     *
     * A milestone is checkpointed only when it is complete AND every
     * predecessor (transitively) is complete — i.e. when currentMilestone
     * counts it as "reached". This matches the story DAG and prevents a
     * debug savestate with the badge bit set but the starter bit unset from
     * checkpointing got_boulder_badge out of order. Each milestone is saved
     * at most once; a saveState failure is swallowed (the milestone is NOT
     * marked checkpointed, so it retries on the next poll).
     *
     * On reaching the terminal milestone, the benchmark report is finalized
     * and written to disk once.
     *
     * @param {object} [_state] B1 snapshot (unused for flag reads — the story
     *     flags aren't in B1's snapshot; only used if a stateSummary was given).
     * @returns {Promise<{newCheckpoints:Array<{id:string,path:string}>,terminal:boolean,progress:number,reached:string|null}>}
     */
    async update(_state) {
        if (!this._running || this._closed) {
            return { newCheckpoints: [], terminal: false, progress: this._progress, reached: this._reached };
        }

        const setFlags = await readFlagSet(this.readFlag);
        const cur = currentMilestone(setFlags);
        this._progress = cur.progress;
        this._reached = cur.reached?.id ?? this._reached;

        // Checkpoint every milestone up to and including `reached` that hasn't
        // been saved yet. currentMilestone only declares a milestone "reached"
        // when it AND all its predecessors are complete, so iterating in story
        // order up to reached's index is exactly the set that's both complete
        // and properly sequenced.
        const ms = milestones();
        const reachedIdx = cur.reached ? ms.findIndex((m) => m.id === cur.reached.id) : -1;
        const newCheckpoints = [];
        const now = this.clock();
        let frameNow = null;
        if (this.readFrame) {
            try { frameNow = await this.readFrame(); } catch { frameNow = null; }
        }

        for (let i = 0; i <= reachedIdx; i++) {
            const m = ms[i];
            if (this._checkpointed.has(m.id)) continue;
            // Defensive: isComplete should be true here (currentMilestone said
            // reached), but re-check so a future graph change can't silently
            // checkpoint an incomplete beat.
            if (!isComplete(m, setFlags)) continue;

            const absPath = this.checkpointDir
                ? path.join(this.checkpointDir, `${m.id}.ss`)
                : null;
            if (absPath) {
                try {
                    await this.saveState(absPath);
                } catch (err) {
                    // Never let a savestate failure take down the agent loop.
                    // The milestone is NOT marked checkpointed, so the next
                    // poll retries it; a missing checkpoint is preferable to
                    // crashing a live run.
                    console.error(`[evalHarness] checkpoint save failed for ${m.id} (${absPath}):`, err?.message ?? err);
                    continue;
                }
            }
            this._checkpointed.add(m.id);
            this._crossings.set(m.id, { atMs: now, turn: this._turns, frame: frameNow });
            newCheckpoints.push({ id: m.id, path: absPath });
        }

        // Terminal: write the finalized benchmark report once.
        const terminal = cur.reached?.id === TERMINAL_MILESTONE;
        if (terminal && !this._reported) {
            this._reported = true;
            this._finishedAtMs = this.clock();
            if (this.readFrame) {
                try { this._endFrame = await this.readFrame(); } catch { this._endFrame = null; }
            }
            await this._writeReport({ terminal: true });
            console.log(`[evalHarness] terminal milestone reached (${TERMINAL_MILESTONE}) — benchmark finalized.`);
        }

        return { newCheckpoints, terminal, progress: this._progress, reached: this._reached };
    }

    /** Increment the model-turn counter (call once per agent-loop iteration). */
    markTurn(n = 1) {
        if (!this._running) return;
        this._turns += n;
    }

    /** Accumulate tool-step budget consumed (from outcome.steps_used). */
    markSteps(n) {
        if (!this._running || !Number.isFinite(n)) return;
        this._steps += n;
    }

    /**
     * Build the current benchmark report from accumulated state (pure).
     * @returns {object}
     */
    report() {
        return makeBenchmarkReport({
            runId: this._runId,
            model: this._model,
            startedAtMs: this._startedAtMs,
            finishedAtMs: this._finishedAtMs,
            turns: this._turns,
            steps: this._steps,
            startFrame: this._startFrame,
            endFrame: this._endFrame,
            reached: this._reached,
            terminal: this._reported,
            progress: this._progress,
            crossings: this._crossings,
        });
    }

    /**
     * Write the benchmark report to disk (mkdir -p the dir). Never throws into
     * the loop on failure — logs and returns false.
     * @param {{terminal?:boolean}} [_opts]
     * @returns {Promise<boolean>}
     */
    async _writeReport(_opts = {}) {
        if (!this.reportPath) return false;
        const report = this.report();
        if (this.stateSummary && _opts.stateSummary !== undefined) {
            // caller may pass a fresh final snapshot summary
            report.final_state = _opts.stateSummary;
        }
        try {
            await fs.mkdir(path.dirname(this.reportPath) || ".", { recursive: true });
            await fs.writeFile(this.reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");
            return true;
        } catch (err) {
            console.error(`[evalHarness] report write failed (${this.reportPath}):`, err?.message ?? err);
            return false;
        }
    }

    /**
     * Ensure the checkpoint directory exists. Safe to call before update
     * (update also mkdirs lazily via the transport). Returns false on failure.
     * @returns {Promise<boolean>}
     */
    async ensureCheckpointDir() {
        if (!this.checkpointDir) return false;
        try {
            await fs.mkdir(this.checkpointDir, { recursive: true });
            return true;
        } catch (err) {
            console.error(`[evalHarness] mkdir failed (${this.checkpointDir}):`, err?.message ?? err);
            return false;
        }
    }

    /**
     * Finalize the benchmark: stamp finish time + frame, write the report.
     * Call on shutdown (SIGINT/SIGTERM) so a clean exit leaves a report even
     * if the terminal milestone was never reached.
     * @param {object} [finalStateSummary] optional final snapshot summary.
     * @returns {Promise<object>} the finalized report.
     */
    async close(finalStateSummary) {
        if (this._closed) return this.report();
        this._closed = true;
        if (!this._finishedAtMs) this._finishedAtMs = this.clock();
        if (this.readFrame && this._endFrame == null) {
            try { this._endFrame = await this.readFrame(); } catch { this._endFrame = null; }
        }
        await this._writeReport({ terminal: this._reported, stateSummary: finalStateSummary });
        return this.report();
    }
}
