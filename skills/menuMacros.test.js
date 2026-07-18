// =============================================================================
// C4 menu macros self-test (offline, no emulator, no network)
// =============================================================================
//
//   node skills/menuMacros.test.js
//
// Covers the pure helpers (bag resolution, sequence builders, party-slot
// direction) and the live adapters' outcome contracts + interrupt paths,
// driven with an injected FakeIo + scripted pollState + fake gotoLive /
// advanceDialog / selectPartySlotLive, mirroring battlePolicy.test.js.
// =============================================================================

import {
    resolveBagItem,
    buildBagNavigationSequence,
    buildStartMenuToBagSequence,
    buildUseActionSequence,
    buildMoveLearnDeclineSequence,
    buildMoveLearnAcceptSequence,
    partySlotDirection,
    selectPartySlotLive,
    useItemLive,
    healAtPokecenterLive,
    healWithItemsLive,
    healLive,
    reorderPartyLive,
    handleMoveLearnPromptLive,
} from "./menuMacros.js";
import { OUTCOME_STATUS, STOP_REASON } from "../llminteract/toolInterface.js";

let passed = 0;
let failed = 0;
function check(name, cond, detail = "") {
    if (cond) { passed++; console.log(`  ok   ${name}`); }
    else { failed++; console.error(`  FAIL ${name} ${detail}`); }
}

// --- Fakes ------------------------------------------------------------------

class FakeIo {
    constructor({ startFrame = 100, framesPerDelay = 1 } = {}) {
        this.frame = startFrame;
        this.tapLog = [];
        this.framesPerDelay = framesPerDelay;
    }
    async tap(button) { this.tapLog.push(button); }
    async hold(button, frames) { this.tapLog.push(`${button}:${frames}`); }
    async readFrame() { return this.frame; }
    async delay(_ms) { this.frame += this.framesPerDelay; }
}

/** Returns successive snapshots per call; sticks on the last. */
function stateQueue(states) {
    let i = 0;
    const fn = async () => { const s = states[Math.min(i, states.length - 1)]; i++; return s; };
    fn.reset = () => { i = 0; };
    return fn;
}

/** A pokecenter-shaped overworld snapshot (controls unlocked). */
function pcState({ bank = 5, number = 4, controlsLocked = false, leadHp = 1.0, battle = false } = {}) {
    return {
        player: { position: { x: 7, y: 8 }, facing: "up", map: { bank, number, name: "PC" } },
        battle: { active: battle },
        progress: { controlsLocked },
        menu: { partyMenuOpen: false, partyMenuSlot: 7 },
        party: { pokemon: [{ slot: 0, nickname: "CHAR", species: "CHARMANDER", hpFraction: leadHp, fainted: false, statusCondition: "NONE", moves: [] }], leadHpFraction: leadHp, lowestHpFraction: leadHp },
    };
}

/** A fake advanceDialog that returns a scripted result without polling. */
function fakeAdvanceDialog(result = { stopReason: STOP_REASON.NONE, pressesUsed: 0 }) {
    return async () => ({ ...result });
}

// =============================================================================
// PURE HELPERS
// =============================================================================

console.log("\n== resolveBagItem: name normalization + pocket/index ==");
{
    const bag = {
        Items: [{ name: "POTION", quantity: 3 }, { name: "ANTIDOTE", quantity: 1 }],
        "Key Items": [{ name: "OAKS_PARCEL", quantity: 1 }],
        Pokeballs: [{ name: "POKE_BALL", quantity: 5 }],
    };
    check("finds POTION by exact name", resolveBagItem(bag, "POTION")?.name === "POTION");
    check("finds by humanized 'Potion'", resolveBagItem(bag, "Potion")?.name === "POTION");
    check("finds by lowercased 'potion'", resolveBagItem(bag, "potion")?.itemIndex === 0);
    check("finds POKE_BALL across pockets (pocketIndex 2)", resolveBagItem(bag, "Poke Ball")?.pocketIndex === 2 && resolveBagItem(bag, "Poke Ball")?.itemIndex === 0);
    check("strips apostrophe: \"Oak's Parcel\" -> OAKS_PARCEL", resolveBagItem(bag, "Oak's Parcel")?.name === "OAKS_PARCEL");
    check("absent item -> null", resolveBagItem(bag, "Master Ball") === null);
    check("reports quantity", resolveBagItem(bag, "Poke Ball")?.quantity === 5);
    check("null bag -> null", resolveBagItem(null, "Potion") === null);
    check("empty name -> null", resolveBagItem(bag, "  ") === null);
}

