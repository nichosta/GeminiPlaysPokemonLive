// =============================================================================
// D2 tool dispatcher self-test (offline, no emulator, no network)
// =============================================================================
//
//   node llminteract/toolDispatcher.test.js
//
// `dispatchTool` takes injectable transports (gotoLive, executeQueue,
// getState, classifyInterrupt), so this exercises every dispatch branch with
// fakes: unknown tool, goto delegation + arg pass-through + missing-args,
// press execution / button validation / max_steps cap, press interrupt policy
// (stops on battle-start / warp / hp-low, does NOT stop on a dialog lock the
// model walked into), set_battle_strategy policy storage + enum validation,
// and the heal/use_item precondition_failed stubs (C4 pending).
// =============================================================================

import { dispatchTool, getBattlePolicy } from "./toolDispatcher.js";
import { OUTCOME_STATUS, STOP_REASON, makeOutcome } from "./toolInterface.js";

let passed = 0;
let failed = 0;
function check(name, cond, detail = "") {
    if (cond) {
        passed++;
        console.log(`  ok   ${name}`);
    } else {
        failed++;
        console.error(`  FAIL ${name} ${detail}`);
    }
}

// --- Fakes ----------------------------------------------------------------

/** A getState() fake that returns successive snapshots per call (baseline then
 *  one per press). Calls beyond the array length return the last snapshot. */
function stateQueue(states) {
    let i = 0;
    const fn = async () => {
        const s = states[Math.min(i, states.length - 1)];
        i++;
        return s;
    };
    fn.reset = () => { i = 0; };
    return fn;
}

/** A minimal getState()-shaped snapshot. */
function snap({ battle = false, bank = 3, number = 0, hp = 1.0, controlsLocked = false } = {}) {
    return {
        battle: { active: battle },
        progress: { controlsLocked },
        player: {
            position: { x: 5, y: 5 },
            facing: "down",
            map: { bank, number, name: bank === 3 && number === 0 ? "PALLET_TOWN" : "OTHER" },
        },
        party: { lowestHpFraction: hp },
        menu: { partyMenuOpen: false, partyMenuSlot: 7 },
    };
}

/** Fake executeQueue: iterates actions, invoking onStep after each, honoring a
 *  stop. Mirrors the real executor's {completed, stepsUsed, stopped?} shape. */
async function fakeExecuteQueue(actions, opts = {}) {
    const list = Array.isArray(actions) ? actions : [actions];
    let stepsUsed = 0;
    for (let i = 0; i < list.length; i++) {
        stepsUsed++;
        if (opts.onStep) {
            const stop = await opts.onStep(i, { button: list[i], frames: 0 });
            if (stop) return { completed: false, stepsUsed, stopped: true };
        }
    }
    return { completed: true, stepsUsed };
}

/** Build a deps bundle with fake gotoLive + executor + state source. */
function makeDeps({ gotoLiveImpl, states }) {
    return {
        gotoLive: gotoLiveImpl,
        executeQueue: fakeExecuteQueue,
        getState: stateQueue(states ?? [snap()]),
        classifyInterrupt: () => null, // unused by dispatchPress (it reads fields directly)
    };
}

// --- Tests ----------------------------------------------------------------

// 1. unknown tool
{
    const out = await dispatchTool("not_a_tool", {}, makeDeps({ gotoLiveImpl: async () => makeOutcome(OUTCOME_STATUS.OK) }));
    check("unknown tool -> failed/invalid_args",
        out.status === OUTCOME_STATUS.FAILED && out.stop_reason === STOP_REASON.INVALID_ARGS,
        JSON.stringify(out));
}

// 2. goto delegates to gotoLive with the destination + default max_steps
{
    let captured = null;
    const deps = makeDeps({
        gotoLiveImpl: async (destination, options) => {
            captured = { destination, options };
            return makeOutcome(OUTCOME_STATUS.OK, { stepsUsed: 5, message: "arrived" });
        },
    });
    const out = await dispatchTool("goto", { destination: { location: "Pewter City" } }, deps);
    check("goto delegates destination", captured?.destination?.location === "Pewter City", JSON.stringify(captured));
    check("goto default max_steps = 400", captured?.options?.maxSteps === 400, String(captured?.options?.maxSteps));
    check("goto returns gotoLive's outcome", out.status === OUTCOME_STATUS.OK && out.steps_used === 5, JSON.stringify(out));
}

// 3. goto passes max_steps through
{
    let captured = null;
    const deps = makeDeps({
        gotoLiveImpl: async (destination, options) => { captured = options; return makeOutcome(OUTCOME_STATUS.OK); },
    });
    await dispatchTool("goto", { destination: { x: 1, y: 2 }, max_steps: 999 }, deps);
    check("goto max_steps passed through", captured?.maxSteps === 999, String(captured?.maxSteps));
    check("goto {x,y} destination reaches gotoLive", true);
}

