import {
    readUint8,
    readUint32,
    readRange,
} from "../httpMemoryReader.js";
import * as MAP_CONSTANTS from "./MAP_CONSTANTS.js";

/**
 * Gets the base address of the MapEvents structure for the current map.
 * Reads the pointer at CURRENT_MAP_HEADER_ADDR + MAP_HEADER_MAP_EVENTS_OFFSET.
 * @returns {Promise<number>} The base address (pointer value) of the MapEvents struct.
 */
async function getMapEventsBaseAddress() {
    return await readUint32(
        MAP_CONSTANTS.CURRENT_MAP_HEADER_ADDR +
        MAP_CONSTANTS.MAP_HEADER_MAP_EVENTS_OFFSET
    );
}

/**
 * Retrieves the warp events for the current map.
 * Reads the MapEvents structure to find the count and location of warp definitions.
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
            console.warn("Could not read MapEvents base address.");
            return [];
        }

        // Read the number of warps
        const warpCount = await readUint8(
            mapEventsBaseAddress + MAP_CONSTANTS.MAP_EVENTS_WARP_COUNT_OFFSET
        );
        if (warpCount === 0) {
            return [];
        }

        // Read the pointer to the array of WarpEvent structures
        const warpsBaseAddress = await readUint32(
            mapEventsBaseAddress + MAP_CONSTANTS.MAP_EVENTS_WARPS_POINTER_OFFSET
        );
        if (!warpsBaseAddress) {
            console.warn("Could not read Warps base address.");
            return [];
        }

        // Calculate the total size of the warp data to read
        const totalWarpDataSize = warpCount * MAP_CONSTANTS.WARP_EVENT_SIZE;

        // Read the entire block of warp data in one go
        const warpDataBytes = new Uint8Array(await readRange(warpsBaseAddress, totalWarpDataSize));

        if (!warpDataBytes || warpDataBytes.length !== totalWarpDataSize) {
            console.error(
                `Error reading warp data: Expected ${totalWarpDataSize} bytes, got ${warpDataBytes?.length ?? 0
                }`
            );
            return [];
        }

        // Create a DataView on the buffer of the Uint8Array
        // Note: Assumes warpDataBytes is a Uint8Array or similar TypedArray
        const dataView = new DataView(
            warpDataBytes.buffer,
            warpDataBytes.byteOffset,
            warpDataBytes.byteLength
        );
        const warps = [];

        for (let i = 0; i < warpCount; i++) {
            const currentOffset = i * MAP_CONSTANTS.WARP_EVENT_SIZE;

            // Use DataView methods to extract data
            // The 'true' argument specifies Little Endian
            const x = dataView.getInt16(
                currentOffset + MAP_CONSTANTS.WARP_EVENT_X_OFFSET,
                true
            );
            const y = dataView.getInt16(
                currentOffset + MAP_CONSTANTS.WARP_EVENT_Y_OFFSET,
                true
            );
            const destMapNum = dataView.getUint8(
                currentOffset + MAP_CONSTANTS.WARP_EVENT_MAP_NUM_OFFSET
            );
            const destMapGroup = dataView.getUint8(
                currentOffset + MAP_CONSTANTS.WARP_EVENT_MAP_GROUP_OFFSET
            );

            warps.push({ x, y, destMapNum, destMapGroup });
        }
        return warps;
    } catch (error) {
        console.error("Error fetching current map warps:", error);
        return []; // Return empty array on error
    }
}
