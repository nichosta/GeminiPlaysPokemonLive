// =============================================================================
// B3 input executor self-test (offline, no emulator)
// =============================================================================
//
//   node tools/inputExecutor.test.js
//
// `executeQueue`, `awaitFrames`, and `advanceDialog` all take an injectable
// `io` / `pollState`, so this exercises them with fakes — no mGBA-http server,
// no RAM. It covers: button validation, tap-vs-hold dispatch, frame-accurate
// settling, the onStep abort hook, AbortSignal, module-level serialization of
// concurrent queues, the awaitFrames fallback when the frame counter is
// unreadable, and every advanceDialog stop branch (already-unlocked,
// mid-mash unlock, battle/menu interrupt surfacing, maxPresses -> CHOICE_REQUIRED,
// and the alternate-button mash).
// =============================================================================

import {
    canonicalButton,
    executeQueue,
    awaitFrames,
    advanceDialog,
    defaultIo,
    DEFAULT_TAP_SETTLE_FRAMES,
    MS_PER_FRAME,
} from "./inputExecutor.js";
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

/** Fake transport: records taps/holds and advances a frame counter on delay(). */
class FakeIo {
    constructor({ startFrame = 100, framesPerDelay = 1 } = {}) {
        this.frame = startFrame;
        this.tapLog = [];
        this.holdLog = [];
        this.framesPerDelay = framesPerDelay;
        this.delays = 0;
    }
    async tap(button) { this.tapLog.push(button); }
    async hold(button, frames) { this.holdLog.push({ button, frames }); }
    async readFrame() { return this.frame; }
    async delay(_ms) { this.delays++; this.frame += this.framesPerDelay; }
}

/** A getState()-shaped snapshot for dialog classification (B2 reads these). */
function dlgState(overrides = {}) {
    return {
        player: { position: { x: 5, y: 5 }, map: { bank: 3, number: 0 }, ...overrides.player },
        battle: { active: false, ...overrides.battle },
        progress: { controlsLocked: true, ...overrides.progress },
        menu: { partyMenuOpen: false, ...overrides.menu },
        party: { lowestHpFraction: 1.0, ...overrides.party },
    };
}

// --- canonicalButton -------------------------------------------------------
{
    check("canonicalButton: lowercases + maps to API casing", canonicalButton("a") === "A" && canonicalButton("Start") === "Start");
    let threw = false;
    try { canonicalButton("x"); } catch { threw = true; }
    check("canonicalButton: rejects unknown button", threw);
    threw = false;
    try { canonicalButton(""); } catch { threw = true; }
    check("canonicalButton: rejects empty", threw);
}

// --- executeQueue: tap vs hold dispatch ------------------------------------
{
    const io = new FakeIo();
    const res = await executeQueue(
        [{ button: "a", frames: 3 }, "up", { button: "b", frames: 0 }, { button: "left" }],
        { io, tapSettleFrames: 1 }
    );
    check("queue: completes", res.completed === true, JSON.stringify(res));
    check("queue: taps sent for frames<=0, hold for frames>0",
        io.tapLog.length === 3 && io.tapLog[0] === "Up" && io.tapLog[1] === "B" && io.tapLog[2] === "Left",
        JSON.stringify(io.tapLog));
    check("queue: hold dispatched with frame count",
        io.holdLog.length === 1 && io.holdLog[0].button === "A" && io.holdLog[0].frames === 3,
        JSON.stringify(io.holdLog));
    check("queue: one step counted per action", res.stepsUsed === 4, JSON.stringify(res));
}

// --- executeQueue: bare string single action -------------------------------
{
    const io = new FakeIo();
    const res = await executeQueue("a", { io });
    check("queue: bare string is one tap", res.completed && io.tapLog.length === 1 && io.tapLog[0] === "A");
}

// --- executeQueue: invalid button surfaces as error (no throw) ------------
{
    const io = new FakeIo();
    const res = await executeQueue(["a", "x"], { io });
    check("queue: invalid button -> error result, not throw",
        res.completed === false && typeof res.error === "string" && res.stepsUsed === 1,
        JSON.stringify(res));
}

// --- executeQueue: onStep abort stops the queue ----------------------------
{
    const io = new FakeIo();
    let calls = 0;
    const res = await executeQueue(["a", "a", "a"], {
        io,
        onStep: () => { calls++; return calls === 2; }, // truthy after 2nd press
    });
    check("queue: onStep truthy aborts", res.completed === false && res.stopped === true, JSON.stringify(res));
    check("queue: onStep abort presses counted", res.stepsUsed === 2, JSON.stringify(res));
    check("queue: onStep abort stops dispatching further presses", io.tapLog.length === 2, JSON.stringify(io.tapLog));
}

