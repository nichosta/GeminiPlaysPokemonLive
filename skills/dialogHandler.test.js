// =============================================================================
// C5 dialog handler self-test (offline, runs against B2's pure classifier +
// an injected fake transport — no emulator, no network)
// =============================================================================
//
//   node skills/dialogHandler.test.js
//
// Verifies the pure `decideDialogAction` core: the done/press/escalate branches
// across every STOP_REASON (delegated to B2's classifyInterrupt), the
// per-policy mash button (A for ask/yes, B for no), and the budget-exhausted ->
// CHOICE_REQUIRED escalation. Then drives `advanceDialogLive` with an injected
// FakeIo + scripted pollState, covering the outcome-envelope contract (OK clear,
// CHOICE_REQUIRED on a stuck prompt, battle/menu/hp escalation mid-mash, button
// selection per policy, abort). Mirrors battlePolicy.test.js's FakeIo.
// =============================================================================

import { decideDialogAction, advanceDialogLive } from "./dialogHandler.js";
import { STOP_REASON } from "../llminteract/toolInterface.js";

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

// --- Fixtures ----------------------------------------------------------------

/** A B1-shaped snapshot builder. `locked` controls progress.controlsLocked. */
function snap({ locked = false, inBattle = false, hp = 1.0, menuOpen = false, readable = true } = {}) {
    const base = {
        player: { position: { x: 5, y: 5 }, map: { bank: 3, number: 0 } },
        battle: { active: inBattle },
        progress: { controlsLocked: locked },
        menu: { partyMenuOpen: menuOpen },
        party: {
            pokemon: [{
                slot: 0, nickname: "CHAR", species: "CHARMANDER", types: ["FIRE"],
                level: 7, hpFraction: hp, fainted: false, moves: [],
            }],
            leadHpFraction: hp,
            lowestHpFraction: hp,
        },
    };
    if (!readable) {
        // Missing position/map -> classifyInterrupt returns UNKNOWN_STATE.
        return { ...base, player: { position: { x: null, y: null }, map: { bank: null, number: null } } };
    }
    return base;
}

// --- Pure core tests ---------------------------------------------------------

console.log("\n== decideDialogAction: controls unlocked -> done ==");
{
    const d = decideDialogAction(snap({ locked: false }), {}, { pressesUsed: 0, maxPresses: 60 });
    check("unlocked -> done", d.kind === "done", JSON.stringify(d));
}

console.log("\n== decideDialogAction: in dialog, budget remaining -> press A (ask/yes) ==");
{
    const d = decideDialogAction(snap({ locked: true }), {}, { pressesUsed: 0, maxPresses: 60 });
    check("ask -> press A", d.kind === "press" && d.button === "a", JSON.stringify(d));

    const yes = decideDialogAction(snap({ locked: true }), { choice: "yes" }, { pressesUsed: 0, maxPresses: 60 });
    check("yes -> press A", yes.kind === "press" && yes.button === "a", JSON.stringify(yes));
}

console.log("\n== decideDialogAction: choice 'no' -> press B ==");
{
    const d = decideDialogAction(snap({ locked: true }), { choice: "no" }, { pressesUsed: 0, maxPresses: 60 });
    check("no -> press B", d.kind === "press" && d.button === "b", JSON.stringify(d));
}

console.log("\n== decideDialogAction: unknown choice -> defaults to ask (A) ==");
{
    const d = decideDialogAction(snap({ locked: true }), { choice: "garbage" }, { pressesUsed: 0, maxPresses: 60 });
    check("garbage choice -> A (ask default)", d.kind === "press" && d.button === "a", JSON.stringify(d));
}

console.log("\n== decideDialogAction: budget exhausted while locked -> CHOICE_REQUIRED ==");
{
    const d = decideDialogAction(snap({ locked: true }), {}, { pressesUsed: 60, maxPresses: 60 });
    check("budget exhausted -> escalate", d.kind === "escalate", JSON.stringify(d));
    check("budget exhausted -> choice_required", d.stopReason === STOP_REASON.CHOICE_REQUIRED, JSON.stringify(d));

    // One press of headroom still allows a press.
    const d2 = decideDialogAction(snap({ locked: true }), {}, { pressesUsed: 59, maxPresses: 60 });
    check("59/60 -> still press (headroom)", d2.kind === "press", JSON.stringify(d2));
}

