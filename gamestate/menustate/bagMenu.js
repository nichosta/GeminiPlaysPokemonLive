import { readUint16 } from '../emulatorInteraction/httpMemoryReader.js';
import * as CONSTANTS from '../constant/constants.js';

/**
 * Reads the bag's Items pocket on-screen list cursor (gBagMenuState.cursorPos[0]
 * in item_menu.c: a 0-based row index that includes CANCEL as the row after
 * the last item), readable at any time — a file-scope EWRAM static, not
 * heap/pointer-indirected. Persists across bag opens (same class of gap as
 * the start-menu cursor — see menuMacros.js's buildStartMenuToBagSequence),
 * so this is the only reliable way to know where the Items pocket cursor
 * will be without blindly assuming it resets to 0.
 *
 * Only the Items pocket (index 0) is live-verified; Key Items and Poké Balls
 * likely sit at +2/+4 bytes in the same array but aren't wired up yet.
 *
 * Returns null on games without a live-verified address (see
 * GAMESTATE_CONSTANTS_FRLG.js) — callers must fall back to gap-limited
 * navigation in that case.
 * @returns {Promise<number|null>}
 */
export async function getBagItemsPocketCursorPos() {
    if (CONSTANTS.BAG_ITEMS_POCKET_CURSOR_ADDR == null) return null;
    try {
        return await readUint16(CONSTANTS.BAG_ITEMS_POCKET_CURSOR_ADDR);
    } catch (error) {
        console.error("Error reading bag items pocket cursor position:", error);
        return null;
    }
}