console.log("\n== sequence builders ==");
{
    check("start->bag = start, down, down", JSON.stringify(buildStartMenuToBagSequence()) === JSON.stringify(["start", "down", "down"]));
    check("use-action is empty (Use is default cursor)", JSON.stringify(buildUseActionSequence()) === "[]");
    check("bag nav pocket 2 item 3 = right,right,down,down,down", JSON.stringify(buildBagNavigationSequence(2, 3)) === JSON.stringify(["right", "right", "down", "down", "down"]));
    check("bag nav pocket 0 item 0 = []", JSON.stringify(buildBagNavigationSequence(0, 0)) === "[]");
    check("move-learn decline = [b]", JSON.stringify(buildMoveLearnDeclineSequence()) === JSON.stringify(["b"]));
    check("move-learn accept slot 2 = a,down,down,a", JSON.stringify(buildMoveLearnAcceptSequence(2)) === JSON.stringify(["a", "down", "down", "a"]));
    check("move-learn accept slot 0 = a,a", JSON.stringify(buildMoveLearnAcceptSequence(0)) === JSON.stringify(["a", "a"]));
    check("partySlotDirection same -> null", partySlotDirection(2, 2) === null);
    check("partySlotDirection 0->3 -> down", partySlotDirection(0, 3) === "down");
    check("partySlotDirection 3->0 -> up", partySlotDirection(3, 0) === "up");
}

// =============================================================================
// selectPartySlotLive (RELIABLE party-menu cursor nav)
// =============================================================================

console.log("\n== selectPartySlotLive: menu not open -> precondition_failed ==");
{
    const pollState = stateQueue([{ menu: { partyMenuOpen: false, partyMenuSlot: 7 } }]);
    const res = await selectPartySlotLive(2, { pollState, io: new FakeIo() });
    check("menu closed -> failed", res.status === OUTCOME_STATUS.FAILED, JSON.stringify(res));
    check("menu closed -> precondition_failed", res.stop_reason === STOP_REASON.PRECONDITION_FAILED, JSON.stringify(res));
}

console.log("\n== selectPartySlotLive: already on target -> OK, no presses ==");
{
    const io = new FakeIo();
    const pollState = stateQueue([{ menu: { partyMenuOpen: true, partyMenuSlot: 2 }, battle: { active: false } }]);
    const res = await selectPartySlotLive(2, { pollState, io });
    check("on target -> ok", res.status === OUTCOME_STATUS.OK, JSON.stringify(res));
    check("on target -> no presses", io.tapLog.length === 0, JSON.stringify(io.tapLog));
}

console.log("\n== selectPartySlotLive: navigates down to target ==");
{
    // Each press advances the slot id by 1 (0->1->2). Poll returns the next slot.
    let slot = 0;
    const pollState = async () => ({ menu: { partyMenuOpen: true, partyMenuSlot: slot }, battle: { active: false } });
    const io = new FakeIo();
    // advance slot on each tap by wrapping FakeIo.tap
    const origTap = io.tap.bind(io);
    io.tap = async (b) => { if (b === "Down") slot++; origTap(b); };
    const res = await selectPartySlotLive(2, { pollState, io });
    check("nav down -> ok", res.status === OUTCOME_STATUS.OK, JSON.stringify(res));
    check("nav down -> pressed Down twice", io.tapLog.length === 2 && io.tapLog.every((b) => b === "Down"), JSON.stringify(io.tapLog));
}

