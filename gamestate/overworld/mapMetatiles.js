import { readUint32, readRange } from '../emulatorInteraction/httpMemoryReader.js';
import * as CONSTANTS from "../constant/constants.js";
import { getMainMapLayoutBaseAddress } from './mapLayouts.js';
import { getMetatileBehaviorName } from '../../constant/metatile_behaviors_map.js'

const BYTES_PER_METATILE_ATTRIBUTE = 2; // Each attribute is a u16

/**
 * Retrieves the base addresses of the primary and secondary tilesets for the current map.
 * @param {number} mapLayoutBaseAddress The base address of the current map's layout structure.
 * @returns {Promise<{primaryTilesetAddress: number, secondaryTilesetAddress: number}>}
 *          An object containing the addresses, or 0 if not found or error.
 */
async function getTilesetPointers(mapLayoutBaseAddress) {
    if (!mapLayoutBaseAddress) {
        console.error("getTilesetPointers: Invalid mapLayoutBaseAddress provided (0).");
        return { primaryTilesetAddress: 0, secondaryTilesetAddress: 0 };
    }
    try {
        const primaryTilesetAddress = await readUint32(mapLayoutBaseAddress + CONSTANTS.MAP_LAYOUT_PRIMARY_TILESET_OFFSET);
        const secondaryTilesetAddress = await readUint32(mapLayoutBaseAddress + CONSTANTS.MAP_LAYOUT_SECONDARY_TILESET_OFFSET);
        return { primaryTilesetAddress, secondaryTilesetAddress };
    } catch (error) {
        console.error(`Error reading tileset pointers from mapLayoutBaseAddress 0x${mapLayoutBaseAddress.toString(16)}:`, error);
        return { primaryTilesetAddress: 0, secondaryTilesetAddress: 0 };
    }
}

/**
 * Reads the metatile behaviors from a given tileset's attribute data.
 * @param {number} tilesetBaseAddress The base address of the tileset structure.
 * @param {number} numMetatiles The number of metatiles in this tileset (e.g., CONSTANTS.PRIMARY_TILESET_METATILE_COUNT).
 * @returns {Promise<number[]|null>} An array of metatile behavior bytes, or null on error, or an empty array if tilesetBaseAddress is 0.
 */
async function readMetatileBehaviorsFromTileset(tilesetBaseAddress, numMetatiles) {
    if (!tilesetBaseAddress) {
        // This can be normal if, for example, a map has no secondary tileset.
        return []; // Return empty array, indicating no behaviors from this (non-existent) tileset
    }
    if (numMetatiles <= 0) {
        console.warn(`readMetatileBehaviorsFromTileset: numMetatiles is zero or negative (${numMetatiles}).`);
        return [];
    }

    try {
        const metatileAttributesArrayPtr = await readUint32(tilesetBaseAddress + CONSTANTS.TILESET_METATILE_ATTRIBUTES_POINTER_OFFSET);
        if (!metatileAttributesArrayPtr) {
            console.error(`Failed to read metatile attributes pointer from tileset address 0x${tilesetBaseAddress.toString(16)}. Pointer was 0.`);
            return null;
        }

        const bytesToRead = numMetatiles * BYTES_PER_METATILE_ATTRIBUTE;
        const attributeBytes = await readRange(metatileAttributesArrayPtr, bytesToRead);

        if (!attributeBytes || attributeBytes.length !== bytesToRead) {
            console.error(`Failed to read complete metatile attributes data from 0x${metatileAttributesArrayPtr.toString(16)}. Expected ${bytesToRead} bytes, got ${attributeBytes?.length || 0}.`);
            return null;
        }

        const behaviors = [];
        for (let i = 0; i < numMetatiles; i++) {
            const byte1 = attributeBytes[i * BYTES_PER_METATILE_ATTRIBUTE];
            const byte2 = attributeBytes[i * BYTES_PER_METATILE_ATTRIBUTE + 1];
            const attributeValue = (byte2 << 8) | byte1; // u16 Little Endian
            const behavior = attributeValue & CONSTANTS.METATILE_ATTR_BEHAVIOR_MASK;
            behaviors.push(behavior);
        }
        return behaviors;
    } catch (error) {
        console.error(`Error reading metatile behaviors from tileset 0x${tilesetBaseAddress.toString(16)}:`, error);
        return null;
    }
}