// --- executeQueue: AbortSignal stops ---------------------------------------
{
    const io = new FakeIo();
    const ctrl = new AbortController();
    ctrl.abort();
    const res = await executeQueue(["a", "a"], { io, signal: ctrl.signal });
    check("queue: pre-aborted signal stops before first press",
        res.completed === false && res.stopped === true && res.stepsUsed === 0 && io.tapLog.length === 0,
        JSON.stringify(res));
}

// --- executeQueue: transport failure surfaces as error --------------------
{
    const io = new FakeIo();
    io.tap = async () => { throw new Error("ECONNREFUSED"); };
    const res = await executeQueue(["a", "a"], { io });
    check("queue: io.tap throw -> error result",
        res.completed === false && /ECONNREFUSED/.test(res.error) && res.stepsUsed === 0,
        JSON.stringify(res));
}

// --- module-level serialization: concurrent queues run strictly in order ---
{
    const io = new FakeIo();
    let running = false;
    let overlap = false;
    const wrap = (id) => async () => {
        if (running) overlap = true;
        running = true;
        await executeQueue(["a", "a"], { io, tapSettleFrames: 1 });
        running = false;
        return id;
    };
    // Two executeQueue calls fired with no await between them. The module-level
    // chain must serialize them; if they ran concurrently, `overlap` flips.
    const p1 = executeQueue(["a"], { io, tapSettleFrames: 1 });
    const p2 = executeQueue(["b"], { io, tapSettleFrames: 1 });
    const [r1, r2] = await Promise.all([p1, p2]);
    check("queue: concurrent calls both complete", r1.completed && r2.completed);
    check("queue: concurrent calls are serialized (no overlap)", overlap === false);
    // Order preserved: all of queue1's taps before queue2's? With 1 action each
    // we can only assert total; assert order via a longer interleaving instead:
    const io2 = new FakeIo();
    await Promise.all([
        executeQueue(["a", "a", "a"], { io: io2, tapSettleFrames: 1 }),
        executeQueue(["b", "b", "b"], { io: io2, tapSettleFrames: 1 }),
    ]);
    // Serialized => the three A's are contiguous, then the three B's (or vice
    // versa) — never interleaved A,B,A,B,A,B.
    const seq = io2.tapLog.join("");
    check("queue: presses from concurrent queues are not interleaved",
        seq === "AAABBB" || seq === "BBBAAA", seq);
}

// --- awaitFrames: returns once counter advanced by n -----------------------
{
    const io = new FakeIo({ startFrame: 100, framesPerDelay: 2 });
    const before = io.frame;
    const elapsed = await awaitFrames(io, 6);
    check("awaitFrames: advances until n frames elapsed", elapsed >= 6, String(elapsed));
    check("awaitFrames: frame counter actually moved", io.frame - before >= 6, `${io.frame - before}`);
}

// --- awaitFrames: n<=0 is a no-op -----------------------------------------
{
    const io = new FakeIo();
    const elapsed = await awaitFrames(io, 0);
    check("awaitFrames: n<=0 returns 0 immediately", elapsed === 0);
}

// --- awaitFrames: fallback to wall-clock when counter unreadable -----------
{
    const io = new FakeIo();
    io.readFrame = async () => -1; // emulator "paused" / counter unavailable
    let delayed = 0;
    io.delay = async (ms) => { delayed = ms; };
    const elapsed = await awaitFrames(io, 4);
    check("awaitFrames: unreadable counter -> wall-clock fallback", delayed === Math.ceil(4 * MS_PER_FRAME));
    check("awaitFrames: fallback reports n", elapsed === 4);
}

// --- advanceDialog: already unlocked -> nothing to do ----------------------
{
    const io = new FakeIo();
    let polls = 0;
    const pollState = async () => { polls++; return dlgState({ progress: { controlsLocked: false } }); };
    const res = await advanceDialog({ io, pollState, maxPresses: 5 });
    check("dialog: already unlocked -> completed NONE, 0 presses",
        res.completed === true && res.stopReason === STOP_REASON.NONE && res.pressesUsed === 0,
        JSON.stringify(res));
    check("dialog: already unlocked -> exactly one baseline poll", polls === 1, `polls=${polls}`);
    check("dialog: already unlocked -> no presses sent", io.tapLog.length === 0);
}

// --- advanceDialog: started mid-battle surfaces it -------------------------
{
    const io = new FakeIo();
    const pollState = async () => dlgState({ battle: { active: true } });
    const res = await advanceDialog({ io, pollState, maxPresses: 5 });
    check("dialog: started mid-battle -> BATTLE_STARTED, 0 presses",
        res.completed === false && res.stopReason === STOP_REASON.BATTLE_STARTED && res.pressesUsed === 0,
        JSON.stringify(res));
}

