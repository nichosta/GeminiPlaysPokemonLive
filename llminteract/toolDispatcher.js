// =============================================================================
// TOOL DISPATCHER (D2)
// =============================================================================
//
// Maps a frozen D1 tool name + args to an executed macro, returning the
// uniform outcome envelope every tool resolves to (see toolInterface.js). This
// is the seam the rewired agent loop (agent.js) drives: the loop parses the
// model's `tool_calls[0]`, hands `{name, args}` here, and feeds the returned
// envelope back to the model as the next turn's `tool` message.
//
// What is wired vs. what is stubbed tracks the plan's critical path
// (A1→C1→C2→D2): only the macros whose implementations have landed are live.
//   - `goto`            → C2's gotoLive. C5 (advanceDialogLive) and C3
//                          (runBattleLive) are wired INTO gotoLive: a DIALOG
//                          or BATTLE_STARTED interrupt mid-route is auto-
//                          cleared / auto-fought rather than surfaced, so
//                          dialog and battles never reach the model except as
//                          an escalation (choice_required / out_of_pp / …).
//   - `press`           → B3's executeQueue, polled for interrupts per press.
//   - `set_battle_strategy` → records the standing policy in memory; gotoLive
//                          reads it via getBattlePolicy() when a battle
//                          interrupts, so the policy set here is what C3
//                          consumes each fight.
//   - `heal`            → C4's healLive (pokecenter nurse / bag items / auto).
//   - `use_item`        → C4's useItemLive (bag → item → party target).
//
// `press` interrupt policy is intentionally narrower than `goto`'s: the model
// is manually driving an escape hatch (odd menus, cutscenes), so a
// dialog/script lock or an open menu is expected, NOT an interrupt — pressing
// A through dialog is the whole point. We only stop early on the things the
// model can't keep pressing through: a battle starting, the map changing
// (warp), or HP dropping low. (If we stopped on `dialog` the moment the model
// pressed A to advance a text box, the escape hatch would be useless.)
//
// All live transports (gotoLive, executeQueue, getState, classifyInterrupt)
// are injectable so toolDispatcher.test.js exercises the dispatch logic
// offline with fakes — no emulator, no network.
// =============================================================================

import {
    makeOutcome,
    OUTCOME_STATUS,
    STOP_REASON,
    TOOLS_BY_NAME,
} from "./toolInterface.js";

/** Closed button enum the `press` tool accepts (mirrors D1's schema). */
const PRESS_BUTTONS = Object.freeze(
    new Set(["a", "b", "l", "r", "start", "select", "up", "down", "left", "right"])
);

// --- Standing battle policy (set_battle_strategy) ---------------------------
// Holds whatever the model sets so gotoLive can pass it to C3's runBattleLive
// when a battle interrupts a goto (the policy is the per-fight decision input
// C3 consumes each turn). Defaults mirror D1's documented defaults.
let battlePolicy = Object.freeze({
    strategy: "default",
    lead: null,
    catch_all_pokemon: false,
});

/**
 * @returns {object} A copy of the standing battle policy.
 */
export function getBattlePolicy() {
    return { ...battlePolicy };
}

/**
 * Default dependency bundle: the real C2 / B3 / B1 / B2 transports. Lazily
 * imported so the module is loadable in a test environment that stubs these
 * out (and so `agent.js` overriding `deps` doesn't pay for unused imports).
 * @returns {Promise<object>}
 */
async function defaultDeps() {
    const [
        { gotoLive },
        { executeQueue },
        { getState },
        { classifyInterrupt },
        { healLive, useItemLive },
        { runBattleLive },
    ] = await Promise.all([
        import("../skills/crossMapRouter.js"),
        import("../tools/inputExecutor.js"),
        import("../gamestate/getState.js"),
        import("../gamestate/interruptDetector.js"),
        import("../skills/menuMacros.js"),
        import("../skills/battlePolicy.js"),
    ]);
    return { gotoLive, executeQueue, getState, classifyInterrupt, healLive, useItemLive, runBattleLive };
}

/**
 * Coerce a `destination` arg into the documented `{location}` / `{map?,x,y}`
 * shape. Live runs against small/cheap models show they frequently ignore the
 * nested-object schema and send a bare string instead — a plain location name
 * ("Pallet Town"), a "x,y" coordinate pair ("12,11"), a "map,x,y" triple
 * ("MAP_PALLET_TOWN,12,11"), or the same coordinate pair wrapped in brackets
 * ("[2, 4]", "(21, 34)" — observed live 2026-07-19, this shape previously fell
 * through to the location branch and failed "could not resolve destination",
 * and the model gave up retrying goto and fell back to manually pressing
 * directional buttons instead). Rather than hard-failing on the shape
 * mismatch (which just burns a turn on the same invalid_args error repeatedly
 * — models do not reliably recover from it), interpret these as the doc-shape
 * the model evidently meant. Anything already object-shaped passes through
 * untouched.
 * @param {*} destination
 * @returns {*} the original value, or a normalized `{location}` / `{map,x,y}` object
 */
