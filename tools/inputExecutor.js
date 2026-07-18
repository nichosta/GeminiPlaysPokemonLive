// =============================================================================
// INPUT EXECUTOR (B3)
// =============================================================================
//
// Reliable, frame-accurate button queue + a dialog-advance primitive. This is
// the single low-level input path for the harness: the legacy pressButtons /
// holdButtons wrappers delegate here (see tools/buttonPress.js,
// tools/buttonHold.js), and the C-workstream macros / D1 `press` escape hatch
// compose on top of it.
//
// Why this replaces the old tap-then-setTimeout(500) path:
//   - Frame-accurate timing. The GBA runs at 60 FPS; one frame ≈ 16.67ms. The
//     old queue paced taps with a wall-clock 500ms sleep (~30 frames between
//     presses) — slow AND decoupled from what the emulator is actually doing.
//     Here every press is gated on the emulator's OWN frame counter
//     (`/core/currentFrame`): after sending a press we wait until that counter
//     has advanced by the requested number of frames before sending the next,
//     so the queue advances exactly with the game. A wall-clock timeout caps
//     each wait so a paused / frozen emulator can't hang the queue forever.
//   - Reliable. Buttons are validated against a closed enum; transient network
//     errors (ECONNREFUSED, 5xx) are retried with backoff; genuine 4xx errors
//     surface immediately; every executeQueue() call is serialized through one
//     module-level promise chain so concurrent callers (a cross-map goto and a
//     dialog-advance firing together) can never interleave their presses.
//   - Interrupt-aware. executeQueue() takes an optional per-step `onStep` hook
//     so C2's gotoLive / C5's dialog handler can poll B2's classifyInterrupt
//     after each press and abort the queue the moment a stop condition fires.
//
// mGBA-http button API (src/mGBAHttp/Endpoints/ButtonApi.cs, matches the
// installed 0.8.x line):
//   POST /mgba-http/button/tap?button=A       press + release (one input)
//   POST /mgba-http/button/hold?button=A&duration=N   held for N frames
// The emulator counts the hold's N frames itself, so a hold IS frame-accurate
// on mGBA's side; the network round-trip only adds jitter between commands.
// `/core/currentFrame` (GET) returns the running frame counter used to gate.
//
// NOTE from the mGBA-http README: it is not built for frame-PERFECT (sub-frame)
// TAS-style manipulation — there is network latency on every call. "Frame-
// accurate" here means "paced to whole emulator frames," which is what an
// AI/Twitch-plays harness needs; it is not a claim of sub-frame determinism.
// =============================================================================

import { getState } from "../gamestate/getState.js";
import { classifyInterrupt } from "../gamestate/interruptDetector.js";
import { STOP_REASON } from "../llminteract/toolInterface.js";

const BUTTON_ENDPOINT = "http://localhost:5000/mgba-http/button";
const CORE_ENDPOINT = "http://localhost:5000/core";

export const FRAME_RATE_FPS = 60;
export const MS_PER_FRAME = 1000 / FRAME_RATE_FPS;

/** Default frame budget awaited after a tap to confirm the input was consumed
 *  by at least one emulator frame before the next press. Small by design: a
 *  directional tap is one tile step, and mGBA buffers input, so a 1-frame gate
 *  keeps a multi-press sequence tight without dropping presses. */
export const DEFAULT_TAP_SETTLE_FRAMES = 1;

/** Caps how long awaitFrames() will poll the frame counter before falling back
 *  (so a paused/frozen emulator cannot hang the queue). Generous relative to
 *  the requested frame count; the wall-clock fallback inside is the real cap. */
const FRAME_POLL_TIMEOUT_MS = 2000;
const FRAME_POLL_INTERVAL_MS = 8;

/** Canonical mGBA button names (lowercase alias -> exact API casing). */
const BUTTON_CASING = Object.freeze({
    a: "A",
    b: "B",
    l: "L",
    r: "R",
    start: "Start",
    select: "Select",
    up: "Up",
    down: "Down",
    left: "Left",
    right: "Right",
});
const VALID_BUTTONS = new Set(Object.keys(BUTTON_CASING));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Validates a button name and returns the exact casing the mGBA API expects.
 * @param {string} name
 * @returns {string} the API-cased button name
 * @throws {Error} if the button is not in the closed enum
 */
export function canonicalButton(name) {
    if (typeof name !== "string" || !name) {
        throw new Error(`Invalid button: ${String(name)}`);
    }
    const lower = name.toLowerCase();
    if (!VALID_BUTTONS.has(lower)) {
        throw new Error(`Invalid button "${name}". Valid: ${Object.keys(BUTTON_CASING).join(", ")}`);
    }
    return BUTTON_CASING[lower];
}