// --- advanceDialog: unlock after k presses -> NONE ------------------------
{
    const io = new FakeIo();
    let polls = 0;
    const pollState = async () => {
        polls++;
        // Locked for the first 3 polls (1 baseline + 2 post-press), then unlock.
        return dlgState({ progress: { controlsLocked: polls <= 3 } });
    };
    const res = await advanceDialog({ io, pollState, maxPresses: 20, pressSettleFrames: 1 });
    check("dialog: unlock after presses -> completed NONE",
        res.completed === true && res.stopReason === STOP_REASON.NONE, JSON.stringify(res));
    check("dialog: pressesUsed counts the mashes that cleared it", res.pressesUsed >= 1, String(res.pressesUsed));
    check("dialog: actually mashed A while locked", io.tapLog.length === res.pressesUsed && io.tapLog.every((b) => b === "A"),
        JSON.stringify(io.tapLog));
}

// --- advanceDialog: battle surfaces mid-mash ------------------------------
{
    const io = new FakeIo();
    let polls = 0;
    const pollState = async () => {
        polls++;
        if (polls <= 2) return dlgState({ progress: { controlsLocked: true } });
        return dlgState({ progress: { controlsLocked: false }, battle: { active: true } });
    };
    const res = await advanceDialog({ io, pollState, maxPresses: 20, pressSettleFrames: 1 });
    check("dialog: battle surfaces mid-mash -> BATTLE_STARTED",
        res.completed === false && res.stopReason === STOP_REASON.BATTLE_STARTED, JSON.stringify(res));
    check("dialog: battle-surfaced presses counted", res.pressesUsed >= 1, String(res.pressesUsed));
}

// --- advanceDialog: unexpected menu surfaces -------------------------------
{
    const io = new FakeIo();
    let polls = 0;
    const pollState = async () => {
        polls++;
        if (polls <= 2) return dlgState({ progress: { controlsLocked: true } });
        return dlgState({ progress: { controlsLocked: false }, menu: { partyMenuOpen: true } });
    };
    const res = await advanceDialog({ io, pollState, maxPresses: 20, pressSettleFrames: 1 });
    check("dialog: party menu mid-mash -> UNEXPECTED_MENU",
        res.completed === false && res.stopReason === STOP_REASON.UNEXPECTED_MENU, JSON.stringify(res));
}

// --- advanceDialog: exhaust maxPresses still locked -> CHOICE_REQUIRED ------
{
    const io = new FakeIo();
    const pollState = async () => dlgState({ progress: { controlsLocked: true } }); // never unlocks
    const res = await advanceDialog({ io, pollState, maxPresses: 4, pressSettleFrames: 1 });
    check("dialog: never unlocks -> CHOICE_REQUIRED",
        res.completed === false && res.stopReason === STOP_REASON.CHOICE_REQUIRED, JSON.stringify(res));
    check("dialog: maxPresses honored", res.pressesUsed === 4, String(res.pressesUsed));
    check("dialog: mashed exactly maxPresses times", io.tapLog.length === 4, String(io.tapLog.length));
}

// --- advanceDialog: alternate mash toggles A/B -----------------------------
{
    const io = new FakeIo();
    let polls = 0;
    const pollState = async () => {
        polls++;
        // Unlock right after a handful of presses.
        return dlgState({ progress: { controlsLocked: polls <= 4 } });
    };
    const res = await advanceDialog({ io, pollState, button: "a", alternate: "b", maxPresses: 20, pressSettleFrames: 1 });
    check("dialog: alternate mash completes", res.completed === true, JSON.stringify(res));
    // Odd-indexed presses (1st, 3rd, ...) should be B; even (0th, 2nd, ..) A.
    const oddB = io.tapLog.filter((_, i) => i % 2 === 1).every((b) => b === "B");
    const evenA = io.tapLog.filter((_, i) => i % 2 === 0).every((b) => b === "A");
    check("dialog: alternate mash toggles B on odd presses", oddB && evenA, JSON.stringify(io.tapLog));
}

// --- advanceDialog: AbortSignal stops mid-mash ----------------------------
{
    const io = new FakeIo();
    const ctrl = new AbortController();
    let polls = 0;
    const pollState = async () => {
        polls++;
        if (polls === 2) ctrl.abort();
        return dlgState({ progress: { controlsLocked: true } });
    };
    const res = await advanceDialog({ io, pollState, signal: ctrl.signal, maxPresses: 50, pressSettleFrames: 1 });
    check("dialog: abort stops the mash", res.completed === false && res.stopReason === STOP_REASON.NONE,
        JSON.stringify(res));
    check("dialog: abort -> pressesUsed bounded below max", res.pressesUsed < 50, String(res.pressesUsed));
}

// --- defaultIo sanity: exposes the real transport --------------------------
{
    check("defaultIo: exposes tap/hold/readFrame/delay",
        typeof defaultIo.tap === "function" &&
        typeof defaultIo.hold === "function" &&
        typeof defaultIo.readFrame === "function" &&
        typeof defaultIo.delay === "function");
    check("DEFAULT_TAP_SETTLE_FRAMES: sane default", DEFAULT_TAP_SETTLE_FRAMES >= 1);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
