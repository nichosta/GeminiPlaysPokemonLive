// =============================================================================
// DIALOG HANDLER (C5)
// =============================================================================
//
// Advances in-game text/cutscene/script dialog and resolves yes/no prompts,
// surfacing a CHOICE_REQUIRED interrupt to the model only when it can't blast
// through on its own. This is the C5 implementation behind the frozen tool
// interface's design note (docs/tool-interface.md, "What is intentionally NOT a
// tool"): there is no `talk`/`interact` tool — advancing dialog and surfacing
// yes/no choices happens *automatically inside a macro* and surfaces as a
// `choice_required` interrupt, never as a separate model tool.
//
// Two layers, same split as C1 (pathfinding.js) / C2 (crossMapRouter.js) / C3
// (battlePolicy.js):
//   - `decideDialogAction` is PURE: given one B1 snapshot + the standing dialog
//     policy + a step counter, it returns the next action (press a button,
//     declare done, or escalate with a STOP_REASON). It delegates the
//     interrupt *priority* to B2's `classifyInterrupt` so the stop-condition
//     vocabulary stays unified (battle/dialog/menu/hp/unknown) — C5 only owns
//     the dialog-specific layer on top: which button to mash, and the
//     budget-exhausted -> CHOICE_REQUIRED escalation that B2 deliberately
//     leaves to this handler (see docs/state-snapshot.md).
//   - `advanceDialogLive` is the live adapter: polls B1's getState(), asks
//     `decideDialogAction`, executes the returned press through B3's
//     inputExecutor, and returns a D1 `makeOutcome(...)` envelope — escalating
//     verbatim when the core says to. Mirrors C3's runBattleLive contract.
//
// Standing dialog policy — `choice: "yes" | "no" | "ask"`:
//   ask  (default) — mash A to advance text; surface to the model if a prompt
//                    can't be cleared in the step budget (almost certainly a
//                    yes/no or selection the snapshot can't read directly).
//   yes           — mash A; on a Gen-3 yes/no box the cursor opens on YES, so A
//                    confirms YES and clears the box automatically (the
//                    "apply a default policy" path: auto-answer yes to e.g.
//                    nurse/heal confirmations).
//   no            — mash B; on a Gen-3 yes/no box B cancels (= NO), and B also
//                    advances plain text boxes, so the loop never stalls on a
//                    non-interactive box waiting for A.
//
// KNOWN RUNTIME GAP (mirrors C3's enemy-side / cursor-gap notes): B1's snapshot
// carries no yes/no-prompt field — the deprecated partyMenu reader
// (gamestate/menustate/partyMenu.js) is the closest thing and it is documented
// as unreliable. So this handler CANNOT pre-detect a yes/no box and stop before
// answering it: it only detects "controls still locked after the step budget"
// -> CHOICE_REQUIRED. Under `ask`/`yes` that budget-mash will have confirmed
// YES on any yes/no box encountered (A = default-YES); under `no` it will have
// answered NO (B = cancel). Making `ask` truly surface a yes/no *before*
// answering needs a yes/no-prompt RAM read, which is downstream B-work (the
// plan's C5 only needs A1-A3 + B1-B3; no such reader is in B1's snapshot). The
// pure core + envelope contract are fully exercised offline here regardless.
// =============================================================================

import { classifyInterrupt } from "../gamestate/interruptDetector.js";
import { makeOutcome, OUTCOME_STATUS, STOP_REASON } from "../llminteract/toolInterface.js";

/** Default step budget for a dialog-advance macro (one step == one press). */
const DEFAULT_MAX_STEPS = 60;

/** Default HP fraction at/below which HP_LOW surfaces mid-dialog. */
const DEFAULT_HP_THRESHOLD = 0.2;

/** Frames to let each text box advance before re-pressing. Pokémon draws text
 *  slowly; too few frames and a press lands before the next box is ready. */
const DEFAULT_PRESS_SETTLE_FRAMES = 4;

/**
 * The button to mash for a given `choice` policy. A is the universal text
 * advancer and confirms YES (cursor default); B advances text and cancels
 * (= NO) on yes/no boxes.
 * @param {"yes"|"no"|"ask"} choice
 * @returns {"a"|"b"}
 */
function buttonForChoice(choice) {
    return choice === "no" ? "b" : "a";
}

/**
 * @typedef {Object} DialogPolicy
 * @property {"yes"|"no"|"ask"} [choice="ask"] Default answer to apply when a
 *           yes/no box is encountered. `ask` surfaces to the model (via the
 *           budget-exhausted -> CHOICE_REQUIRED path); `yes`/`no` auto-answer.
 */

/**
 * PURE dialog decision. Given one B1 snapshot, the standing dialog policy, and a
 * step counter, returns the next action for the live adapter to take.
 *
 * Delegates interrupt priority to B2's `classifyInterrupt` (battle > dialog >
 * warp > hp > menu > unknown), so every stop condition except the dialog-
 * specific ones surfaces verbatim. The dialog layer only adds: which button to
 * press while locked, and the budget-exhausted -> CHOICE_REQUIRED escalation.
 *
 * @param {object} state A B1 getState() snapshot.
 * @param {DialogPolicy} [policy]
 * @param {object} context
 * @param {number} context.pressesUsed Presses sent so far against the budget.
 * @param {number} context.maxPresses Budget cap; at this many presses still
 *        locked -> CHOICE_REQUIRED.
 * @param {number} [context.hpThreshold=0.2]
 * @param {boolean} [context.expectMenu=false] Forwarded to classifyInterrupt.
 * @param {function} [classify=classifyInterrupt] Injectable classifier (test hook).
 * @returns {{kind:"press", button:"a"|"b", reason:string}
 *          | {kind:"done", reason:string}
 *          | {kind:"escalate", stopReason:string, reason:string}}
 */
