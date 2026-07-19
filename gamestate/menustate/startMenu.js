import { readUint8 } from '../emulatorInteraction/httpMemoryReader.js';
import * as CONSTANTS from '../constant/constants.js';

/**
 * Reads the start menu's persistent cursor position (sStartMenuCursorPos in
 * start_menu.c): a 0-based index into the currently visible entry list,
 * readable at any time (not just while the menu is open) since it's a
 * file-scope EWRAM static that's only ever written on cursor move, never
 * reset on close. The decomp's Menu_MoveCursor wraps top<->bottom, so this
 * is the only reliable way to know where "start" will land the cursor —
 * see menuMacros.js's buildStartMenuToBagSequence for why blind navigation
 * is unsafe (it can land on SAVE and complete a real save).
 *
 * Returns null on games without a live-verified address (see
 * GAMESTATE_CONSTANTS_FRLG.js) — callers must fall back to gap-limited
 * navigation in that case.
 * @returns {Promise<number|null>}
 */
export async function getStartMenuCursorPos() {
    if (CONSTANTS.START_MENU_CURSOR_ADDR == null) return null;
    try {
        return await readUint8(CONSTANTS.START_MENU_CURSOR_ADDR);
    } catch (error) {
        console.error("Error reading start menu cursor position:", error);
        return null;
    }
}