// -----------------------------------------------------------------------------
// Low-level HTTP calls. Retry transient failures (network errors, 5xx, 408,
// 429) with linear backoff; 4xx (other than 408/429) is a real client error and
// surfaces immediately. These hit a live mGBA-http server; tests inject a fake
// `io` to avoid needing an emulator.
// -----------------------------------------------------------------------------

async function postWithRetry(url, retries = 2) {
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const res = await fetch(url, { method: "POST" });
            if (res.ok) return;
            const body = await res.text().catch(() => "");
            const err = new Error(`HTTP ${res.status} ${res.statusText}${body ? `: ${body}` : ""}`);
            // Non-transient client error — don't retry, surface immediately.
            if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
                throw err;
            }
            lastError = err;
        } catch (e) {
            // Network-level failure (ECONNREFUSED, DNS, reset) — retriable.
            lastError = e;
        }
        if (attempt < retries) await sleep(50 * (attempt + 1));
    }
    throw lastError;
}

/** GET /core/currentFrame -> integer frame counter. Returns -1 if unavailable. */
export async function readCurrentFrame() {
    try {
        const res = await fetch(`${CORE_ENDPOINT}/currentFrame`, { method: "GET" });
        if (!res.ok) return -1;
        const text = await res.text();
        const n = Number.parseInt(text.trim(), 10);
        return Number.isFinite(n) ? n : -1;
    } catch {
        return -1;
    }
}

/** POST /mgba-http/button/tap — one press+release. Retries transient errors. */
export async function httpTap(button) {
    const cased = canonicalButton(button);
    await postWithRetry(`${BUTTON_ENDPOINT}/tap?button=${encodeURIComponent(cased)}`);
}

/** POST /mgba-http/button/hold — held for `frames` emulator frames. */
export async function httpHold(button, frames) {
    if (!Number.isInteger(frames) || frames <= 0) {
        throw new Error(`hold duration must be a positive integer (got ${frames})`);
    }
    const cased = canonicalButton(button);
    await postWithRetry(`${BUTTON_ENDPOINT}/hold?button=${encodeURIComponent(cased)}&duration=${frames}`);
}

// -----------------------------------------------------------------------------
// Frame-accurate wait. Polls the emulator's own frame counter until it has
// advanced `n` frames since `since` (captured before the press), then returns.
// Falls back to a wall-clock sleep if the counter can't be read (emulator
// paused / server unreachable) so the queue never hangs.
// -----------------------------------------------------------------------------

/**
 * Waits until the emulator frame counter has advanced by `n` since `since` (or
 * since now if `since` omitted). Returns the number of frames that actually
 * elapsed (≥ n on success; possibly fewer on timeout/fallback).
 * @param {object} io injectable transport (test hook)
 * @param {number} n frames to await
 * @param {{since?:number, timeoutMs?:number}} [opts]
 * @returns {Promise<number>} frames elapsed
 */
export async function awaitFrames(io, n, opts = {}) {
    if (n <= 0) return 0;
    const timeoutMs = opts.timeoutMs ?? FRAME_POLL_TIMEOUT_MS;
    const start = Date.now();
    const baseline = opts.since ?? (await safeReadFrame(io));

    // If the counter is unreadable, fall back to a wall-clock frame sleep. The
    // README warns network timing isn't frame-perfect, so this branch is a best
    // effort for a paused/unreachable emulator, not a precision claim.
    if (baseline < 0) {
        await io.delay(Math.ceil(n * MS_PER_FRAME));
        return n;
    }

    for (;;) {
        const cur = await safeReadFrame(io);
        if (cur >= 0 && cur - baseline >= n) {
            return cur - baseline;
        }
        if (Date.now() - start >= timeoutMs) {
            // Timed out (likely paused emulator) — release the queue with a
            // final wall-clock sleep so a downstream poll has something to read.
            await io.delay(Math.ceil(n * MS_PER_FRAME));
            return cur >= 0 ? Math.max(0, cur - baseline) : n;
        }
        await io.delay(FRAME_POLL_INTERVAL_MS);
    }
}

async function safeReadFrame(io) {
    try {
        return await io.readFrame();
    } catch {
        return -1;
    }
}

// -----------------------------------------------------------------------------
// Default transport: real HTTP. Tests inject a fake `io` instead.
// -----------------------------------------------------------------------------

