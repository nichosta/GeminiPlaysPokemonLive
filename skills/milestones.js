// =============================================================================
// MILESTONE / QUEST GRAPH (A4)
// =============================================================================
//
// Query layer over the generated staticdata/frlg/milestones.json (see
// staticdata/extractMilestones.js). Answers the questions E4 (RL reward
// shaping from milestone flags) and D4 (savestate checkpoints at each
// milestone) need:
//
//   - "which milestone is this?"            -> resolveMilestone (id/name)
//   - "what flags mark milestone X done?"   -> completionFlags / flagValues
//   - "given a set of set flags, where am I  -> currentMilestone (furthest
//     in the story, and what's next?"          reached + the next one)
//   - "is milestone X complete?"            -> isComplete (against a flag set)
//   - "what's the numeric bit-offset of a   -> flagBit (for runtime readPlayerFlag)
//     flag, to read it from RAM?"
//   - "read every story flag from RAM into  -> readFlagSet(readFlag) (pure given
//     a Set<string> the graph can evaluate"     an injected bit reader)
//
// Pure data + pure functions — no emulator dependency, matching the rest of
// skills/. The runtime side (actually reading these bits from RAM) is B's
// job; this module only supplies the resolved flag ids, the story DAG, and
// the readFlagSet helper that an injected RAM reader plugs into.
// =============================================================================

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FRLG_DIR = resolve(__dirname, "..", "staticdata", "frlg");

let cache = null;

/** Loads and caches `frlg/milestones.json`. */
export function getMilestones() {
    if (!cache) {
        cache = JSON.parse(readFileSync(join(FRLG_DIR, "milestones.json"), "utf8"));
    }
    return cache;
}

/** All milestone entries, in story order. */
export function milestones() {
    return getMilestones().milestones;
}

/** Milestone ids along the critical path (non-optional), in order. */
export function criticalPath() {
    return milestones()
        .filter((m) => !m.optional)
        .map((m) => m.id);
}

/**
 * Resolve a milestone by id, name (case-insensitive), or alias. Returns the
 * milestone object or null.
 */
export function resolveMilestone(idOrName) {
    const q = String(idOrName).toLowerCase();
    const ms = milestones();
    return (
        ms.find((m) => m.id === idOrName) ??
        ms.find((m) => m.name.toLowerCase() === q) ??
        null
    );
}

/** The milestone immediately before this one in story order, or null. */
export function previousMilestone(id) {
    const ms = milestones();
    const i = ms.findIndex((m) => m.id === id);
    if (i <= 0) return null;
    return ms[i - 1];
}

/** The milestone immediately after this one in story order, or null. */
export function nextMilestone(id) {
    const ms = milestones();
    const i = ms.findIndex((m) => m.id === id);
    if (i < 0 || i >= ms.length - 1) return null;
    return ms[i + 1];
}

/**
 * The list of flag objects that mark a milestone complete. For mode "any"
 * (starter-dependent battles) this is all variants; the caller checks that at
 * least one is set. For mode "all" every flag must be set.
 */
export function completionFlags(milestone) {
    return milestone?.completion?.flags ?? [];
}

/** Convenience: just the numeric bit-offsets. */
export function flagValues(milestone) {
    return completionFlags(milestone).map((f) => f.value);
}

/** Convenience: just the symbolic flag names. */
export function flagNames(milestone) {
    return completionFlags(milestone).map((f) => f.flag);
}

/**
 * Numeric bit-offset of a flag by symbolic name (for runtime readPlayerFlag).
 * Looks across milestone flags + location flags + the flagBase. Returns
 * undefined if not found.
 */
export function flagBit(flagName) {
    const data = getMilestones();
    for (const m of data.milestones) {
        for (const f of m.completion.flags) {
            if (f.flag === flagName) return f.value;
        }
    }
    for (const f of data.locationFlags ?? []) {
        if (f.flag === flagName) return f.value;
    }
    return undefined;
}

/**
 * Is a milestone complete against a set of set flag ids?
 *
 * @param milestone    the milestone object (or id)
 * @param setFlags     Set<string> of flag names that are currently set, OR a
 *                     predicate (flagName => boolean). A milestone with no
 *                     completion flags (the parcel, tracked by item) is never
 *                     complete by flags alone — returns false with a hint.
 * @param {object} [opts]
 * @param {boolean} [opts.sideFlags] if true, also require sideFlags (the
 *        derived flags like FLAG_PALLET_LADY_NOT_BLOCKING_SIGN) — off by
 *        default since the primary flag is the authoritative signal.
 */