console.log("\n== selectPartySlotLive: navigates up to target ==");
{
    let slot = 3;
    const pollState = async () => ({ menu: { partyMenuOpen: true, partyMenuSlot: slot }, battle: { active: false } });
    const io = new FakeIo();
    const origTap = io.tap.bind(io);
    io.tap = async (b) => { if (b === "Up") slot--; origTap(b); };
    const res = await selectPartySlotLive(1, { pollState, io });
    check("nav up -> ok", res.status === OUTCOME_STATUS.OK, JSON.stringify(res));
    check("nav up -> pressed Up twice", io.tapLog.length === 2 && io.tapLog.every((b) => b === "Up"), JSON.stringify(io.tapLog));
}

console.log("\n== selectPartySlotLive: battle starts mid-nav -> interrupted ==");
{
    // Slot never reaches target because a battle starts: slot stays 0, battle active.
    let calls = 0;
    const pollState = async () => { calls++; return calls <= 3 ? { menu: { partyMenuOpen: true, partyMenuSlot: 0 }, battle: { active: false } } : { menu: { partyMenuOpen: true, partyMenuSlot: 0 }, battle: { active: true } }; };
    const io = new FakeIo();
    const res = await selectPartySlotLive(5, { pollState, io, maxSteps: 50 });
    check("battle mid-nav -> interrupted", res.status === OUTCOME_STATUS.INTERRUPTED, JSON.stringify(res));
    check("battle mid-nav -> battle_started", res.stop_reason === STOP_REASON.BATTLE_STARTED, JSON.stringify(res));
}

// =============================================================================
// useItemLive
// =============================================================================

console.log("\n== useItemLive: invalid args / preconditions ==");
{
    const bag = { Items: [{ name: "POTION", quantity: 2 }] };
    const base = { ...pcState(), bag };
    const pollState = stateQueue([base]);
    const noItem = await useItemLive({ item: "" }, { pollState, io: new FakeIo(), advanceDialog: fakeAdvanceDialog() });
    check("no item name -> failed/invalid_args", noItem.status === OUTCOME_STATUS.FAILED && noItem.stop_reason === STOP_REASON.INVALID_ARGS, JSON.stringify(noItem));

    const notInBag = await useItemLive({ item: "Elixir" }, { pollState: stateQueue([{ ...base }]), io: new FakeIo(), advanceDialog: fakeAdvanceDialog() });
    check("item not in bag -> failed/precondition", notInBag.status === OUTCOME_STATUS.FAILED && notInBag.stop_reason === STOP_REASON.PRECONDITION_FAILED, JSON.stringify(notInBag));

    const tooMany = await useItemLive({ item: "Potion", quantity: 99 }, { pollState: stateQueue([{ ...base }]), io: new FakeIo(), advanceDialog: fakeAdvanceDialog() });
    check("quantity exceeds stock -> failed/precondition", tooMany.status === OUTCOME_STATUS.FAILED && tooMany.stop_reason === STOP_REASON.PRECONDITION_FAILED, JSON.stringify(tooMany));

    const inBattle = await useItemLive({ item: "Potion" }, { pollState: stateQueue([{ ...base, battle: { active: true } }]), io: new FakeIo(), advanceDialog: fakeAdvanceDialog() });
    check("in battle -> failed/precondition", inBattle.status === OUTCOME_STATUS.FAILED && inBattle.stop_reason === STOP_REASON.PRECONDITION_FAILED, JSON.stringify(inBattle));

    const locked = await useItemLive({ item: "Potion" }, { pollState: stateQueue([{ ...base, progress: { controlsLocked: true } }]), io: new FakeIo(), advanceDialog: fakeAdvanceDialog() });
    check("controls locked -> interrupted/dialog", locked.status === OUTCOME_STATUS.INTERRUPTED && locked.stop_reason === STOP_REASON.DIALOG, JSON.stringify(locked));
}

