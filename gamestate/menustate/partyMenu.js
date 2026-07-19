import { readUint8, readUint32 } from '../emulatorInteraction/httpMemoryReader.js';
import * as CONSTANTS from '../constant/constants.js';

/**
 * @deprecated This function doesn't actually work; the internal pointer isn't cleared when the party menu is closed.
 * Checks if the party menu is currently open.
 * @returns {Promise<boolean>} True if the party menu is open, false otherwise.
 */
export async function isPartyMenuOpen() {
    try {
        const internalPointer = await readUint32(CONSTANTS.PARTY_MENU_INTERNAL_ADDR);
        if (internalPointer === 0) {
            return false;
        }
        const menuState = await readUint32(internalPointer);
        return menuState !== 0;
    } catch (error) {
        console.error("Error checking party menu state:", error);
        return false; // Assume closed on error
    }
}

/**
 * Whether the party menu handler has ever been allocated this boot. The
 * pointer at PARTY_MENU_INTERNAL_ADDR is set the first time the party menu
 * opens and never cleared again (see isPartyMenuOpen's docstring) — useless
 * as a live open/closed signal, but a reliable "has this menu ever been used
 * this session" latch. Needed because getPartyMenuSlotId's backing byte is
 * zero-initialized at boot (slot 0, not the documented closed value 7) until
 * the game's own ClosePartyMenu code writes a real closed value, so slot-only
 * detection false-positives as "open" on a fresh save that hasn't opened the
 * party menu yet.
 * @returns {Promise<boolean>}
 */
export async function isPartyMenuHandlerAllocated() {
    try {
        const internalPointer = await readUint32(CONSTANTS.PARTY_MENU_INTERNAL_ADDR);
        return internalPointer !== 0;
    } catch (error) {
        console.error("Error checking party menu handler allocation:", error);
        return false; // Assume never-allocated (closed) on error
    }
}

/**
 * Reads the current party menu slot ID.
 * 7 indicates either the menu is closed or the Exit button is selected
 * Yes, it's inconsistent and sucks, I know it's disappointing.
 * @returns {Promise<number|null>} The current slot ID, or null if an error occurs.
 */
export async function getPartyMenuSlotId() {
    try {
        const slotId = await readUint8(CONSTANTS.PARTY_MENU_ADDR + CONSTANTS.PARTY_MENU_SLOTID_OFFSET);
        return slotId;
    } catch (error) {
        console.error("Error reading party menu slot ID:", error);
        return null;
    }
}