export const defaultIo = Object.freeze({
    tap: (button) => httpTap(button),
    hold: (button, frames) => httpHold(button, frames),
    readFrame: () => readCurrentFrame(),
    delay: (ms) => sleep(ms),
});

// -----------------------------------------------------------------------------
// Reliable serialized button queue.
// -----------------------------------------------------------------------------

/**
 * Normalizes a queue element into `{button, frames}`. A bare string is a tap
 * (frames = 0). An object with `frames` > 0 is a hold; otherwise a tap.
 * @param {string|object} action
 * @returns {{button:string, frames:number}}
 */
function normalizeAction(action) {
    // canonicalButton validates against the closed enum AND normalizes casing,
    // so an invalid button name is rejected here regardless of the transport
    // (a fake `io` in tests never has to round-trip to the server to fail).
    if (typeof action === "string") return { button: canonicalButton(action), frames: 0 };
    if (action && typeof action === "object" && typeof action.button === "string") {
        return { button: canonicalButton(action.button), frames: Number.isInteger(action.frames) ? action.frames : 0 };
    }
    throw new Error(`Invalid queue action: ${JSON.stringify(action)}`);
}

/**
 * Module-level promise chain. Every executeQueue() call appends to this so
 * concurrent invocations run strictly serially — a goto leg and a dialog
 * advance firing at once can never interleave their presses on the socket.
 */
let queueChain = Promise.resolve();

/**
 * @typedef {Object} QueueOptions
 * @property {object} [io=defaultIo] Injectable transport (test hook).
 * @property {number} [tapSettleFrames=DEFAULT_TAP_SETTLE_FRAMES] Frames to gate
 *           after a tap before the next press.
 * @property {(index:number, action:{button:string,frames:number}) => Promise<boolean|void>|boolean|void} [onStep]
 *           Called after each press settles. Return truthy (or resolve truthy)
 *           to abort the queue at this point — used by C2/C5 to poll B2's
 *           classifyInterrupt after each press and stop on a stop condition.
 * @property {AbortSignal} [signal] Cooperative cancellation.
 */

/**
 * Runs a sequence of button presses serially with frame-accurate settling.
 *
 * @param {Array<string|object>|string} actions each element is a button name
 *        (tap) or `{button, frames}` (frames>0 → hold, else tap).
 * @param {QueueOptions} [options]
 * @returns {Promise<{completed:boolean, stepsUsed:number, stopped?:boolean, error?:string}>}
 *          `completed` is true iff every action ran without error or an onStep
 *          abort. `stopped` is set (with stepsUsed counting the last press)
 *          when `onStep` aborted. `error` is set on a bad button / network
 *          failure after retries.
 */
export function executeQueue(actions, options = {}) {
    const run = async () => {
        const {
            io = defaultIo,
            tapSettleFrames = DEFAULT_TAP_SETTLE_FRAMES,
            onStep,
            signal,
        } = options;

        const list = Array.isArray(actions) ? actions : [actions];
        let stepsUsed = 0;

        for (let i = 0; i < list.length; i++) {
            if (signal?.aborted) {
                return { completed: false, stepsUsed, stopped: true };
            }
            let action;
            try {
                action = normalizeAction(list[i]);
            } catch (e) {
                return { completed: false, stepsUsed, error: e.message };
            }

            const baseline = await safeReadFrame(io);
            try {
                if (action.frames > 0) {
                    await io.hold(action.button, action.frames);
                    await awaitFrames(io, action.frames, { since: baseline });
                } else {
                    await io.tap(action.button);
                    await awaitFrames(io, tapSettleFrames, { since: baseline });
                }
            } catch (e) {
                return { completed: false, stepsUsed, error: e.message };
            }
            stepsUsed++;

            if (onStep) {
                try {
                    const stop = await onStep(i, action);
                    if (stop) return { completed: false, stepsUsed, stopped: true };
                } catch (e) {
                    return { completed: false, stepsUsed, error: e.message };
                }
            }
        }
        return { completed: true, stepsUsed };
    };

    // Serialize: chain onto whatever is queued so far. The run() body never
    // rejects (it returns result objects), so a failure in one queue never
    // poisons the chain for the next.
    const next = queueChain.then(run, run);
    queueChain = next.catch(() => {});
    return next;
}