console.log("\n== useItemLive: happy path (no target) presses the bag-open + use sequence ==");
{
    const bag = { Items: [{ name: "POTION", quantity: 2 }] };
    const base = { ...pcState(), bag };
    // Overworld unlocked the whole time; onStep sees no battle/dialog -> continues.
    const pollState = stateQueue([base, base, base, base, base, base, base, base, base, base]);
    const io = new FakeIo();
    const res = await useItemLive({ item: "Potion" }, { pollState, io, advanceDialog: fakeAdvanceDialog() });
    check("happy -> ok", res.status === OUTCOME_STATUS.OK, JSON.stringify(res));
    check("happy -> message mentions used", /used POTION/.test(res.message), JSON.stringify(res));
    // Phases: start,down,down,a (open bag) | right×0 down×0 a (item slot 0) | a (use) | advanceDialog | b,b,b (close)
    const log = io.tapLog;
    check("happy -> opens start menu then BAG entry", log[0] === "Start" && log[1] === "Down" && log[2] === "Down" && log[3] === "A", JSON.stringify(log));
    check("happy -> selects item slot then Use", log[4] === "A" && log[5] === "A", JSON.stringify(log));
    check("happy -> closes with B×3 tail", log.length >= 8 && log.slice(-3).every((b) => b === "B"), JSON.stringify(log));
}

console.log("\n== useItemLive: with targetSlot calls selectPartySlotLive + confirms ==");
{
    const bag = { Items: [{ name: "POTION", quantity: 2 }] };
    const base = { ...pcState(), bag };
    let selectCalls = 0;
    const fakeSelect = async (slot) => { selectCalls++; return makeOutcomeLike(OUTCOME_STATUS.OK, slot); };
    const io = new FakeIo();
    const res = await useItemLive({ item: "Potion", targetSlot: 1 }, {
        pollState: stateQueue([base, base, base, base, base, base, base, base, base, base]),
        io, advanceDialog: fakeAdvanceDialog(), selectPartySlotLive: fakeSelect,
    });
    check("with target -> ok", res.status === OUTCOME_STATUS.OK, JSON.stringify(res));
    check("with target -> selectPartySlotLive called with slot 1", selectCalls === 1, String(selectCalls));
    check("with target -> delta carries targetSlot", res.state_delta?.targetSlot === 1, JSON.stringify(res.state_delta));
}

console.log("\n== useItemLive: battle starts mid-phase -> interrupted ==");
{
    const bag = { Items: [{ name: "POTION", quantity: 2 }] };
    // Poll 0 (resolve): overworld. Then onStep polls flip to battle-active.
    let n = 0;
    const pollState = async () => { n++; return n <= 2 ? { ...pcState(), bag } : { ...pcState(), bag, battle: { active: true } }; };
    const io = new FakeIo();
    const res = await useItemLive({ item: "Potion" }, { pollState, io, advanceDialog: fakeAdvanceDialog() });
    check("battle mid-use -> interrupted", res.status === OUTCOME_STATUS.INTERRUPTED, JSON.stringify(res));
    check("battle mid-use -> battle_started", res.stop_reason === STOP_REASON.BATTLE_STARTED, JSON.stringify(res));
}

/** helper to mirror makeOutcome without importing the builder here */
function makeOutcomeLike(status, slot, extra = {}) {
    return { status, stop_reason: STOP_REASON.NONE, steps_used: 1, message: `slot ${slot}`, state_delta: { partyMenuSlot: slot, ...extra } };
}

// =============================================================================
// healAtPokecenterLive
// =============================================================================

console.log("\n== healAtPokecenterLive: leg1 (goto) not OK -> propagates ==");
{
    const gotoLive = async () => ({ status: OUTCOME_STATUS.INTERRUPTED, stop_reason: STOP_REASON.BATTLE_STARTED, steps_used: 3, message: "mid-route" });
    const res = await healAtPokecenterLive({ gotoLive, pollState: stateQueue([pcState()]), io: new FakeIo(), advanceDialog: fakeAdvanceDialog() });
    check("leg1 interrupted -> interrupted", res.status === OUTCOME_STATUS.INTERRUPTED && res.stop_reason === STOP_REASON.BATTLE_STARTED, JSON.stringify(res));
    check("leg1 steps propagated", res.steps_used === 3, String(res.steps_used));
}