function normalizeGotoDestination(destination) {
    if (typeof destination !== "string") return destination;
    const trimmed = destination.trim();
    // Strip one layer of wrapping brackets/parens before the coordinate parse
    // (a bracket-wrapped non-coordinate string still falls through to the
    // location branch below using the ORIGINAL trimmed text, untouched).
    let unwrapped = trimmed;
    if (trimmed.length >= 2) {
        const first = trimmed[0];
        const last = trimmed[trimmed.length - 1];
        if ((first === "[" && last === "]") || (first === "(" && last === ")")) {
            unwrapped = trimmed.slice(1, -1).trim();
        }
    }
    const parts = unwrapped.split(",").map((p) => p.trim());
    if (parts.length === 2 && parts.every((p) => /^-?\d+$/.test(p))) {
        return { x: Number(parts[0]), y: Number(parts[1]) };
    }
    if (parts.length === 3 && /^-?\d+$/.test(parts[1]) && /^-?\d+$/.test(parts[2])) {
        return { map: parts[0], x: Number(parts[1]), y: Number(parts[2]) };
    }
    return { location: trimmed };
}

/**
 * Validate + execute a `goto` tool call via C2's gotoLive.
 * @param {object} args
 * @param {object} deps
 * @returns {Promise<object>} outcome envelope
 */
async function dispatchGoto(args, deps) {
    const destination = normalizeGotoDestination(args?.destination);
    if (!destination || (typeof destination.location !== "string" && (typeof destination.x !== "number" || typeof destination.y !== "number"))) {
        return makeOutcome(OUTCOME_STATUS.FAILED, {
            stopReason: STOP_REASON.INVALID_ARGS,
            message: "goto requires destination {location} or {map?,x,y}",
        });
    }
    const options = {
        maxSteps: typeof args.max_steps === "number" ? args.max_steps : 400,
        // A2's sightline tiles aren't computed yet (downstream per plan.md),
        // so avoid_trainers is accepted but currently a no-op flag.
        avoidTiles: undefined,
        // Standing policies so gotoLive can auto-drive the interrupts the
        // harness owns: C5 clears DIALOG, C3 fights BATTLE_STARTED, each
        // using the policy the model last set via set_battle_strategy (and
        // the default dialog choice). Surfacing to the model happens only on
        // a sub-handler escalation (choice_required / out_of_pp / …).
        battlePolicy: getBattlePolicy(),
        dialogPolicy: { choice: "ask" },
    };
    try {
        return await deps.gotoLive(destination, options);
    } catch (error) {
        return makeOutcome(OUTCOME_STATUS.FAILED, {
            stopReason: STOP_REASON.UNKNOWN_STATE,
            message: `goto threw: ${error?.message ?? String(error)}`,
        });
    }
}

/**
 * Validate + execute a `press` (escape hatch) tool call via B3's executeQueue,
 * polling for interrupts after each press. See module docstring for the
 * deliberately-narrow interrupt policy (battle-start / warp / hp-low only).
 * @param {object} args
 * @param {object} deps
 * @returns {Promise<object>} outcome envelope
 */
