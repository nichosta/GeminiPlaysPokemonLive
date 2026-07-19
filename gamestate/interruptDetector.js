// =============================================================================
// INTERRUPT DETECTOR (B2)
// =============================================================================
//
// Fast polling loop over B1's getState() snapshot with an explicit,
// STOP_REASON-typed classification of why control should return to the model:
// battle started, dialog/cutscene/script (controls locked), warp completed,
// unexpected menu. This is the crux macros (C2-C5) build on: every long-running
// tool call polls this instead of re-inventing its own stop-condition checks.
//
// NOTE: low HP is NOT an interrupt here. It is surfaced as plain text in the D2
// state prompt (see buildStatePrompt.js) so the model can decide to heal —
// interrupting on it blocked the very movement needed to reach a Pokécenter.
// STOP_REASON.HP_LOW remains in the enum for trace/tool-interface stability but
// nothing produces it; the in-battle faint trigger is battlePolicy's own
// about_to_faint, not this detector.
//
// Two layers, same split as B1/C1:
//   - `classifyInterrupt` is pure: given one getState()-shaped snapshot (plus
//     a caller-supplied baseline map identity / expectation flags) it returns
//     a STOP_REASON or null. Fully unit-testable offline against constructed
//     snapshots (interruptDetector.test.js).
//   - `watchForInterrupt` is the live loop: captures a baseline poll, then
//     re-polls on an interval until `classifyInterrupt` fires, a timeout
//     elapses, or an AbortSignal fires. This is the actual "fast polling loop"
//     the plan calls for — usable standalone (C5 dialog-advance, C3 battle
//     waits) or one poll at a time via `classifyInterrupt` directly (C2's
//     per-button-press check, see skills/crossMapRouter.js).
//
// `warp_completed` needs a *baseline* map identity to diff against — unlike
// the boolean fields (battle/dialog/menu), a map bank/number pair has no
// natural "on" state by itself. Callers that expect the map to change as part
// of normal progress (goto's cross-map hops) pass `expectWarp: true` (or omit
// `baselineMap`) so this never fires; callers where a warp is itself the
// interrupt (press escape hatch, menu macros) pass the baseline they polled at
// the start of their macro.
//
// `choice_required`, `out_of_pp`, `about_to_faint`, and `blocked` are NOT
// classified here — they need context this detector doesn't have (a surfaced
// yes/no prompt, battle move data, live NPC positions) and are the C3/C5
// callers' job, per docs/state-snapshot.md.
// =============================================================================

import { getState } from "./getState.js";
import { STOP_REASON } from "../llminteract/toolInterface.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * @typedef {Object} ClassifyOptions
 * @property {boolean} [expectMenu=false] Suppress UNEXPECTED_MENU (caller
 *           intentionally opened the party menu, e.g. a future C4 macro).
 * @property {{bank:number,number:number}|null} [baselineMap=null] Map identity
 *           to diff against for WARP_COMPLETED. Omit to skip warp detection
 *           entirely (the right choice whenever a map change is expected
 *           progress, not an interrupt — e.g. goto's cross-map hops).
 */

/**
 * Classifies ONE getState()-shaped snapshot against B1's documented
 * field -> STOP_REASON mapping (docs/state-snapshot.md). Pure; does no I/O.
 *
 * Priority order (first match wins) follows that table: battle, dialog, warp,
 * menu. A snapshot with an unreadable player position/map can't be classified
 * at all and reports UNKNOWN_STATE ahead of everything else. Low HP is
 * intentionally NOT classified here — see the module docstring.
 *
 * @param {object} state A getState() snapshot.
 * @param {ClassifyOptions} [options]
 * @returns {string|null} A STOP_REASON, or null if nothing warrants an interrupt.
 */
export function classifyInterrupt(state, options = {}) {
    const { expectMenu = false, baselineMap = null } = options;

    if (!state || state.player?.map?.bank == null || state.player?.map?.number == null || state.player?.position?.x == null) {
        return STOP_REASON.UNKNOWN_STATE;
    }
    if (state.battle?.active) {
        return STOP_REASON.BATTLE_STARTED;
    }
    if (state.progress?.controlsLocked) {
        return STOP_REASON.DIALOG;
    }
    if (baselineMap && (state.player.map.bank !== baselineMap.bank || state.player.map.number !== baselineMap.number)) {
        return STOP_REASON.WARP_COMPLETED;
    }
    if (!expectMenu && state.menu?.partyMenuOpen) {
        return STOP_REASON.UNEXPECTED_MENU;
    }
    return null;
}

/**
 * @typedef {Object} WatchOptions
 * @property {() => Promise<object>} [pollState] Snapshot source. Defaults to
 *           B1's fast poll (`getState({ includeMap: false, includeBag: false })`).
 * @property {number} [intervalMs=150] Delay between polls after the baseline.
 * @property {number|null} [timeoutMs=null] Give up and return uninterrupted
 *           after this long. `null` watches indefinitely.
 * @property {boolean} [expectMenu=false]
 * @property {boolean} [expectWarp=false] If true, never fires WARP_COMPLETED
 *           (the baseline map is still captured but not diffed).
 * @property {AbortSignal} [signal] Cooperative cancellation.
 */

/**
 * The live fast-polling loop: takes a baseline snapshot, then re-polls on
 * `intervalMs` until `classifyInterrupt` reports a STOP_REASON, `timeoutMs`
 * elapses, or `signal` aborts. The baseline itself is checked too, so a macro
 * that starts already mid-interrupt (e.g. a battle already active) returns
 * immediately on the first poll rather than waiting a full interval.
 *
 * @param {WatchOptions} [options]
 * @returns {Promise<{interrupted:boolean, stopReason:string|null, state:object}>}
 */
export async function watchForInterrupt(options = {}) {
    const {
        pollState = () => getState({ includeMap: false, includeBag: false }),
        intervalMs = 150,
        timeoutMs = null,
        expectMenu = false,
        expectWarp = false,
        signal,
    } = options;

    const baseline = await pollState();
    const baselineMap =
        !expectWarp && baseline.player?.map?.bank != null && baseline.player?.map?.number != null
            ? { bank: baseline.player.map.bank, number: baseline.player.map.number }
            : null;

    const classifyOptions = { expectMenu, baselineMap };

    const baselineReason = classifyInterrupt(baseline, classifyOptions);
    if (baselineReason) {
        return { interrupted: true, stopReason: baselineReason, state: baseline };
    }

    const start = Date.now();
    let state = baseline;
    while (!signal?.aborted && (timeoutMs == null || Date.now() - start < timeoutMs)) {
        await sleep(intervalMs);
        if (signal?.aborted) break;
        state = await pollState();
        const reason = classifyInterrupt(state, classifyOptions);
        if (reason) {
            return { interrupted: true, stopReason: reason, state };
        }
    }

    return { interrupted: false, stopReason: null, state };
}