export function isComplete(milestone, setFlags, opts = {}) {
    const ms = typeof milestone === "string" ? resolveMilestone(milestone) : milestone;
    if (!ms) return false;
    const test = typeof setFlags === "function"
        ? (name) => setFlags(name)
        : (name) => setFlags.has(name);
    const flags = completionFlags(ms);
    if (flags.length === 0) {
        // Item-tracked milestone (e.g. Oak's Parcel). No dedicated flag is set
        // when the item is received, so fall back to its `resolvesTo` flag —
        // the flag that fires once the item is *used* (parcel delivered ->
        // Pokédex scene). Until that flag is set, the milestone is incomplete.
        const resolvesTo = ms.completion.item?.resolvesTo;
        return resolvesTo ? test(resolvesTo.flag) : false;
    }
    const done = ms.completion.mode === "any"
        ? flags.some((f) => test(f.flag))
        : flags.every((f) => test(f.flag));
    if (!done || !opts.sideFlags) return done;
    const side = ms.completion.sideFlags ?? [];
    return side.every((f) => test(f.flag));
}

/**
 * Given the currently-set flags, return the furthest milestone reached, the
 * next critical-path target, and any optional side content that's available.
 *
 * Honors the story DAG: a milestone counts as "reached" only if it is complete
 * AND every predecessor (transitively, via requires) is complete. Optional
 * milestones never gate a later required one — an incomplete optional dep is
 * treated as already-satisfied for successors.
 *
 * @param setFlags Set<string> of set flag names, or predicate (flagName => bool)
 * @returns {{
 *   reached: Milestone|null,
 *   next: Milestone|null,                 // next incomplete *non-optional* milestone (critical-path target); null when all required beats are done
 *   availableOptional: Milestone[],      // incomplete optional milestones whose prereqs are satisfied (side content)
 *   progress: number,                     // reached.order / total (0..1) for reward shaping
 * }}
 */
export function currentMilestone(setFlags) {
    const ms = milestones();
    const complete = new Map();
    for (const m of ms) complete.set(m.id, isComplete(m, setFlags));

    // Transitive predecessor completeness. Optional milestones that are
    // incomplete don't block successors (an optional beat can be skipped).
    function prereqsDone(m) {
        return m.requires.every((r) => {
            const dep = resolveMilestone(r);
            if (!dep) return true;
            if (dep.optional && !complete.get(r)) return true; // skip optional gaps
            return complete.get(r);
        });
    }

    let reached = null;
    for (const m of ms) {
        if (complete.get(m.id) && prereqsDone(m)) reached = m;
    }

    let next = null;
    const availableOptional = [];
    for (const m of ms) {
        if (complete.get(m.id)) continue;
        if (!prereqsDone(m)) continue; // gated behind an incomplete required dep
        if (m.optional) {
            availableOptional.push(m);
        } else if (!next) {
            next = m; // first incomplete required milestone in story order
        }
    }

    const progress = reached ? reached.order / ms.length : 0;
    return { reached, next, availableOptional, progress };
}

/**
 * Every flag name the milestone graph needs to evaluate completion: each
 * milestone's completion.flags, its completion.sideFlags, and (for item-tracked
 * milestones with no dedicated flag) its completion.item.resolvesTo.flag.
 * @returns {string[]}
 */
export function allMilestoneFlagNames() {
    const names = new Set();
    for (const m of milestones()) {
        for (const f of m.completion?.flags ?? []) names.add(f.flag);
        for (const f of m.completion?.sideFlags ?? []) names.add(f.flag);
        const resolvesTo = m.completion?.item?.resolvesTo;
        if (resolvesTo?.flag) names.add(resolvesTo.flag);
    }
    return [...names];
}

/**
 * Read every milestone flag through `readFlag(bitOffset)` and return the
 * Set<string> of flag names currently set. A flag whose bit-offset is unknown
 * (flagBit === undefined) is skipped; a single unreadable flag is swallowed
 * (one bad read can't blank the whole eval). This is the input this module's
 * isComplete / currentMilestone consume.
 *
 * Pure given an injected `readFlag` (a `(bitOffset:number) => Promise<boolean>`)
 * — kept here in the pure query layer so both the runtime snapshot (B1's
 * getState) and the eval harness (D4) can use it without either importing the
 * other.
 *
 * @param {(bitOffset:number)=>Promise<boolean>} readFlag
 * @param {string[]} [names] defaults to allMilestoneFlagNames()
 * @returns {Promise<Set<string>>}
 */
export async function readFlagSet(readFlag, names = allMilestoneFlagNames()) {
    const set = new Set();
    for (const name of names) {
        const bit = flagBit(name);
        if (bit === undefined) continue;
        try {
            if (await readFlag(bit)) set.add(name);
        } catch {
            // One unreadable flag must not blank the eval — skip it. The
            // milestone it gates will simply read incomplete this poll.
        }
    }
    return set;
}