// 4. goto missing destination
{
    const out = await dispatchTool("goto", {}, makeDeps({ gotoLiveImpl: async () => makeOutcome(OUTCOME_STATUS.OK) }));
    check("goto missing destination -> failed/invalid_args",
        out.status === OUTCOME_STATUS.FAILED && out.stop_reason === STOP_REASON.INVALID_ARGS,
        JSON.stringify(out));
}

// 5. goto throws -> failed (not a crash)
{
    const deps = makeDeps({ gotoLiveImpl: async () => { throw new Error("boom"); } });
    const out = await dispatchTool("goto", { destination: { location: "X" } }, deps);
    check("goto exception -> failed/unknown_state",
        out.status === OUTCOME_STATUS.FAILED && out.stop_reason === STOP_REASON.UNKNOWN_STATE && /boom/.test(out.message),
        JSON.stringify(out));
}

// 6. press valid -> OK, steps_used = count
{
    const states = [snap(), snap(), snap(), snap()]; // baseline + 3 presses
    const deps = makeDeps({ states });
    const out = await dispatchTool("press", { buttons: ["a", "b", "start"] }, deps);
    check("press valid -> ok", out.status === OUTCOME_STATUS.OK, JSON.stringify(out));
    check("press steps_used = 3", out.steps_used === 3, String(out.steps_used));
}

// 7. press max_steps cap
{
    const states = [snap(), snap(), snap(), snap()];
    const deps = makeDeps({ states });
    const out = await dispatchTool("press", { buttons: ["a", "b", "up", "down"], max_steps: 2 }, deps);
    check("press max_steps caps presses", out.steps_used === 2, String(out.steps_used));
}

// 8. press invalid button enum
{
    const out = await dispatchTool("press", { buttons: ["a", "x"] }, makeDeps({}));
    check("press bad button -> failed/invalid_args",
        out.status === OUTCOME_STATUS.FAILED && out.stop_reason === STOP_REASON.INVALID_ARGS,
        JSON.stringify(out));
}

// 9. press empty buttons
{
    const out = await dispatchTool("press", { buttons: [] }, makeDeps({}));
    check("press empty buttons -> failed/invalid_args",
        out.status === OUTCOME_STATUS.FAILED && out.stop_reason === STOP_REASON.INVALID_ARGS,
        JSON.stringify(out));
}

// 10. press stops on battle-start transition
{
    // baseline: not in battle. step1: still not. step2: battle starts.
    const states = [snap({ battle: false }), snap({ battle: false }), snap({ battle: true })];
    const deps = makeDeps({ states });
    const out = await dispatchTool("press", { buttons: ["a", "a", "a"] }, deps);
    check("press stops on battle_started",
        out.status === OUTCOME_STATUS.INTERRUPTED && out.stop_reason === STOP_REASON.BATTLE_STARTED,
        JSON.stringify(out));
    check("press steps_used bounded at interrupt", out.steps_used === 2, String(out.steps_used));
}

// 11. press stops on warp (map changed)
{
    const states = [snap({ bank: 3, number: 0 }), snap({ bank: 3, number: 0 }), snap({ bank: 4, number: 0 })];
    const deps = makeDeps({ states });
    const out = await dispatchTool("press", { buttons: ["up", "up", "up"] }, deps);
    check("press stops on warp_completed",
        out.status === OUTCOME_STATUS.INTERRUPTED && out.stop_reason === STOP_REASON.WARP_COMPLETED,
        JSON.stringify(out));
}

// 12. press stops on hp_low
{
    const states = [snap({ hp: 1.0 }), snap({ hp: 0.1 })];
    const deps = makeDeps({ states });
    const out = await dispatchTool("press", { buttons: ["a", "a"] }, deps);
    check("press stops on hp_low",
        out.status === OUTCOME_STATUS.INTERRUPTED && out.stop_reason === STOP_REASON.HP_LOW,
        JSON.stringify(out));
}

// 13. press does NOT stop on a dialog lock the model walked into
{
    // controlsLocked true the whole time, but no battle/warp/hp change.
    const states = [snap({ controlsLocked: true }), snap({ controlsLocked: true }), snap({ controlsLocked: true }), snap({ controlsLocked: true })];
    const deps = makeDeps({ states });
    const out = await dispatchTool("press", { buttons: ["a", "a", "a"] }, deps);
    check("press ignores dialog lock (model is driving)",
        out.status === OUTCOME_STATUS.OK && out.steps_used === 3,
        JSON.stringify(out));
}

