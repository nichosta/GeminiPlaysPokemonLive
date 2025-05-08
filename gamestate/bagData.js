// gamestate/bagData.js
import { readUint16, readUint32, readRange } from "./httpMemory/httpMemoryReader.js"; // readUint16 was missing from imports, added it
import { getItemName } from '../constant/item_map.js';
import * as CONSTANTS from "./constant/constants.js";

// --- Core Functions ---

/**
 * Reads the security key used for encrypting item quantities.
 * @returns {Promise<number>} The 32-bit security key.
 * @throws {Error} If memory reads fail.
 */
async function getSecurityKey() {
    try {
        // 1. Read the base pointer from SECURITY_KEY_POINTER_ADDR
        const basePointer = await readUint32(CONSTANTS.SECURITY_KEY_POINTER_ADDR);
        if (basePointer === 0) {
            throw new Error("Security key base pointer is null.");
        }

        // 2. Calculate the actual address of the security key
        const securityKeyAddr = basePointer + CONSTANTS.SECURITY_KEY_OFFSET;

        // 3. Read the 32-bit security key from the calculated address
        const securityKey = await readUint32(securityKeyAddr);
        // console.debug(`[getSecurityKey] Read security key: 0x${securityKey.toString(16)} from address 0x${securityKeyAddr.toString(16)} (Base ptr: 0x${basePointer.toString(16)})`);
        return securityKey;
    } catch (error) {
        console.error("[getSecurityKey] Failed to read security key:", error);
        throw new Error(`Failed to retrieve security key: ${error.message}`);
    }
}

/**
 * Gets the memory pointer and capacity for a specific bag pocket.
 * @param {number} pocketIndex - The index of the pocket (0-4, use POCKETS enum).
 * @returns {Promise<{pointer: number, capacity: number}>} Object containing the pocket's start address and item capacity.
 * @throws {Error} If the pocket index is invalid or memory reads fail.
 */
async function getPocketInfo(pocketIndex) {
    if (pocketIndex < 0 || pocketIndex >= CONSTANTS.POCKET_COUNT) {
        throw new Error(`Invalid pocket index: ${pocketIndex}. Must be between 0 and ${CONSTANTS.POCKET_COUNT - 1}.`);
    }

    const pocketInfoAddr = CONSTANTS.BAG_MAIN_ADDR + (pocketIndex * CONSTANTS.POCKET_ENTRY_SIZE);
    // console.debug(`[getPocketInfo] Reading pocket info for index ${pocketIndex} at address 0x${pocketInfoAddr.toString(16)}`);

    try {
        // Read the 8 bytes containing the pointer and capacity
        const pocketDataBytes = await readRange(pocketInfoAddr, CONSTANTS.POCKET_ENTRY_SIZE);
        if (pocketDataBytes.length !== CONSTANTS.POCKET_ENTRY_SIZE) {
             throw new Error(`Read incomplete pocket info data (${pocketDataBytes.length} bytes instead of ${CONSTANTS.POCKET_ENTRY_SIZE}).`);
        }

        // Use DataView to easily parse little-endian values
        const buffer = Uint8Array.from(pocketDataBytes).buffer;
        const view = new DataView(buffer);

        const pointer = view.getUint32(0, true); // Offset 0, u32, little-endian
        const capacity = view.getUint32(4, true); // Offset 4, u32, little-endian

        // console.debug(`[getPocketInfo] Pocket ${pocketIndex} (${GAMESTATE_CONSTANTS.POCKET_NAMES[pocketIndex]}): Pointer=0x${pointer.toString(16)}, Capacity=${capacity}`);

        if (pointer === 0) {
            console.warn(`[getPocketInfo] Pocket ${pocketIndex} pointer is null. The pocket might be inaccessible or empty.`);
            // Return zero capacity to prevent reading from address 0x0
             return { pointer: 0, capacity: 0 };
        }


        return { pointer, capacity };
    } catch (error) {
        console.error(`[getPocketInfo] Failed to read info for pocket ${pocketIndex}:`, error);
        throw new Error(`Failed to get pocket info for index ${pocketIndex}: ${error.message}`);
    }
}

