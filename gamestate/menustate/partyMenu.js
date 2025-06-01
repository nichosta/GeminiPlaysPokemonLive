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
 * Reads the current party menu slot ID.
 * 7 indicates either the menu is closed or the Exit button is selected
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

