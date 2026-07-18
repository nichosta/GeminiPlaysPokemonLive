// =============================================================================
// BUTTON HOLD WRAPPER (legacy facade over the B3 input executor)
// =============================================================================
//
// `holdButtons` is the original "hold a button for N frames" entry point the
// agent loop calls (Mach-bike speed-up, long holds). As of B3 it is a thin
// facade over `executeQueue` (tools/inputExecutor.js): same signature, but it
// now uses the executor's frame-accurate, serialized, retried input path and
// the correct `/mgba-http/button/hold?button=&duration=` query (the old `?key=`
// form was stale relative to the current mGBA-http ButtonApi). The redundant
// wall-clock sleep after each hold is gone — the executor gates on the
// emulator's frame counter instead.
// =============================================================================

import { executeQueue } from "./inputExecutor.js";

/**
 * Holds each button in `buttonsToHoldArray` for its specified duration (in
 * frames; game runs at 60 FPS), sequentially. Delegates to executeQueue.
 *
 * @param {Array<{buttonName: string, durationFrames: number}>} buttonsToHoldArray
 * @returns {Promise<{completed:boolean, stepsUsed:number, error?:string}>}
 * @throws {Error} on invalid input or a bad button name.
 */
export async function holdButtons(buttonsToHoldArray) {
    if (!Array.isArray(buttonsToHoldArray) ||
        buttonsToHoldArray.some((item) => typeof item?.buttonName !== "string" || typeof item.durationFrames !== "number" || item.durationFrames <= 0)) {
        throw new Error("Invalid input: buttonsToHoldArray must be an array of {buttonName: string, durationFrames: positive number} objects.");
    }
    const actions = buttonsToHoldArray.map(({ buttonName, durationFrames }) => ({
        button: buttonName,
        frames: Math.max(1, Math.floor(durationFrames)),
    }));
    return executeQueue(actions);
}
