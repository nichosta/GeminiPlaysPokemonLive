import {
    readUint8,
    readUint32,
    readRange,
} from "../httpMemory/httpMemoryReader.js";
import * as CONSTANTS from "../constant/constants.js";

/**
 * Gets the base address of the MapEvents structure for the current map.
 * Reads the pointer at CURRENT_MAP_HEADER_ADDR + MAP_HEADER_MAP_EVENTS_OFFSET.
 * Used primarily for reading Warp data now.
 * @returns {Promise<number>} The base address (pointer value) of the MapEvents struct.
 */
async function getMapEventsBaseAddress() {
    // This function remains useful for warps which are still read from MapEvents
    return await readUint32(
        CONSTANTS.CURRENT_MAP_HEADER_ADDR +
        CONSTANTS.MAP_HEADER_MAP_EVENTS_OFFSET
    );
}

/**
 * Retrieves the warp events for the current map from the MapEvents structure.
 *
 * @returns {Promise<Array<{x: number, y: number, destMapNum: number, destMapGroup: number}>>}
 *          An array of warp event objects, each containing the warp's coordinates (x, y)
 *          and its destination map number and group (bank). Returns an empty array if
 *          no warps are found or if there's an error reading the data.
 */
export async function getCurrentMapWarps() {
    try {
        const mapEventsBaseAddress = await getMapEventsBaseAddress();
        if (!mapEventsBaseAddress) {
            console.warn("Could not read MapEvents base address for warps.");
            return [];
        }

        const warpCount = await readUint8(
            mapEventsBaseAddress + CONSTANTS.MAP_EVENTS_WARP_COUNT_OFFSET
        );
        if (warpCount === 0) {
            return [];
        }

        const warpsBaseAddress = await readUint32(
            mapEventsBaseAddress + CONSTANTS.MAP_EVENTS_WARPS_POINTER_OFFSET
        );
        if (!warpsBaseAddress) {
            console.warn("Could not read Warps base address.");
            return [];
        }

        const totalWarpDataSize = warpCount * CONSTANTS.WARP_EVENT_SIZE;
        const warpDataBytes = new Uint8Array(await readRange(warpsBaseAddress, totalWarpDataSize));

        if (!warpDataBytes || warpDataBytes.length !== totalWarpDataSize) {
            console.error(
                `Error reading warp data: Expected ${totalWarpDataSize} bytes, got ${warpDataBytes?.length ?? 0}`
            );
            return [];
        }

        const dataView = new DataView(
            warpDataBytes.buffer,
            warpDataBytes.byteOffset,
            warpDataBytes.byteLength
        );
        const warps = [];

        for (let i = 0; i < warpCount; i++) {
            const currentOffset = i * CONSTANTS.WARP_EVENT_SIZE;
            const x = dataView.getInt16(currentOffset + CONSTANTS.WARP_EVENT_X_OFFSET, true);
            const y = dataView.getInt16(currentOffset + CONSTANTS.WARP_EVENT_Y_OFFSET, true);
            const destMapNum = dataView.getUint8(currentOffset + CONSTANTS.WARP_EVENT_MAP_NUM_OFFSET);
            const destMapGroup = dataView.getUint8(currentOffset + CONSTANTS.WARP_EVENT_MAP_GROUP_OFFSET);
            warps.push({ x, y, destMapNum, destMapGroup });
        }
        return warps;
    } catch (error) {
        console.error("Error fetching current map warps:", error);
        return [];
    }
}


/**
 * Retrieves the currently active NPC objects on the map.
 * Reads the live Object Events data from memory (gObjectEvents).
 * Filters out the player object (index 0) and any NPCs marked as off-screen.
 * Adjusts coordinates relative to the map origin.
 *
 * @returns {Promise<Array<{x: number, y: number, graphicsId: number}>>}
 *          An array of active NPC objects, each containing the NPC's current
 *          coordinates (x, y) relative to the map origin and their graphics ID.
 *          Returns an empty array if no active NPCs are found or on error.
 */
export async function getCurrentMapNpcs() {
    try {
        const objectEventsBaseAddress = CONSTANTS.OBJECT_EVENTS_ADDR;
        const objectCount = CONSTANTS.OBJECT_EVENT_COUNT;
        const objectSize = CONSTANTS.OBJECT_EVENT_SIZE;
        const totalObjectDataSize = objectCount * objectSize; // 16 * 32 = 0x240 bytes

        // Read the block of live object event data
        const objectDataBytes = new Uint8Array(await readRange(objectEventsBaseAddress, totalObjectDataSize));

        if (!objectDataBytes || objectDataBytes.length !== totalObjectDataSize) {
            console.error(
                `Error reading Object Events data: Expected ${totalObjectDataSize} bytes, got ${objectDataBytes?.length ?? 0}`
            );
            return [];
        }

        const dataView = new DataView(
            objectDataBytes.buffer,
            objectDataBytes.byteOffset,
            objectDataBytes.byteLength
        );
        const npcs = [];

        // Loop through objects, skipping the player at index 0
        for (let i = 1; i < objectCount; i++) {
            const currentOffset = i * objectSize;

            // Read the 32-bit flags field (Little Endian)
            const flags = dataView.getUint32(currentOffset + CONSTANTS.OBJECT_EVENT_FLAGS_OFFSET, true);

            // Check the off-screen flag (bit 14)
            const isOffScreen = (flags >> CONSTANTS.OBJECT_EVENT_OFFSCREEN_BIT) & 1;

            // --- Extract required NPC data ---

            // Graphics ID (u8)
            const graphicsId = dataView.getUint8(currentOffset + CONSTANTS.OBJECT_EVENT_GRAPHICS_ID_OFFSET);

            // If graphicsId is 0, it might indicate an inactive/invalid slot, skip it.
            if (graphicsId === 0) {
                continue;
            }

            // Current X coordinate (s16, Little Endian), adjusted by MAP_OFFSET
            const x = dataView.getInt16(currentOffset + CONSTANTS.OBJECT_EVENT_X_OFFSET, true) - CONSTANTS.MAP_OFFSET;

            // Current Y coordinate (s16, Little Endian), adjusted by MAP_OFFSET
            const y = dataView.getInt16(currentOffset + CONSTANTS.OBJECT_EVENT_Y_OFFSET, true) - CONSTANTS.MAP_OFFSET;

            npcs.push({ id: i, x, y, graphicsId, isOffScreen });
        }
        return npcs;
    } catch (error) {
        console.error("Error fetching current map NPCs from Object Events:", error);
        return []; // Return empty array on error
    }
}