console.log("\n== decideDialogAction: non-dialog interrupts escalate verbatim ==");
{
    const battle = decideDialogAction(snap({ locked: true, inBattle: true }), {}, { pressesUsed: 0, maxPresses: 60 });
    check("battle active -> battle_started", battle.kind === "escalate" && battle.stopReason === STOP_REASON.BATTLE_STARTED, JSON.stringify(battle));

    // Low HP is NOT an interrupt (it would deadlock the walk to a Pokécenter);
    // it surfaces as plain text in the D2 state prompt instead. So an unlocked
    // snapshot whose only flag is low HP classifies to null -> done.
    const hp = decideDialogAction(snap({ locked: false, hp: 0.1 }), {}, { pressesUsed: 0, maxPresses: 60 });
    check("hp low (unlocked) -> done (not an interrupt)", hp.kind === "done", JSON.stringify(hp));

    const menu = decideDialogAction(snap({ locked: false, menuOpen: true }), {}, { pressesUsed: 0, maxPresses: 60 });
    check("menu open (unlocked) -> unexpected_menu", menu.kind === "escalate" && menu.stopReason === STOP_REASON.UNEXPECTED_MENU, JSON.stringify(menu));

    // And while locked, DIALOG wins regardless of a concurrent low-HP flag.
    const lockedLow = decideDialogAction(snap({ locked: true, hp: 0.1 }), {}, { pressesUsed: 0, maxPresses: 60 });
    check("locked + low HP -> press (dialog)", lockedLow.kind === "press" && lockedLow.button === "a", JSON.stringify(lockedLow));

    const unreadable = decideDialogAction(snap({ locked: true, readable: false }), {}, { pressesUsed: 0, maxPresses: 60 });
    check("unreadable -> unknown_state", unreadable.kind === "escalate" && unreadable.stopReason === STOP_REASON.UNKNOWN_STATE, JSON.stringify(unreadable));
}

console.log("\n== decideDialogAction: battle wins over dialog (priority) ==");
{
    // Locked AND in battle: classifyInterrupt reports BATTLE_STARTED first.
    const d = decideDialogAction(snap({ locked: true, inBattle: true }), {}, { pressesUsed: 0, maxPresses: 60 });
    check("battle outranks dialog", d.stopReason === STOP_REASON.BATTLE_STARTED, JSON.stringify(d));
}

// =============================================================================
// LIVE ADAPTER (advanceDialogLive) — driven with an injected FakeIo + scripted
// pollState, no emulator. Mirrors battlePolicy.test.js's FakeIo.
// =============================================================================

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

console.log("\n== advanceDialogLive: nothing locked at start -> OK, 0 presses ==");
{
    const pollState = async () => snap({ locked: false });
    const io = new FakeIo();
    const res = await advanceDialogLive({}, { pollState, io, maxSteps: 60 });
    check("nothing locked -> status ok", res.status === "ok", JSON.stringify(res));
    check("nothing locked -> stop_reason none", res.stop_reason === STOP_REASON.NONE, JSON.stringify(res));
    check("nothing locked -> 0 presses sent", io.tapLog.length === 0, JSON.stringify(io.tapLog));
    check("nothing locked -> steps_used 0", res.steps_used === 0, JSON.stringify(res));
}

console.log("\n== advanceDialogLive: locked then unlocked after one A -> OK ==");
{
    const seq = [snap({ locked: true }), snap({ locked: false })];
    let i = 0;
    const pollState = async () => seq[Math.min(i++, seq.length - 1)];
    const io = new FakeIo();
    const res = await advanceDialogLive({}, { pollState, io, maxSteps: 60 });
    check("clear after 1 press -> ok", res.status === "ok", JSON.stringify(res));
    check("clear after 1 press -> none", res.stop_reason === STOP_REASON.NONE, JSON.stringify(res));
    check("clear after 1 press -> sent one A", io.tapLog.length === 1 && io.tapLog[0] === "A", JSON.stringify(io.tapLog));
    check("clear after 1 press -> steps_used 1", res.steps_used === 1, JSON.stringify(res));
}