console.log("\n== healAtPokecenterLive: unknown center layout -> precondition_failed ==");
{
    const gotoLive = async () => ({ status: OUTCOME_STATUS.OK, steps_used: 10, message: "arrived" });
    // Lands in a center NOT in the nurse table (bank 99).
    const res = await healAtPokecenterLive({ gotoLive, pollState: stateQueue([pcState({ bank: 99, number: 9 })]), io: new FakeIo(), advanceDialog: fakeAdvanceDialog() });
    check("unknown layout -> failed", res.status === OUTCOME_STATUS.FAILED, JSON.stringify(res));
    check("unknown layout -> precondition_failed", res.stop_reason === STOP_REASON.PRECONDITION_FAILED, JSON.stringify(res));
}

console.log("\n== healAtPokecenterLive: happy path (talk + mash) ==");
{
    let leg2Called = false;
    const gotoLive = async (destination, opts) => {
        if (destination.location) return { status: OUTCOME_STATUS.OK, steps_used: 50, message: "reached pc" };
        leg2Called = true;
        check("leg2 targets nurse tile (7,4)", destination.x === 7 && destination.y === 4, JSON.stringify(destination));
        return { status: OUTCOME_STATUS.OK, steps_used: 4, message: "at nurse tile" };
    };
    // After talk, controlsLocked true so waitForDialogEngaged returns true.
    const pollState = stateQueue([
        pcState({ bank: 5, number: 4 }),        // here (after leg1)
        pcState({ bank: 5, number: 4, controlsLocked: true }), // engaged check
        pcState({ bank: 5, number: 4, leadHp: 1.0 }),           // after heal
    ]);
    const io = new FakeIo();
    const advance = fakeAdvanceDialog({ stopReason: STOP_REASON.NONE, pressesUsed: 6 });
    const res = await healAtPokecenterLive({ gotoLive, pollState, io, advanceDialog: advance });
    check("happy -> ok", res.status === OUTCOME_STATUS.OK, JSON.stringify(res));
    check("happy -> talked up then A", io.tapLog.length === 2 && io.tapLog[0] === "Up" && io.tapLog[1] === "A", JSON.stringify(io.tapLog));
    check("happy -> leg2 routed to nurse tile", leg2Called, "leg2 not called");
    check("happy -> stateDelta has leadHp", res.state_delta?.leadHpFraction === 1.0, JSON.stringify(res.state_delta));
    check("happy -> steps accumulate", res.steps_used >= 56, String(res.steps_used));
}

console.log("\n== healAtPokecenterLive: nurse dialog never engages -> unexpected_menu ==");
{
    const gotoLive = async (d) => d.location
        ? { status: OUTCOME_STATUS.OK, steps_used: 50, message: "reached" }
        : { status: OUTCOME_STATUS.OK, steps_used: 4, message: "at nurse" };
    // controlsLocked never true -> waitForDialogEngaged times out (fast via tiny io.delay).
    const pollState = stateQueue([pcState({ bank: 5, number: 4 })]);
    const io = new FakeIo();
    const res = await healAtPokecenterLive({ gotoLive, pollState, io, advanceDialog: fakeAdvanceDialog() });
    check("no dialog -> interrupted", res.status === OUTCOME_STATUS.INTERRUPTED, JSON.stringify(res));
    check("no dialog -> unexpected_menu", res.stop_reason === STOP_REASON.UNEXPECTED_MENU, JSON.stringify(res));
}

console.log("\n== healAtPokecenterLive: advanceDialog interrupted -> propagates ==");
{
    const gotoLive = async (d) => d.location
        ? { status: OUTCOME_STATUS.OK, steps_used: 50, message: "reached" }
        : { status: OUTCOME_STATUS.OK, steps_used: 4, message: "at nurse" };
    const pollState = stateQueue([pcState({ bank: 5, number: 4 }), pcState({ bank: 5, number: 4, controlsLocked: true }), pcState()]);
    const res = await healAtPokecenterLive({
        gotoLive, pollState, io: new FakeIo(),
        advanceDialog: fakeAdvanceDialog({ stopReason: STOP_REASON.BATTLE_STARTED, pressesUsed: 1 }),
    });
    check("dialog interrupted -> interrupted", res.status === OUTCOME_STATUS.INTERRUPTED, JSON.stringify(res));
    check("dialog interrupted -> battle_started", res.stop_reason === STOP_REASON.BATTLE_STARTED, JSON.stringify(res));
}