/**
 * Fetches all metatile behaviors for the current map's primary and secondary tilesets.
 * The first set of behaviors (typically 512) are from the primary tileset.
 * The next set (if a secondary tileset exists) are from the secondary tileset and correspond to
 * metatile IDs starting after the primary set's count (i.e., metatile ID 512 is index 0 in the secondary set's behavior array,
 * but index 512 in the combined array).
 * @returns {Promise<number[]|null>} A combined array of metatile behavior bytes, or null on critical error.
 *                                    Returns an empty array if no behaviors could be processed (e.g., no tilesets).
 */
export async function getMainMapMetatileBehaviors() {
    try {
        const mapLayoutBaseAddress = await getMainMapLayoutBaseAddress();
        if (!mapLayoutBaseAddress) {
            console.error("getAllMetatileBehaviors: Failed to get map layout base address.");
            return null;
        }

        const { primaryTilesetAddress, secondaryTilesetAddress } = await getTilesetPointers(mapLayoutBaseAddress);

        let allBehaviors = [];

        if (primaryTilesetAddress) {
            const primaryBehaviors = await readMetatileBehaviorsFromTileset(primaryTilesetAddress, CONSTANTS.PRIMARY_TILESET_METATILE_COUNT);
            if (primaryBehaviors) {
                allBehaviors = allBehaviors.concat(primaryBehaviors);
            }
        }

        if (secondaryTilesetAddress) {
            // Secondary tileset also defines attributes for 0x200 metatiles.
            // These correspond to metatile IDs 0x200-0x3FF.
            const secondaryBehaviors = await readMetatileBehaviorsFromTileset(secondaryTilesetAddress, CONSTANTS.PRIMARY_TILESET_METATILE_COUNT);
            if (secondaryBehaviors) {
                allBehaviors = allBehaviors.concat(secondaryBehaviors);
            }
        }
        return allBehaviors;
    } catch (error) {
        console.error("Critical error in getAllMetatileBehaviors:", error);
        return null;
    }
}

/**
 * Fetches all metatile behaviors for the backup map's primary and secondary tilesets.
 * The structure and logic mirror `getMainMapMetatileBehaviors`.
 * It uses `CONSTANTS.BACKUP_MAP_LAYOUT_ADDR` as the base for the backup map's layout structure.
 * @returns {Promise<number[]|null>} A combined array of metatile behavior bytes, or null on critical error.
 *                                    Returns an empty array if no behaviors could be processed (e.g., no tilesets).
 */
export async function getBackupMapMetatileBehaviors() {
    try {
        // The backup map layout address is a direct constant
        const mapLayoutBaseAddress = CONSTANTS.BACKUP_MAP_LAYOUT_ADDR;
        if (!mapLayoutBaseAddress) {
            // This case should ideally not happen if constants are correctly defined
            console.error("getBackupMapMetatileBehaviors: BACKUP_MAP_LAYOUT_ADDR is not defined or zero.");
            return null;
        }

        // Still need the base address for the main map to get tilesets
        // for the backup map.
        const mainMapLayoutBaseAddress = await getMainMapLayoutBaseAddress();
        if (!mainMapLayoutBaseAddress) {
            console.error("getBackupMapMetatileBehaviors: Failed to get main map layout base address.");
            return null;
        }

        const { primaryTilesetAddress, secondaryTilesetAddress } = await getTilesetPointers(mainMapLayoutBaseAddress);

        let allBehaviors = [];

        if (primaryTilesetAddress) {
            const primaryBehaviors = await readMetatileBehaviorsFromTileset(primaryTilesetAddress, CONSTANTS.PRIMARY_TILESET_METATILE_COUNT);
            if (primaryBehaviors) {
                allBehaviors = allBehaviors.concat(primaryBehaviors);
            }
        }

        if (secondaryTilesetAddress) {
            const secondaryBehaviors = await readMetatileBehaviorsFromTileset(secondaryTilesetAddress, CONSTANTS.PRIMARY_TILESET_METATILE_COUNT);
            if (secondaryBehaviors) {
                allBehaviors = allBehaviors.concat(secondaryBehaviors);
            }
        }
        return allBehaviors;
    } catch (error) {
        console.error("Critical error in getBackupMapMetatileBehaviors:", error);
        return null;
    }
}