console.log("\n== advanceDialogLive: choice 'no' -> mashes B ==");
{
    const seq = [snap({ locked: true }), snap({ locked: false })];
    let i = 0;
    const pollState = async () => seq[Math.min(i++, seq.length - 1)];
    const io = new FakeIo();
    const res = await advanceDialogLive({ choice: "no" }, { pollState, io, maxSteps: 60 });
    check("no policy -> sent B", io.tapLog.length === 1 && io.tapLog[0] === "B", JSON.stringify(io.tapLog));
    check("no policy -> ok", res.status === "ok", JSON.stringify(res));
}

console.log("\n== advanceDialogLive: stays locked across budget -> CHOICE_REQUIRED ==");
{
    const pollState = async () => snap({ locked: true });
    const io = new FakeIo();
    const res = await advanceDialogLive({}, { pollState, io, maxSteps: 5 });
    check("stuck -> interrupted", res.status === "interrupted", JSON.stringify(res));
    check("stuck -> choice_required", res.stop_reason === STOP_REASON.CHOICE_REQUIRED, JSON.stringify(res));
    check("stuck -> exhausted the budget (5 presses)", io.tapLog.length === 5, JSON.stringify(io.tapLog));
    check("stuck -> steps_used == budget", res.steps_used === 5, JSON.stringify(res));
    check("stuck -> mashed A", io.tapLog.every((b) => b === "A"), JSON.stringify(io.tapLog));
}

console.log("\n== advanceDialogLive: battle surfaces mid-mash -> BATTLE_STARTED ==");
{
    // Locked, then a battle starts (controls still locked + battle active).
    const seq = [snap({ locked: true }), snap({ locked: true, inBattle: true })];
    let i = 0;
    const pollState = async () => seq[Math.min(i++, seq.length - 1)];
    const io = new FakeIo();
    const res = await advanceDialogLive({}, { pollState, io, maxSteps: 60 });
    check("battle mid-mash -> interrupted", res.status === "interrupted", JSON.stringify(res));
    check("battle mid-mash -> battle_started", res.stop_reason === STOP_REASON.BATTLE_STARTED, JSON.stringify(res));
    check("battle mid-mash -> one A sent before escalate", io.tapLog.length === 1, JSON.stringify(io.tapLog));
}

console.log("\n== advanceDialogLive: battle already active at start -> escalate, 0 presses ==");
{
    const pollState = async () => snap({ locked: true, inBattle: true });
    const io = new FakeIo();
    const res = await advanceDialogLive({}, { pollState, io, maxSteps: 60 });
    check("battle at start -> interrupted", res.status === "interrupted", JSON.stringify(res));
    check("battle at start -> battle_started", res.stop_reason === STOP_REASON.BATTLE_STARTED, JSON.stringify(res));
    check("battle at start -> 0 presses", io.tapLog.length === 0, JSON.stringify(io.tapLog));
}

console.log("\n== advanceDialogLive: hp low mid-mash -> OK (not an interrupt) ==");
{
    // Locked first (mash A), then the dialog clears while HP is low. Low HP is
    // NOT an interrupt, so once controls unlock the handler returns OK — the
    // model is free to walk to a Pokécenter (HP is surfaced as prompt text).
    const seq = [snap({ locked: true, hp: 1.0 }), snap({ locked: false, hp: 0.1 })];
    let i = 0;
    const pollState = async () => seq[Math.min(i++, seq.length - 1)];
    const io = new FakeIo();
    const res = await advanceDialogLive({}, { pollState, io, maxSteps: 60 });
    check("hp low mid-mash -> ok (not interrupted)", res.status === "ok", JSON.stringify(res));
    check("hp low mid-mash -> stop_reason none", res.stop_reason === STOP_REASON.NONE, JSON.stringify(res));
}

console.log("\n== advanceDialogLive: AbortSignal -> interrupted (none) ==");
{
    const pollState = async () => snap({ locked: true });
    const ac = new AbortController();
    ac.abort();
    const io = new FakeIo();
    const res = await advanceDialogLive({}, { pollState, io, maxSteps: 60, signal: ac.signal });
    check("aborted -> interrupted", res.status === "interrupted", JSON.stringify(res));
    check("aborted -> stop_reason none", res.stop_reason === STOP_REASON.NONE, JSON.stringify(res));
}

// --- Summary ----------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