async function dispatchPress(args, deps) {
    const buttons = Array.isArray(args?.buttons) ? args.buttons : [];
    if (buttons.length === 0) {
        return makeOutcome(OUTCOME_STATUS.FAILED, {
            stopReason: STOP_REASON.INVALID_ARGS,
            message: "press requires a non-empty buttons[] array",
        });
    }
    for (const b of buttons) {
        if (typeof b !== "string" || !PRESS_BUTTONS.has(b)) {
            return makeOutcome(OUTCOME_STATUS.FAILED, {
                stopReason: STOP_REASON.INVALID_ARGS,
                message: `press buttons must be from the closed enum; got: ${JSON.stringify(b)}`,
            });
        }
    }
    const cap = Math.min(
        typeof args.max_steps === "number" ? args.max_steps : buttons.length,
        buttons.length
    );
    const list = buttons.slice(0, Math.max(0, cap));
    if (list.length === 0) {
        return makeOutcome(OUTCOME_STATUS.OK, { stepsUsed: 0, message: "press: nothing to send (max_steps=0)" });
    }

    const poll = deps.getState ?? ((() => null));

    // Baseline for the transition-style interrupts: we only stop on
    // battle/warp changes, NOT on a dialog lock the model walked into. Low HP
    // is NOT a press interrupt (it would block the walk to a Pokécenter); the
    // state prompt surfaces HP as plain text instead.
    let baseline;
    try {
        baseline = await poll();
    } catch {
        baseline = null;
    }
    const wasInBattle = !!(baseline && baseline.battle && baseline.battle.active);
    const baseMap = baseline && baseline.player && baseline.player.map
        ? { bank: baseline.player.map.bank, number: baseline.player.map.number }
        : null;

    let stopReason = null;
    let stepsUsed = 0;
    try {
        const result = await deps.executeQueue(list, {
            onStep: async () => {
                let st = null;
                try {
                    st = await poll();
                } catch {
                    st = null;
                }
                if (!st) return false;
                // Battle started (false -> true) mid-sequence.
                if (!wasInBattle && st.battle && st.battle.active) {
                    stopReason = STOP_REASON.BATTLE_STARTED;
                    return true;
                }
                // Map changed mid-sequence (a warp the model pressed into).
                if (
                    baseMap &&
                    st.player && st.player.map &&
                    (st.player.map.bank !== baseMap.bank || st.player.map.number !== baseMap.number)
                ) {
                    stopReason = STOP_REASON.WARP_COMPLETED;
                    return true;
                }
                return false;
            },
        });
        stepsUsed = result?.stepsUsed ?? 0;
        if (result?.error && !stopReason) {
            return makeOutcome(OUTCOME_STATUS.FAILED, {
                stopReason: STOP_REASON.UNKNOWN_STATE,
                stepsUsed,
                message: `press transport error: ${result.error}`,
            });
        }
    } catch (error) {
        return makeOutcome(OUTCOME_STATUS.FAILED, {
            stopReason: STOP_REASON.UNKNOWN_STATE,
            stepsUsed,
            message: `press threw: ${error?.message ?? String(error)}`,
        });
    }

    if (stopReason) {
        return makeOutcome(OUTCOME_STATUS.INTERRUPTED, {
            stopReason: stopReason,
            stepsUsed,
            message: `press interrupted: ${stopReason}`,
        });
    }
    return makeOutcome(OUTCOME_STATUS.OK, {
        stepsUsed,
        message: `pressed ${list.length} button${list.length === 1 ? "" : "s"} (${list.join(",")})`,
    });
}

/**
 * Record a standing battle policy (C3 pending). Validates the strategy enum.
 * @param {object} args
 * @returns {Promise<object>} outcome envelope (always OK once args are valid)
 */
async function dispatchSetBattleStrategy(args) {
    const strategy = args?.strategy;
    const allowed = TOOLS_BY_NAME.set_battle_strategy.parameters.properties.strategy.enum;
    if (!allowed.includes(strategy)) {
        return makeOutcome(OUTCOME_STATUS.FAILED, {
            stopReason: STOP_REASON.INVALID_ARGS,
            message: `set_battle_strategy: strategy must be one of ${allowed.join(", ")}`,
        });
    }
    battlePolicy = Object.freeze({
        strategy,
        lead: typeof args.lead === "string" ? args.lead : null,
        catch_all_pokemon: typeof args.catch_all_pokemon === "boolean" ? args.catch_all_pokemon : false,
    });
    return makeOutcome(OUTCOME_STATUS.OK, {
        stepsUsed: 0,
        message: `battle policy set: strategy=${strategy} lead=${battlePolicy.lead ?? "-"} catch_all_pokemon=${battlePolicy.catch_all_pokemon} (consumed by runBattleLive when a battle interrupts goto or you call fight_battle)`,
    });
}

/**
 * Validate + execute a `heal` tool call via C4's healLive. `method` is
 * validated against D1's HEAL_METHOD enum; invalid -> FAILED/invalid_args.
 * @param {object} args
 * @param {object} deps
 * @returns {Promise<object>} outcome envelope
 */
async function dispatchHeal(args, deps) {
    const allowed = TOOLS_BY_NAME.heal.parameters.properties.method.enum;
    const method = args?.method ?? "auto";
    if (!allowed.includes(method)) {
        return makeOutcome(OUTCOME_STATUS.FAILED, {
            stopReason: STOP_REASON.INVALID_ARGS,
            message: `heal: method must be one of ${allowed.join(", ")}`,
        });
    }
    const maxSteps = typeof args.max_steps === "number" ? args.max_steps : 400;
    try {
        return await deps.healLive({ method, max_steps: maxSteps }, {});
    } catch (error) {
        return makeOutcome(OUTCOME_STATUS.FAILED, {
            stopReason: STOP_REASON.UNKNOWN_STATE,
            message: `heal threw: ${error?.message ?? String(error)}`,
        });
    }
}

/**
 * Validate + execute a `use_item` tool call via C4's useItemLive. `item` is
 * required; `target_slot` (0-5) and `quantity` (1-99) are bounded per D1.
 * @param {object} args
 * @param {object} deps
 * @returns {Promise<object>} outcome envelope
 */