export function decideDialogAction(state, policy = {}, context, classify = classifyInterrupt) {
    const { pressesUsed, maxPresses, hpThreshold = DEFAULT_HP_THRESHOLD, expectMenu = false } = context || {};
    const choice = policy.choice === "yes" || policy.choice === "no" ? policy.choice : "ask";

    const reason = classify(state, { hpThreshold, expectMenu, baselineMap: null });

    // null => controls unlocked and no interrupt: dialog cleared (or nothing
    // was locked to begin with). Hand back control cleanly.
    if (reason === null) {
        return { kind: "done", reason: "controls unlocked; dialog cleared" };
    }

    // In dialog (controls locked): either press on or surface the choice.
    if (reason === STOP_REASON.DIALOG) {
        if (typeof pressesUsed === "number" && typeof maxPresses === "number" && pressesUsed >= maxPresses) {
            return {
                kind: "escalate",
                stopReason: STOP_REASON.CHOICE_REQUIRED,
                reason: `dialog still locked after ${pressesUsed}/${maxPresses} presses; a yes/no or selection prompt the snapshot can't read is likely blocking`,
            };
        }
        return { kind: "press", button: buttonForChoice(choice), reason: `mash ${buttonForChoice(choice)} (choice=${choice})` };
    }

    // Anything else (battle_started / warp_completed / hp_low / unexpected_menu
    // / unknown_state) is the model's to handle — surface verbatim, same
    // vocabulary as every other macro.
    return { kind: "escalate", stopReason: reason, reason: `dialog interrupted: ${reason}` };
}

// =============================================================================
// LIVE ADAPTER
// =============================================================================

/**
 * Live dialog driver: while the controls are locked by dialog/cutscene/script,
 * polls B1's getState(), asks the pure `decideDialogAction` for the next press,
 * executes it through B3's inputExecutor (serialized + frame-accurate), and
 * returns a D1 `makeOutcome(...)` envelope — escalating exactly when the core
 * says to (battle/menu/hp/unknown mid-mash, or CHOICE_REQUIRED when the budget
 * runs out before the dialog clears).
 *
 * See the module docstring for the yes/no-detection runtime gap: this clears
 * plain dialog and auto-answers yes/no per `policy.choice`, but cannot pre-
 * surface a yes/no before answering it without a yes/no-prompt RAM read.
 *
 * @param {DialogPolicy} [policy]
 * @param {object} [options]
 * @param {number} [options.maxSteps=60] Step budget (one step == one press).
 * @param {number} [options.hpThreshold=0.2]
 * @param {number} [options.pressSettleFrames=4] Frames to settle after each tap.
 * @param {() => Promise<object>} [options.pollState] Snapshot source (defaults
 *        to B1's fast poll).
 * @param {object} [options.io] Injectable transport forwarded to executeQueue.
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<object>} A `makeOutcome(...)` envelope.
 */
export async function advanceDialogLive(policy = {}, options = {}) {
    const {
        maxSteps = DEFAULT_MAX_STEPS,
        hpThreshold = DEFAULT_HP_THRESHOLD,
        pressSettleFrames = DEFAULT_PRESS_SETTLE_FRAMES,
        pollState = () => import("../gamestate/getState.js").then((m) => m.getState({ includeMap: false, includeBag: false })),
        io,
        signal,
    } = options;

    const { executeQueue } = await import("../tools/inputExecutor.js");

    let pressesUsed = 0;
    let state = await pollState();
    let lastState = state;

    for (;;) {
        if (signal?.aborted) {
            return makeOutcome(OUTCOME_STATUS.INTERRUPTED, {
                stopReason: STOP_REASON.NONE,
                stepsUsed: pressesUsed,
                message: "dialog advance aborted",
            });
        }

        const decision = decideDialogAction(
            state,
            policy,
            { pressesUsed, maxPresses: maxSteps, hpThreshold, expectMenu: false }
        );

        if (decision.kind === "done") {
            return makeOutcome(OUTCOME_STATUS.OK, {
                stepsUsed: pressesUsed,
                message: decision.reason,
            });
        }

        if (decision.kind === "escalate") {
            const status = decision.stopReason === STOP_REASON.UNKNOWN_STATE
                ? OUTCOME_STATUS.FAILED
                : OUTCOME_STATUS.INTERRUPTED;
            return makeOutcome(status, {
                stopReason: decision.stopReason,
                stepsUsed: pressesUsed,
                message: decision.reason,
            });
        }

        // decision.kind === "press": send one tap, settle, re-poll, loop.
        const res = await executeQueue([decision.button], {
            io,
            signal,
            tapSettleFrames: pressSettleFrames,
        });
        if (res.error) {
            return makeOutcome(OUTCOME_STATUS.FAILED, {
                stopReason: STOP_REASON.UNKNOWN_STATE,
                stepsUsed: pressesUsed,
                message: `dialog press failed: ${res.error}`,
            });
        }
        pressesUsed += res.stepsUsed || 1;
        lastState = state;
        state = await pollState();
        // Loop: decideDialogAction on the new state either presses again,
        // declares done (controls unlocked), or escalates (budget / interrupt).
        void lastState;
    }
}