// -----------------------------------------------------------------------------
// Dialog-advance primitive: mash A/B until the overworld controls unlock OR a
// choice / interrupt surfaces. Built on B1's getState() + B2's
// classifyInterrupt() so it speaks the same STOP_REASON vocabulary as every
// other macro.
//
// `progress.controlsLocked` is the dialog/cutscene/script lock (see
// docs/state-snapshot.md). While it's true, classifyInterrupt() reports
// STOP_REASON.DIALOG and we keep mashing. The loop returns when:
//   - controls unlock (reason === null) -> NONE (dialog cleared).
//   - any other interrupt surfaces (battle / unexpected menu / HP low) -> that
//     STOP_REASON, verbatim, for the caller (C5 / the model) to handle.
//   - maxPresses exhausted while still locked -> CHOICE_REQUIRED: we couldn't
//     blast through, so a yes/no or selection prompt the snapshot can't read
//     directly is almost certainly blocking. (B2 deliberately leaves
//     CHOICE_REQUIRED to C5 — this is the runtime-layer detection of it.)
// =============================================================================

/**
 * @typedef {Object} DialogOptions
 * @property {string} [button='a'] Button to mash.
 * @property {string|null} [alternate=null] If set (e.g. 'b'), every other press
 *           uses this button — dislodges some menus that ignore a lone A.
 * @property {number} [maxPresses=60] Give up (→ CHOICE_REQUIRED) after this many.
 * @property {number} [pressSettleFrames=4] Frames to let each text box advance
 *           before re-pressing. Pokémon draws text slowly; too few frames and a
 *           press lands before the next box is ready.
 * @property {() => Promise<object>} [pollState] Snapshot source (defaults to
 *           B1's fast poll).
 * @property {number} [hpThreshold=0.2]
 * @property {boolean} [expectMenu=false] Forwarded to classifyInterrupt.
 * @property {object} [io=defaultIo] Injectable transport (test hook).
 * @property {AbortSignal} [signal]
 */

/**
 * Mashes A (optionally alternating with B) until the overworld controls unlock
 * or a choice/interrupt appears. Pure-transport-safe: the default polls B1's
 * getState() and presses via the executor.
 *
 * @param {DialogOptions} [options]
 * @returns {Promise<{completed:boolean, stopReason:string, state:object, pressesUsed:number, error?:string}>}
 */
export async function advanceDialog(options = {}) {
    const {
        button = "a",
        alternate = null,
        maxPresses = 60,
        pressSettleFrames = 4,
        pollState = () => getState({ includeMap: false, includeBag: false }),
        hpThreshold = 0.2,
        expectMenu = false,
        io = defaultIo,
        signal,
    } = options;

    // Canonicalize + validate up front so a bad button name fails here (not on
    // the first tap) and the transport always receives API-cased names.
    const mainButton = canonicalButton(button);
    const altButton = alternate ? canonicalButton(alternate) : null;

    const classifyOpts = { hpThreshold, expectMenu, baselineMap: null };
    let state = await pollState();
    let baselineReason = classifyInterrupt(state, classifyOpts);

    // Already unlocked and not in dialog — nothing to advance.
    if (baselineReason === null) {
        return { completed: true, stopReason: STOP_REASON.NONE, state, pressesUsed: 0 };
    }
    // Started mid-interrupt that isn't dialog (battle already active, menu open,
    // HP already low) — surface it; the caller owns that.
    if (baselineReason !== STOP_REASON.DIALOG) {
        return { completed: false, stopReason: baselineReason, state, pressesUsed: 0 };
    }

    let pressesUsed = 0;
    for (; pressesUsed < maxPresses; pressesUsed++) {
        if (signal?.aborted) {
            return { completed: false, stopReason: STOP_REASON.NONE, state, pressesUsed };
        }
        const pressButton = altButton && pressesUsed % 2 === 1 ? altButton : mainButton;
        try {
            const baseline = await safeReadFrame(io);
            await io.tap(pressButton);
            await awaitFrames(io, pressSettleFrames, { since: baseline });
        } catch (e) {
            return { completed: false, stopReason: STOP_REASON.NONE, state, pressesUsed, error: e.message };
        }

        state = await pollState();
        const reason = classifyInterrupt(state, classifyOpts);
        // null => controls unlocked; dialog cleared.
        if (reason === null) {
            return { completed: true, stopReason: STOP_REASON.NONE, state, pressesUsed: pressesUsed + 1 };
        }
        // Still in dialog → keep mashing. Anything else (battle/menu/hp) surfaces.
        if (reason !== STOP_REASON.DIALOG) {
            return { completed: false, stopReason: reason, state, pressesUsed: pressesUsed + 1 };
        }
    }

    // Exhausted the budget while still locked — a choice prompt the snapshot
    // can't read directly is almost certainly in the way.
    return { completed: false, stopReason: STOP_REASON.CHOICE_REQUIRED, state, pressesUsed };
}