async function dispatchUseItem(args, deps) {
    const item = args?.item;
    if (typeof item !== "string" || !item.trim()) {
        return makeOutcome(OUTCOME_STATUS.FAILED, {
            stopReason: STOP_REASON.INVALID_ARGS,
            message: "use_item requires an item name (string)",
        });
    }
    if (args.target_slot != null && (typeof args.target_slot !== "number" || args.target_slot < 0 || args.target_slot > 5)) {
        return makeOutcome(OUTCOME_STATUS.FAILED, {
            stopReason: STOP_REASON.INVALID_ARGS,
            message: "use_item target_slot must be an integer 0-5",
        });
    }
    let quantity = typeof args.quantity === "number" ? args.quantity : 1;
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
        return makeOutcome(OUTCOME_STATUS.FAILED, {
            stopReason: STOP_REASON.INVALID_ARGS,
            message: "use_item quantity must be an integer 1-99",
        });
    }
    try {
        return await deps.useItemLive({ item, targetSlot: args.target_slot, quantity }, {});
    } catch (error) {
        return makeOutcome(OUTCOME_STATUS.FAILED, {
            stopReason: STOP_REASON.UNKNOWN_STATE,
            message: `use_item threw: ${error?.message ?? String(error)}`,
        });
    }
}

/**
 * Validate + execute a `fight_battle` tool call via C3's runBattleLive. Uses
 * the standing policy (set_battle_strategy) unless a one-off `strategy`
 * override is given. Precondition: a battle must be active — runBattleLive
 * itself returns OK/"no active battle" when there isn't one; we surface that
 * as precondition_failed so the model doesn't read it as a fought battle.
 * @param {object} args
 * @param {object} deps
 * @returns {Promise<object>} outcome envelope
 */
async function dispatchFightBattle(args, deps) {
    const allowed = TOOLS_BY_NAME.fight_battle.parameters.properties.strategy.enum;
    if (args?.strategy != null && !allowed.includes(args.strategy)) {
        return makeOutcome(OUTCOME_STATUS.FAILED, {
            stopReason: STOP_REASON.INVALID_ARGS,
            message: `fight_battle: strategy must be one of ${allowed.join(", ")}`,
        });
    }
    const policy = args?.strategy
        ? { ...getBattlePolicy(), strategy: args.strategy }
        : getBattlePolicy();
    const maxSteps = typeof args?.max_steps === "number" ? args.max_steps : 200;
    try {
        const out = await deps.runBattleLive(policy, { maxSteps });
        if (out.status === OUTCOME_STATUS.OK && out.message === "no active battle") {
            return makeOutcome(OUTCOME_STATUS.FAILED, {
                stopReason: STOP_REASON.PRECONDITION_FAILED,
                message: "fight_battle: no battle is active",
            });
        }
        return out;
    } catch (error) {
        return makeOutcome(OUTCOME_STATUS.FAILED, {
            stopReason: STOP_REASON.UNKNOWN_STATE,
            message: `fight_battle threw: ${error?.message ?? String(error)}`,
        });
    }
}

/**
 * Dispatch a frozen D1 tool call to its implementation.
 *
 * @param {string} name Tool name (must be in TOOLS_BY_NAME).
 * @param {object} args Parsed tool arguments.
 * @param {object} [deps] Injectable transports for testing:
 *        { gotoLive, executeQueue, getState, classifyInterrupt }.
 *        Missing entries fall back to the real ones (lazily imported).
 * @returns {Promise<object>} A makeOutcome() envelope.
 */
export async function dispatchTool(name, args, deps = {}) {
    if (!TOOLS_BY_NAME[name]) {
        return makeOutcome(OUTCOME_STATUS.FAILED, {
            stopReason: STOP_REASON.INVALID_ARGS,
            message: `unknown tool: ${name}`,
        });
    }

    // Fill in real transports only for the tools that need them, and only if
    // the caller didn't inject a fake. Keeps tests stub-free for set_battle_strategy.
    if (name === "goto" || name === "press" || name === "heal" || name === "use_item" || name === "fight_battle") {
        if (!deps.gotoLive || !deps.executeQueue || !deps.getState || !deps.classifyInterrupt || !deps.healLive || !deps.useItemLive || !deps.runBattleLive) {
            const real = await defaultDeps();
            deps = { ...real, ...deps };
        }
    }

    switch (name) {
        case "goto":
            return dispatchGoto(args, deps);
        case "press":
            return dispatchPress(args, deps);
        case "set_battle_strategy":
            return dispatchSetBattleStrategy(args);
        case "heal":
            return dispatchHeal(args, deps);
        case "use_item":
            return dispatchUseItem(args, deps);
        case "fight_battle":
            return dispatchFightBattle(args, deps);
        default:
            return makeOutcome(OUTCOME_STATUS.FAILED, {
                stopReason: STOP_REASON.INVALID_ARGS,
                message: `tool not dispatchable: ${name}`,
            });
    }
}
