// =============================================================================
// BUTTON TAP WRAPPER (legacy facade over the B3 input executor)
// =============================================================================
//
// `pressButtons` is the original tap entry point the agent loop and C2's
// gotoLive call. As of B3 it is a thin facade over `executeQueue`
// (tools/inputExecutor.js): same signature, but the per-press pacing is now
// frame-accurate (gated on the emulator's own frame counter) and presses are
// serialized + retried through the one shared input path instead of a
// wall-clock setTimeout(500) sleep. See inputExecutor.js for the rationale.
// =============================================================================

import { executeQueue } from "./inputExecutor.js";

/**
 * Sends a sequence of button taps to mGBA. Accepts a single button name or an
 * array of button names (case-insensitive: 'A', 'a', 'Start', 'start', …).
 *
 * Delegates to executeQueue, so presses are validated against the closed
 * button enum, paced to whole emulator frames, and retried on transient
 * network errors.
 *
 * @param {string|string[]} buttons
 * @returns {Promise<{completed:boolean, stepsUsed:number, error?:string}>}
 * @throws {Error} if a button name is invalid (via executeQueue's validation).
 */
export async function pressButtons(buttons) {
    const list = Array.isArray(buttons) ? buttons : [buttons];
    return executeQueue(list);
}