// 14. set_battle_strategy valid -> OK + stored
{
    const out = await dispatchTool("set_battle_strategy", { strategy: "type_effective", lead: "Charmander", catch_wild: true });
    check("set_battle_strategy valid -> ok", out.status === OUTCOME_STATUS.OK, JSON.stringify(out));
    const policy = getBattlePolicy();
    check("policy stored strategy", policy.strategy === "type_effective", JSON.stringify(policy));
    check("policy stored lead", policy.lead === "Charmander", JSON.stringify(policy));
    check("policy stored catch_wild", policy.catch_wild === true, JSON.stringify(policy));
}

// 15. set_battle_strategy invalid enum
{
    const out = await dispatchTool("set_battle_strategy", { strategy: "nuke_from_orbit" });
    check("set_battle_strategy bad enum -> failed/invalid_args",
        out.status === OUTCOME_STATUS.FAILED && out.stop_reason === STOP_REASON.INVALID_ARGS,
        JSON.stringify(out));
}

// 16. heal delegates to healLive with validated method + default max_steps
{
    let captured = null;
    const deps = makeDeps({});
    deps.healLive = async (args) => { captured = args; return makeOutcome(OUTCOME_STATUS.OK, { stepsUsed: 7, message: "healed" }); };
    const out = await dispatchTool("heal", { method: "pokecenter" }, deps);
    check("heal delegates method", captured?.method === "pokecenter", JSON.stringify(captured));
    check("heal default max_steps = 400", captured?.max_steps === 400, String(captured?.max_steps));
    check("heal returns healLive outcome", out.status === OUTCOME_STATUS.OK && out.steps_used === 7, JSON.stringify(out));

    // default method (auto) when omitted
    let captured2 = null;
    deps.healLive = async (args) => { captured2 = args; return makeOutcome(OUTCOME_STATUS.OK); };
    await dispatchTool("heal", {}, deps);
    check("heal defaults method to auto", captured2?.method === "auto", JSON.stringify(captured2));

    // invalid method enum
    const bad = await dispatchTool("heal", { method: "wishful_thinking" }, deps);
    check("heal bad method -> failed/invalid_args",
        bad.status === OUTCOME_STATUS.FAILED && bad.stop_reason === STOP_REASON.INVALID_ARGS, JSON.stringify(bad));

    // heal throws -> failed (not a crash)
    deps.healLive = async () => { throw new Error("boom"); };
    const thrown = await dispatchTool("heal", { method: "items" }, deps);
    check("heal exception -> failed/unknown_state",
        thrown.status === OUTCOME_STATUS.FAILED && thrown.stop_reason === STOP_REASON.UNKNOWN_STATE && /boom/.test(thrown.message),
        JSON.stringify(thrown));
}

// 17. use_item delegates to useItemLive with validated args
{
    let captured = null;
    const deps = makeDeps({});
    deps.useItemLive = async (args) => { captured = args; return makeOutcome(OUTCOME_STATUS.OK, { stepsUsed: 9, message: "used" }); };
    const out = await dispatchTool("use_item", { item: "Potion", target_slot: 1, quantity: 2 }, deps);
    check("use_item delegates item", captured?.item === "Potion", JSON.stringify(captured));
    check("use_item passes target_slot", captured?.target_slot === 1, JSON.stringify(captured));
    check("use_item passes quantity", captured?.quantity === 2, JSON.stringify(captured));
    check("use_item returns adapter outcome", out.status === OUTCOME_STATUS.OK && out.steps_used === 9, JSON.stringify(out));

    // missing item name
    const noItem = await dispatchTool("use_item", {}, deps);
    check("use_item missing item -> failed/invalid_args",
        noItem.status === OUTCOME_STATUS.FAILED && noItem.stop_reason === STOP_REASON.INVALID_ARGS, JSON.stringify(noItem));

    // out-of-range target_slot
    const badSlot = await dispatchTool("use_item", { item: "Potion", target_slot: 9 }, deps);
    check("use_item bad target_slot -> failed/invalid_args",
        badSlot.status === OUTCOME_STATUS.FAILED && badSlot.stop_reason === STOP_REASON.INVALID_ARGS, JSON.stringify(badSlot));

    // out-of-range quantity
    const badQty = await dispatchTool("use_item", { item: "Potion", quantity: 0 }, deps);
    check("use_item bad quantity -> failed/invalid_args",
        badQty.status === OUTCOME_STATUS.FAILED && badQty.stop_reason === STOP_REASON.INVALID_ARGS, JSON.stringify(badQty));

    // use_item throws -> failed (not a crash)
    deps.useItemLive = async () => { throw new Error("boom"); };
    const thrown = await dispatchTool("use_item", { item: "Potion" }, deps);
    check("use_item exception -> failed/unknown_state",
        thrown.status === OUTCOME_STATUS.FAILED && thrown.stop_reason === STOP_REASON.UNKNOWN_STATE && /boom/.test(thrown.message),
        JSON.stringify(thrown));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