/**
 * Reads and decrypts all items within a specific bag pocket.
 * @param {number} pocketIndex - The index of the pocket (0-4, use POCKETS enum).
 * @param {number} securityKey - The 32-bit security key obtained from getSecurityKey().
 * @returns {Promise<Array<{id: number, name: string | undefined, quantity: number}>>} An array of items in the pocket.
 * @throws {Error} If memory reads or decryption fails.
 */
async function readPocketItems(pocketIndex, securityKey) {
    const pocketInfo = await getPocketInfo(pocketIndex);

    // If pointer is 0 or capacity is 0, the pocket is empty or inaccessible
    if (pocketInfo.pointer === 0 || pocketInfo.capacity === 0) {
        // console.debug(`[readPocketItems] Pocket ${pocketIndex} (${GAMESTATE_CONSTANTS.POCKET_NAMES[pocketIndex]}) is empty or inaccessible (Pointer: ${pocketInfo.pointer}, Capacity: ${pocketInfo.capacity}).`);
        return [];
    }

    const totalBytesToRead = pocketInfo.capacity * CONSTANTS.ITEM_ENTRY_SIZE;
    // console.debug(`[readPocketItems] Reading ${totalBytesToRead} bytes for pocket ${pocketIndex} from address 0x${pocketInfo.pointer.toString(16)}`);

    const items = [];
    try {
        const pocketDataBytes = await readRange(pocketInfo.pointer, totalBytesToRead);
        if (pocketDataBytes.length !== totalBytesToRead) {
            console.warn(`[readPocketItems] Read incomplete item data for pocket ${pocketIndex} (${pocketDataBytes.length} bytes instead of ${totalBytesToRead}).`);
            // Proceed with the data we have, but it might be truncated.
        }

        const buffer = Uint8Array.from(pocketDataBytes).buffer;
        const view = new DataView(buffer);

        // Extract the lower 16 bits of the security key for decryption
        const quantityDecryptionKey = securityKey & 0xFFFF;
        // console.debug(`[readPocketItems] Using quantity decryption key: 0x${quantityDecryptionKey.toString(16)} (from 0x${securityKey.toString(16)})`);

        for (let i = 0; i < pocketInfo.capacity; i++) {
            const offset = i * CONSTANTS.ITEM_ENTRY_SIZE;

            // Ensure we don't read past the actual buffer length if the read was incomplete
            if (offset + CONSTANTS.ITEM_ENTRY_SIZE > view.byteLength) {
                 console.warn(`[readPocketItems] Stopping item read for pocket ${pocketIndex} due to incomplete data at slot ${i}.`);
                 break;
            }

            const itemId = view.getUint16(offset, true);         // Offset +0, u16, little-endian
            const encryptedQuantity = view.getUint16(offset + 2, true); // Offset +2, u16, little-endian

            // Stop processing items in this pocket if we hit an empty slot (ITEM_NONE = 0)
            if (itemId === 0) {
                // console.debug(`[readPocketItems] Found empty slot (ItemID 0) at index ${i} in pocket ${pocketIndex}. Stopping read for this pocket.`);
                break;
            }

            // Decrypt the quantity by XORing with the lower 16 bits of the security key
            const quantity = encryptedQuantity ^ quantityDecryptionKey; // <-- UPDATED LINE

            const itemName = getItemName(itemId); // Look up the name

            items.push({
                id: itemId,
                name: itemName || `Unknown Item (ID: ${itemId})`, // Provide fallback name
                quantity: quantity
            });
            // console.debug(`[readPocketItems] Pocket ${pocketIndex}, Slot ${i}: ID=${itemId} (${itemName}), EncQty=0x${encryptedQuantity.toString(16)}, DecQty=${quantity}`);
        }

        // console.debug(`[readPocketItems] Found ${items.length} items in pocket ${pocketIndex} (${GAMESTATE_CONSTANTS.POCKET_NAMES[pocketIndex]})`);
        return items;

    } catch (error) {
        console.error(`[readPocketItems] Failed to read items for pocket ${pocketIndex}:`, error);
        throw new Error(`Failed to read items for pocket ${pocketIndex}: ${error.message}`);
    }
}