// =============================================================================
// healWithItemsLive
// =============================================================================

console.log("\n== healWithItemsLive: injured member + potion -> useItem called; full -> ok ==");
{
    const bag = { Items: [{ name: "POTION", quantity: 3 }] };
    // First poll: lead at 0.5 HP. After useItem (fake OK), subsequent polls: full.
    let call = 0;
    const pollState = async () => {
        call++;
        return call <= 2 ? { ...pcState({ leadHp: 0.5 }), bag } : { ...pcState({ leadHp: 1.0 }), bag };
    };
    let useCalls = 0;
    const fakeUse = async (args) => { useCalls++; return { status: OUTCOME_STATUS.OK, stop_reason: STOP_REASON.NONE, steps_used: 5, message: "used", state_delta: null }; };
    const res = await healWithItemsLive({ pollState, io: new FakeIo(), useItemLive: fakeUse });
    check("items applied -> ok", res.status === OUTCOME_STATUS.OK, JSON.stringify(res));
    check("useItem called at least once", useCalls >= 1, String(useCalls));
}

console.log("\n== healWithItemsLive: out of items, not full -> choice_required ==");
{
    // No bag items; injured party never heals -> not full.
    const pollState = async () => ({ ...pcState({ leadHp: 0.3 }), bag: { Items: [] } });
    const fakeUse = async () => { throw new Error("should not be called — no items"); };
    const res = await healWithItemsLive({ pollState, io: new FakeIo(), useItemLive: fakeUse });
    check("no items + injured -> interrupted", res.status === OUTCOME_STATUS.INTERRUPTED, JSON.stringify(res));
    check("no items + injured -> choice_required", res.stop_reason === STOP_REASON.CHOICE_REQUIRED, JSON.stringify(res));
    check("message suggests pokecenter", /pokecenter/i.test(res.message), JSON.stringify(res));
}

// =============================================================================
// healLive (method dispatch)
// =============================================================================

console.log("\n== healLive: method dispatch ==");
{
    // pokecenter
    let pcCalled = false;
    const pcAdapter = async () => { pcCalled = true; return { status: OUTCOME_STATUS.OK, stop_reason: STOP_REASON.NONE, steps_used: 1, message: "pc", state_delta: null }; };
    const r1 = await healLive({ method: "pokecenter" }, { healAtPokecenterLive: pcAdapter });
    check("method=pokecenter routes to pokecenter adapter", pcCalled, "not called");

    // items
    let itemsCalled = false;
    const itemsAdapter = async () => { itemsCalled = true; return { status: OUTCOME_STATUS.OK, stop_reason: STOP_REASON.NONE, steps_used: 1, message: "items", state_delta: null }; };
    const r2 = await healLive({ method: "items" }, { healWithItemsLive: itemsAdapter });
    check("method=items routes to items adapter", itemsCalled, "not called");

    // auto + healthy party
    const healthy = pcState({ leadHp: 1.0 });
    const r3 = await healLive({ method: "auto" }, { pollState: stateQueue([{ ...healthy, bag: { Items: [{ name: "POTION", quantity: 1 }] } }]) });
    check("auto + healthy -> ok no-op", r3.status === OUTCOME_STATUS.OK && /healthy/.test(r3.message), JSON.stringify(r3));

    // auto + injured + items available -> items adapter
    let autoItems = false;
    const r4 = await healLive({ method: "auto" }, {
        pollState: stateQueue([{ ...pcState({ leadHp: 0.5 }), bag: { Items: [{ name: "POTION", quantity: 1 }] } }]),
        healWithItemsLive: async () => { autoItems = true; return { status: OUTCOME_STATUS.OK, stop_reason: STOP_REASON.NONE, steps_used: 1, message: "items", state_delta: null }; },
        healAtPokecenterLive: async () => { throw new Error("should not pick pokecenter"); },
    });
    check("auto + injured + items -> items adapter", autoItems, "not called");

    // auto + injured + NO items -> pokecenter adapter
    let autoPc = false;
    const r5 = await healLive({ method: "auto" }, {
        pollState: stateQueue([{ ...pcState({ leadHp: 0.5 }), bag: { Items: [] } }]),
        healAtPokecenterLive: async () => { autoPc = true; return { status: OUTCOME_STATUS.OK, stop_reason: STOP_REASON.NONE, steps_used: 1, message: "pc", state_delta: null }; },
        healWithItemsLive: async () => { throw new Error("should not pick items"); },
    });
    check("auto + injured + no items -> pokecenter adapter", autoPc, "not called");
}

