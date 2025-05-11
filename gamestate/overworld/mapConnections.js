import { readUint8, readUint16, readUint32, readRange } from "../emulatorInteraction/httpMemoryReader.js";
import { getMapName } from "../../constant/map_map.js";
import * as CONSTANTS from "../constant/constants.js";

/**
 * Reads information about the current map's connections from the game memory.
 *
 * It retrieves the list of connections from the current map to adjacent maps,
 * including the direction of the connection and the name of the connected map.
 *
 * For connections read from memory, an `offset` property is also included.
 * This `offset` (a signed integer) represents:
 *   - For "up" or "down" connections: The X-coordinate shift of the connected map relative to the current map.
 *     A positive value means the connected map's origin is to the right of the current map's origin.
 *   - For "left" or "right" connections: The Y-coordinate shift of the connected map relative to the current map.
 *     A positive value means the connected map's origin is below the current map's origin.
 * Placeholder connections (where `mapName` is "MAP_NONE") will not have the `offset` property.
 *
 * @async
 * @returns {Promise<Array<{direction: string, mapName: string, offset?: number}>>} A promise that resolves to an array of connection objects.
 * Returns an empty array if no connections are found, if pointers are invalid, or if an error occurs during memory reading.
 */
export async function getCurrentMapConnections() {
    const actualConnections = []; // Stores connections read from memory
    const allConnections = [];    // Will store actual connections + MAP_NONE placeholders

    try {
        // 1. Get the pointer to the MapConnections struct from the current map header
        // The map header address is a constant, and the offset to the connections pointer is also a constant.
        const mapConnectionsStructPtrAddr = CONSTANTS.CURRENT_MAP_HEADER_ADDR + CONSTANTS.MAP_HEADER_MAP_CONNECTIONS_OFFSET;
        const mapConnectionsStructPtr = await readUint32(mapConnectionsStructPtrAddr);

        // If the pointer to the MapConnections struct is null or zero, there are no connections defined or an error.
        if (!mapConnectionsStructPtr || mapConnectionsStructPtr === 0) {
            // console.debug("MapConnections pointer is null or zero, assuming no connections.");
            return [];
        }

        // 2. Read the MapConnections struct
        // Read connection count (s32, but we read as u32 assuming non-negative)
        const connectionCountAddr = mapConnectionsStructPtr + CONSTANTS.MAP_CONNECTIONS_COUNT_OFFSET;
        const connectionCount = await readUint32(connectionCountAddr);

        // If count is 0 or an unreasonably large number (sanity check), assume no valid connections.
        if (connectionCount === 0 || connectionCount > 20) { // Max connections for a map is typically small.
            if (connectionCount > 20) {
                 console.warn(`Unusually high map connection count: ${connectionCount}. Interpreting as no valid connections.`);
            }
            return [];
        }

        // Read pointer to the actual connections array
        const connectionsArrayPtrAddr = mapConnectionsStructPtr + CONSTANTS.MAP_CONNECTIONS_CONNECTION_POINTER_OFFSET;
        const connectionsArrayPtr = await readUint32(connectionsArrayPtrAddr);

        if (!connectionsArrayPtr || connectionsArrayPtr === 0) {
            // console.debug("Connections array pointer is null or zero, assuming no connections despite count > 0.");
            return [];
        }

        // 3. Iterate through each MapConnection entry
        for (let i = 0; i < connectionCount; i++) {
            const currentConnectionBaseAddr = connectionsArrayPtr + (i * CONSTANTS.MAP_CONNECTION_SIZE);

            const directionRaw = await readUint8(currentConnectionBaseAddr + CONSTANTS.MAP_CONNECTION_DIRECTION_OFFSET);
            const direction = CONSTANTS.FACING_DIRECTION_MAP.get(directionRaw) || `unknown (${directionRaw})`;

            const mapGroup = await readUint8(currentConnectionBaseAddr + CONSTANTS.MAP_CONNECTION_MAP_GROUP_OFFSET);
            const mapNum = await readUint8(currentConnectionBaseAddr + CONSTANTS.MAP_CONNECTION_MAP_NUM_OFFSET);
            const mapName = getMapName(mapGroup, mapNum);

            // Read the offset (s32)
            const offsetRaw = await readUint32(currentConnectionBaseAddr + CONSTANTS.MAP_CONNECTION_OFFSET_OFFSET);
            // Convert uint32 to int32
            let offset = offsetRaw;
            if (offsetRaw > 0x7FFFFFFF) { // Max positive s32 (2,147,483,647)
                offset = offsetRaw - 0x100000000; // 2^32 (4,294,967,296)
            }

            actualConnections.push({
                direction: direction,
                mapName: mapName,
                offset: offset
            });
        }
    } catch (error) {
        console.error("Error reading map connections:", error);
        // If a critical error occurs reading the base connection data, return empty.
        // No point in adding MAP_NONE placeholders if we can't even determine existing ones.
        return []; 
    }

    // Add successfully read connections to the final list
    allConnections.push(...actualConnections);

    // Define standard directions and find which ones are already present
    const STANDARD_DIRECTIONS = ["up", "down", "left", "right"];
    const presentDirections = new Set(actualConnections.map(conn => conn.direction));

    // Add "MAP_NONE" for any standard directions that are missing
    for (const dir of STANDARD_DIRECTIONS) {
        if (!presentDirections.has(dir)) {
            allConnections.push({
                direction: dir,
                mapName: "MAP_NONE" 
            });
        }
    }

    return allConnections;
}