// --- Public API Function ---

/**
 * Reads the entire contents of the player's bag, organized by pocket.
 * @returns {Promise<Object<string, Array<{id: number, name: string | undefined, quantity: number}>>>}
 *          An object where keys are pocket names and values are arrays of items in that pocket.
 * @throws {Error} If any part of the process fails (reading key, pockets, or items).
 */
export async function getBagContents() {
    // console.log("[getBagContents] Starting to read bag contents...");
    const bagContents = {};
    try {
        const securityKey = await getSecurityKey();

        for (let i = 0; i < CONSTANTS.POCKET_COUNT; i++) {
            const pocketName = CONSTANTS.POCKET_NAMES[i];
            // console.debug(`[getBagContents] Reading pocket: ${pocketName} (Index ${i})`);
            try {
                const items = await readPocketItems(i, securityKey);
                bagContents[pocketName] = items;
            } catch (pocketError) {
                console.error(`[getBagContents] Failed to read pocket "${pocketName}":`, pocketError);
                // Assign an empty array or re-throw, depending on desired behavior on partial failure
                bagContents[pocketName] = [];
                 // Optionally re-throw if any pocket failure should stop the whole process:
                 // throw pocketError;
            }
        }
        // console.log("[getBagContents] Successfully read all bag pockets.");
        return bagContents;
    } catch (error) {
        console.error("[getBagContents] Failed to read bag contents:", error);
        // Re-throw the error to indicate the overall operation failed
        throw new Error(`Could not retrieve bag contents: ${error.message}`);
    }
}

/**
 * Prints the bag contents to the console in a readable format.
 * @param {Object<string, Array<{id: number, name: string | undefined, quantity: number}>>} bagContents
 *          The bag contents object returned by getBagContents().
 */
export function prettyPrintBag(bagContents) {
    let bagString = "Bag Contents:\n";
    CONSTANTS.POCKET_NAMES.forEach(pocketName => {
        bagString +=`${pocketName}:\n`; // Print pocket name
        const items = bagContents[pocketName];
        if (items && items.length > 0) {
            items.forEach(item => {
                // Print each item indented with quantity
                bagString += `\t${item.name} x${item.quantity}\n`;
            });
        } else {
            // Optionally indicate if the pocket is empty
            bagString += "\t(Empty)\n";
        }
    });
    return bagString;
}

// Get money function (including XORing value with encryption key)
/**
 * Gets the player's current money.
 * @returns {Promise<number>} The player's money.
 */
export async function getPlayerMoney() {
    try {
        // 1. Read the base pointer from PLAYER_OBJECT_POINTER_ADDR
        const basePointer = await readUint32(CONSTANTS.PLAYER_OBJECT_POINTER_ADDR);
        if (basePointer === 0) {
            throw new Error("Player object base pointer is null.");
        }

        // 2. Calculate the actual address of the encrypted money value
        const encryptedMoneyAddr = basePointer + CONSTANTS.MONEY_OFFSET;

        // 3. Read the 32-bit encrypted money value from the calculated address
        const encryptedMoney = await readUint32(encryptedMoneyAddr);

        // 4. Get the security key for decryption
        const securityKey = await getSecurityKey();

        // 5. Decrypt the money value by XORing with the security key
        const decryptedMoney = encryptedMoney ^ securityKey;

        return decryptedMoney;
    } catch (error) {
        console.error("[getPlayerMoney] Failed to read or decrypt player's money:", error);
        throw new Error(`Failed to retrieve player's money: ${error.message}`);
    }
}