// =============================================================================
// reorderPartyLive
// =============================================================================

console.log("\n== reorderPartyLive: arg guards + no-op ==");
{
    const noArgs = await reorderPartyLive({}, { pollState: stateQueue([pcState()]), io: new FakeIo() });
    check("missing slots -> failed/invalid_args", noArgs.status === OUTCOME_STATUS.FAILED && noArgs.stop_reason === STOP_REASON.INVALID_ARGS, JSON.stringify(noArgs));

    const noop = await reorderPartyLive({ fromSlot: 2, toSlot: 2 }, { pollState: stateQueue([pcState()]), io: new FakeIo() });
    check("from==to -> ok no-op", noop.status === OUTCOME_STATUS.OK && /no-op/.test(noop.message), JSON.stringify(noop));
}

console.log("\n== reorderPartyLive: happy path sequence ==");
{
    // Party menu open with controlsLocked true (init lock) then partyMenuOpen true.
    let call = 0;
    const pollState = async () => {
        call++;
        return call <= 1
            ? { ...pcState(), progress: { controlsLocked: true }, menu: { partyMenuOpen: true, partyMenuSlot: 0 } }
            : { ...pcState(), menu: { partyMenuOpen: true, partyMenuSlot: 0 } };
    };
    const io = new FakeIo();
    const fakeSelect = async (slot) => makeOutcomeLike(OUTCOME_STATUS.OK, slot);
    const res = await reorderPartyLive({ fromSlot: 0, toSlot: 1 }, { pollState, io, selectPartySlotLive: fakeSelect });
    check("reorder -> ok", res.status === OUTCOME_STATUS.OK, JSON.stringify(res));
    const log = io.tapLog;
    // open: start,down,a | then switch-menu: a,down,a | then confirm: a,b,b,b
    check("reorder -> opens party menu (start,down,a)", log[0] === "Start" && log[1] === "Down" && log[2] === "A", JSON.stringify(log));
    check("reorder -> switch-menu (a,down,a)", log[3] === "A" && log[4] === "Down" && log[5] === "A", JSON.stringify(log));
    check("reorder -> confirm+close (a,b,b,b)", log[6] === "A" && log.slice(7, 11).every((b) => b === "B"), JSON.stringify(log));
}

// =============================================================================
// handleMoveLearnPromptLive
// =============================================================================

console.log("\n== handleMoveLearnPromptLive: decline (default) ==");
{
    const io = new FakeIo();
    const res = await handleMoveLearnPromptLive({}, { pollState: stateQueue([pcState()]), io, advanceDialog: fakeAdvanceDialog() });
    check("decline -> ok", res.status === OUTCOME_STATUS.OK, JSON.stringify(res));
    check("decline -> pressed B", io.tapLog.length === 1 && io.tapLog[0] === "B", JSON.stringify(io.tapLog));
    check("decline -> message", /declined/i.test(res.message), JSON.stringify(res));
}

console.log("\n== handleMoveLearnPromptLive: accept + replace slot ==");
{
    const io = new FakeIo();
    const res = await handleMoveLearnPromptLive({ decision: "accept", replaceSlot: 1 }, { pollState: stateQueue([pcState()]), io, advanceDialog: fakeAdvanceDialog() });
    check("accept -> ok", res.status === OUTCOME_STATUS.OK, JSON.stringify(res));
    check("accept -> pressed a,down,a", JSON.stringify(io.tapLog) === JSON.stringify(["A", "Down", "A"]), JSON.stringify(io.tapLog));
    check("accept -> message mentions learned", /learned/i.test(res.message), JSON.stringify(res));
}

// --- Summary ----------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
