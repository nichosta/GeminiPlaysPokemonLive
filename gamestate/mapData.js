import { readUint8, readUint16, readUint32, readRange, bytesToInt16LE } from "./httpMemoryReader.js";
import { getMapName } from "../constant/map_map.js";

//#region Pointer and address constants

const PLAYER_OBJECT_POINTER_ADDR = 0x03005008; // Address of pointer to player object in IWRAM
const PLAYER_X_OFFSET = 0x000;
const PLAYER_Y_OFFSET = 0x002;

const BACKUP_MAP_LAYOUT_ADDR = 0x03005040; // Address of structure that contains the backup map details
const BACKUP_MAP_LAYOUT_WIDTH_OFFSET = 0x00;
const BACKUP_MAP_LAYOUT_HEIGHT_OFFSET = 0x04;

const BACKUP_MAP_DATA_ADDR = 0x02031DFC; // Address of tile data for backup map (constant)

const CURRENT_MAP_HEADER_ADDR = 0x02036DFC; // Address of current map header struct
const MAP_HEADER_MAP_LAYOUT_OFFSET = 0x00; // Offset from above to pointer to current map layout struct
const MAP_HEADER_MAP_EVENTS_OFFSET = 0x04; // Offset from map header to pointer to MapEvents struct

const MAP_LAYOUT_WIDTH_OFFSET = 0x00 // Offset from start of map layout struct to map width
const MAP_LAYOUT_HEIGHT_OFFSET = 0x04 // Offset ... to map height (yes, these are u32s for some reason)
const MAP_LAYOUT_DATA_OFFSET = 0x0C // Offset ... to map data array pointer

// MapEvents struct offsets
const MAP_EVENTS_WARP_COUNT_OFFSET = 0x01; // Offset to warpCount (u8)
const MAP_EVENTS_WARPS_POINTER_OFFSET = 0x08; // Offset to warps pointer (const struct WarpEvent *)

// WarpEvent struct offsets and size (Size = 8 bytes)
const WARP_EVENT_SIZE = 8;
const WARP_EVENT_X_OFFSET = 0x00; // s16
const WARP_EVENT_Y_OFFSET = 0x02; // s16
const WARP_EVENT_ELEVATION_OFFSET = 0x04; // u8 (unused for now)
const WARP_EVENT_WARP_ID_OFFSET = 0x05; // u8 (unused for now)
const WARP_EVENT_MAP_NUM_OFFSET = 0x06; // u8 (destination map number)
const WARP_EVENT_MAP_GROUP_OFFSET = 0x07; // u8 (destination map bank/group)


const MAP_BANK_ADDR = 0x02031DBC;
const MAP_NUMBER_ADDR = 0x02031DBD;

const FACING_DIRECTION_ADDR = 0x02036E54 // 4 lowest bits only
const FACING_DIRECTION_MASK = 0x03;
const FACING_DIRECTION_MAP = new Map([[0, "down"], [1, "up"], [2, "left"], [3, "right"]]); // Use Map for clarity, lowercase for consistency

//#endregion

//#region Map addressing functions

/**
 * Gets the current map bank number.
 * @returns {Promise<number>} The map bank number.
 */
export async function getCurrentMapBank() {
    return await readUint8(MAP_BANK_ADDR);
}

/**
 * Gets the current map number within the bank.
 * @returns {Promise<number>} The map number.
 */
export async function getCurrentMapNumber() {
    return await readUint8(MAP_NUMBER_ADDR);
}

//#endregion

//#region Player Object Functions

/**
 * Gets the direction the player is facing.
 * @returns {Promise<string>} The direction the player is facing (lowercase).
 */
export async function getPlayerFacingDirection() {
    const direction = await readUint8(FACING_DIRECTION_ADDR);
    const maskedDirection = direction & FACING_DIRECTION_MASK;
    return FACING_DIRECTION_MAP.get(maskedDirection) ?? "unknown"; // More concise lookup, lowercase
}

/**
 * Gets the base address of the player/camera object structure in EWRAM.
 * Reads the pointer stored at PLAYER_OBJECT_POINTER_ADDR.
 * @returns {Promise<number>} The base address (pointer value).
 */
async function getPlayerObjectBaseAddress() {
    return await readUint32(PLAYER_OBJECT_POINTER_ADDR);
}

/**
 * Gets the player's current X coordinate (in tile units).
 * Reads the pointer at 0x03005008 and adds the offset.
 * @returns {Promise<number>} The player's X coordinate.
 */
export async function getPlayerX() {
    const baseAddress = await getPlayerObjectBaseAddress();
    return await readUint16(baseAddress + PLAYER_X_OFFSET); // [6]
}

/**
 * Gets the player's current Y coordinate (in tile units).
 * Reads the pointer at 0x03005008 and adds the offset.
 * @returns {Promise<number>} The player's Y coordinate.
 */
export async function getPlayerY() {
    const baseAddress = await getPlayerObjectBaseAddress();
    return await readUint16(baseAddress + PLAYER_Y_OFFSET); // [6]
}

//#endregion

//#region Backup Map Functions

/**
 * Gets the width of the backup map layout.
 * Reads a u32 value from BACKUP_MAP_LAYOUT_ADDR + BACKUP_MAP_LAYOUT_WIDTH_OFFSET.
 * @returns {Promise<number>} The width of the map layout.
 */
async function getBackupMapWidth() {
    const widthAddress = BACKUP_MAP_LAYOUT_ADDR + BACKUP_MAP_LAYOUT_WIDTH_OFFSET;
    return await readUint32(widthAddress);
}

/**
 * Gets the height of the backup map layout.
 * Reads a u32 value from BACKUP_MAP_LAYOUT_ADDR + BACKUP_MAP_LAYOUT_HEIGHT_OFFSET.
 * @returns {Promise<number>} The height of the map layout.
 */
async function getBackupMapHeight() {
    const heightAddress = BACKUP_MAP_LAYOUT_ADDR + BACKUP_MAP_LAYOUT_HEIGHT_OFFSET;
    return await readUint32(heightAddress);
}

/**
 * Gets the backup map tiles.
 * Reads a range of bytes from BACKUP_MAP_DATA_ADDR.
 * @param {number} mapWidth - The width of the map.
 * @param {number} mapHeight - The height of the map.
 * @returns {Promise<number[]>} The map tiles as an array of bytes.
 */
async function getBackupMapTiles(mapWidth, mapHeight) {
    let mapTileBytes = mapWidth * mapHeight * 2;
    let range = await readRange(BACKUP_MAP_DATA_ADDR, mapTileBytes);
    return range;
}
//#endregion

//#region Main Map Functions

/**
 * Gets the base address of the current map's layout structure.
 * Reads the pointer stored at CURRENT_MAP_HEADER_ADDR + MAP_HEADER_MAP_LAYOUT_OFFSET.
 * @returns {Promise<number>} The base address (pointer value).
 */
async function getMainMapLayoutBaseAddress() {
    return await readUint32(CURRENT_MAP_HEADER_ADDR + MAP_HEADER_MAP_LAYOUT_OFFSET);
}

/**
 * Gets the width of the current map layout.
 * Reads a u32 value from the map layout struct + MAP_LAYOUT_WIDTH_OFFSET.
 * @returns {Promise<number>} The width of the map layout in tiles.
 */
async function getMainMapWidth() {
    const baseAddress = await getMainMapLayoutBaseAddress();
    return await readUint32(baseAddress + MAP_LAYOUT_WIDTH_OFFSET);
}

/**
 * Gets the height of the current map layout.
 * Reads a u32 value from the map layout struct + MAP_LAYOUT_HEIGHT_OFFSET.
 * @returns {Promise<number>} The height of the map layout in tiles.
 */
async function getMainMapHeight() {
    const baseAddress = await getMainMapLayoutBaseAddress();
    return await readUint32(baseAddress + MAP_LAYOUT_HEIGHT_OFFSET);
}

/**
 * Gets the current map tiles as raw bytes.
 * Reads a range of bytes from the map data address.
 * @param {number} mapWidth - The width of the map in tiles.
 * @param {number} mapHeight - The height of the map in tiles.
 * @returns {Promise<number[]>} The map tiles as an array of bytes.
 */
async function getMainMapTiles(mapWidth, mapHeight) {
    const baseAddress = await getMainMapLayoutBaseAddress();
    const mapDataAddress = await readUint32(baseAddress + MAP_LAYOUT_DATA_OFFSET);

    let mapTileBytes = mapWidth * mapHeight * 2; // Each tile is 2 bytes

    let range = await readRange(mapDataAddress, mapTileBytes);

    return range;
}

//#endregion

//#region Map Events Functions

/**
 * Gets the base address of the MapEvents structure for the current map.
 * Reads the pointer at CURRENT_MAP_HEADER_ADDR + MAP_HEADER_MAP_EVENTS_OFFSET.
 * @returns {Promise<number>} The base address (pointer value) of the MapEvents struct.
 */
async function getMapEventsBaseAddress() {
    return await readUint32(CURRENT_MAP_HEADER_ADDR + MAP_HEADER_MAP_EVENTS_OFFSET);
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
        const warpCount = await readUint8(mapEventsBaseAddress + MAP_EVENTS_WARP_COUNT_OFFSET);
        if (warpCount === 0) {
            return [];
        }

        // Read the pointer to the array of WarpEvent structures
        const warpsBaseAddress = await readUint32(mapEventsBaseAddress + MAP_EVENTS_WARPS_POINTER_OFFSET);
        if (!warpsBaseAddress) {
            console.warn("Could not read Warps base address.");
            return [];
        }

        // Calculate the total size of the warp data to read
        const totalWarpDataSize = warpCount * WARP_EVENT_SIZE;

        // Read the entire block of warp data in one go
        const warpDataBytes = await readRange(warpsBaseAddress, totalWarpDataSize);

        if (!warpDataBytes || warpDataBytes.length !== totalWarpDataSize) {
             console.error(`Error reading warp data: Expected ${totalWarpDataSize} bytes, got ${warpDataBytes?.length ?? 0}`);
             return [];
        }

        const warps = [];
        for (let i = 0; i < warpCount; i++) {
            const currentOffset = i * WARP_EVENT_SIZE;

            // Extract data for the current warp using offsets
            const x = bytesToInt16LE(
                warpDataBytes[currentOffset + WARP_EVENT_X_OFFSET],
                warpDataBytes[currentOffset + WARP_EVENT_X_OFFSET + 1]
            );
            const y = bytesToInt16LE(
                warpDataBytes[currentOffset + WARP_EVENT_Y_OFFSET],
                warpDataBytes[currentOffset + WARP_EVENT_Y_OFFSET + 1]
            );
            const destMapNum = warpDataBytes[currentOffset + WARP_EVENT_MAP_NUM_OFFSET];
            const destMapGroup = warpDataBytes[currentOffset + WARP_EVENT_MAP_GROUP_OFFSET];

            warps.push({ x, y, destMapNum, destMapGroup });
        }
        return warps;

    } catch (error) {
        console.error("Error fetching current map warps:", error);
        return []; // Return empty array on error
    }
}


//#endregion

//#region Tilemap processing function (Modified)

/**
 * Processes raw map tile byte data into a structured collision map object.
 *
 * @param {number[]} memory_data - Flat array of bytes representing the map tiles (2 bytes per tile).
 * @param {number} mapWidthTiles - The width of the map in tiles.
 * @returns {{width: number, height: number, tile_passability: object, map_data: number[][]}|null}
 *          An object containing:
 *          - width: The width of the map in tiles.
 *          - height: The height of the map in tiles.
 *          - tile_passability: A mapping {0: "walkable", 1: "blocked"}.
 *          - map_data: A 2D array where each number represents the collision type
 *                      (0 for walkable, 1 for blocked).
 *          Returns null if input is invalid or processing fails.
 */
function processMemoryDataToCollisionMap(memory_data, mapWidthTiles) {
    // --- Input Validation ---
    if (!Array.isArray(memory_data) || memory_data.length === 0) {
        console.error("Invalid input: memory_data must be a non-empty array.");
        return null;
    }
    if (typeof mapWidthTiles !== 'number' || mapWidthTiles <= 0) {
        console.error("Invalid input: mapWidthTiles must be a positive number.");
        return null;
    }
    if (memory_data.length % 2 !== 0) {
        console.warn("Warning: memory_data length is not an even number. Tiles might be incomplete.");
        // Proceed, but the last byte will be ignored if mapWidthTiles calculation works out.
    }

    const bytesPerRow = mapWidthTiles * 2;
    const expectedTiles = memory_data.length / 2;
    const mapHeightTiles = Math.ceil(expectedTiles / mapWidthTiles); // Calculate height based on data and width

    if (memory_data.length < bytesPerRow * mapHeightTiles) {
         console.warn(`Warning: memory_data length (${memory_data.length}) is less than expected for ${mapWidthTiles}x${mapHeightTiles} map (${bytesPerRow * mapHeightTiles} bytes). Map might be truncated.`);
    }


    const collisionMap = [];
    let currentByteIndex = 0;

    for (let y = 0; y < mapHeightTiles; y++) {
        const row = [];
        for (let x = 0; x < mapWidthTiles; x++) {
            const byte1Index = currentByteIndex;
            const byte2Index = currentByteIndex + 1;

            // Ensure we don't read past the end of the data
            if (byte2Index >= memory_data.length) {
                console.warn(`Warning: Ran out of data at tile (${x}, ${y}). Filling with 'blocked'.`);
                row.push(1); // Assume incomplete tile is blocked
                currentByteIndex += 2; // Still advance index
                continue;
            }

            const byte1 = memory_data[byte1Index];
            const byte2 = memory_data[byte2Index];

            // Combine bytes into a 16-bit value (Little Endian: byte2 is high, byte1 is low)
            const tileValue = (byte2 << 8) | byte1;

            // Extract collision bits (bits 10 and 11)
            // Shift right by 10 to get bits 10-15 in the lower positions.
            // Mask with 0x3 (binary 11) to isolate bits 10 and 11.
            const collisionBits = (tileValue >> 10) & 0x3;

            // Map collision bits to simple passability: 0 = walkable, 1 = blocked
            // Based on common Pokemon GBA knowledge:
            // 0 (00) = Walkable
            // 1 (01), 2 (10), 3 (11) = Various types of impassable/collision
            const passability = (collisionBits === 0) ? 0 : 1;
            row.push(passability);

            currentByteIndex += 2; // Move to the next tile (2 bytes)
        }
        collisionMap.push(row);
    }

     // Determine the actual height based on rows created
    const actualHeight = collisionMap.length;
    // Width should ideally match mapWidthTiles, but check the first row just in case
    const actualWidth = collisionMap[0]?.length ?? 0;

    if (actualWidth !== mapWidthTiles) {
        console.warn(`Processed map width (${actualWidth}) does not match input width (${mapWidthTiles}).`);
    }


    return {
        width: actualWidth, // Use actual processed width
        height: actualHeight, // Use actual processed height
        tile_passability: {
            "0": "walkable",
            "1": "blocked",
            // Add more mappings here if needed, e.g., based on collisionBits 1, 2, 3
        },
        map_data: collisionMap
    };
}
//#endregion

//#region Aggregate State Function (New)

/**
 * Retrieves the complete current map state in a structured JSON format.
 *
 * @returns {Promise<object|null>} A promise that resolves to an object containing
 *          the map name, dimensions, collision data, player state, and warp points,
 *          or null if a critical error occurs during data fetching.
 *          The structure is:
 *          {
 *            "map_name": string,
 *            "width": number,
 *            "height": number,
 *            "tile_passability": { "0": "walkable", "1": "blocked", ... },
 *            "map_data": number[][], // 0=walkable, 1=blocked
 *            "player_state": {
 *              "position": [col: number, row: number],
 *              "facing": string ("up", "down", "left", "right", "unknown")
 *            },
 *            "warps": [
 *              { "position": [col: number, row: number], "destination": string }
 *            ]
 *          }
 */
export async function getMapStateJson() {
    try {
        const mapBank = await getCurrentMapBank();
        const mapNumber = await getCurrentMapNumber();
        const playerX = await getPlayerX();
        const playerY = await getPlayerY();
        const facingDirection = await getPlayerFacingDirection();
        const rawWarps = await getCurrentMapWarps();
        const mapWidth = await getMainMapWidth();
        const mapHeight = await getMainMapHeight();

        // Fetch map tiles using the obtained width and height
        const mapTiles = await getMainMapTiles(mapWidth, mapHeight);

        // Process tiles into collision map
        const collisionData = processMemoryDataToCollisionMap(mapTiles, mapWidth);
        if (!collisionData) {
             console.error("Failed to process map tiles into collision data.");
             return null; // Indicate failure
        }

        // Get map name
        const mapName = getMapName(mapBank, mapNumber);

        // Format warps to include destination names
        const warps = rawWarps.map(warp => ({
            position: [warp.x, warp.y],
            destination: getMapName(warp.destMapGroup, warp.destMapNum)
        }));

        // Assemble the final JSON object
        const mapState = {
            map_name: mapName,
            width: collisionData.width, // Use width from processed data
            height: collisionData.height, // Use height from processed data
            tile_passability: collisionData.tile_passability,
            map_data: collisionData.map_data,
            player_state: {
                position: [playerX, playerY], // [col, row]
                facing: facingDirection
            },
            warps: warps
        };

        return mapState;

    } catch (error) {
        console.error("Error getting complete map state:", error);
        return null; // Return null on error
    }
}

//#endregion

/**
 * Trims the full map state to a 15x10 viewport centered around the player.
 * Adjusts player and warp coordinates to be relative to the viewport.
 *
 * @param {object} fullMapState - The complete map state object obtained from getMapStateJson.
 * @returns {object|null} A new map state object containing only the data within the
 *          player's viewport (15x10), or null if the input is invalid.
 *          The structure mirrors getMapStateJson, but with trimmed data:
 *          {
 *            "map_name": string,
 *            "width": 15, // Viewport width
 *            "height": 10, // Viewport height
 *            "tile_passability": { "0": "walkable", "1": "blocked", ... },
 *            "map_data": number[][], // 10 rows x 15 columns
 *            "player_state": {
 *              "position": [col: number, row: number], // Relative to viewport
 *              "facing": string
 *            },
 *            "warps": [ // Only warps within the viewport
 *              { "position": [col: number, row: number], "destination": string } // Relative to viewport
 *            ]
 *          }
 */
function trimMapStateToViewport(fullMapState) {
    if (!fullMapState || !fullMapState.player_state || !fullMapState.map_data) {
        console.error("Invalid fullMapState provided for trimming.");
        return null;
    }

    const VIEWPORT_WIDTH = 15;
    const VIEWPORT_HEIGHT = 10;

    const {
        map_name,
        width: fullWidth,
        height: fullHeight,
        tile_passability,
        map_data: fullMapData,
        player_state,
        warps: fullWarps
    } = fullMapState;

    const [playerX, playerY] = player_state.position;
    const facingDirection = player_state.facing;

    // Determine the value representing a blocked tile (for out-of-bounds areas)
    // Defaults to 1 if "blocked" mapping isn't found explicitly.
    let blockedTileValue = 1;
    for (const key in tile_passability) {
        if (tile_passability[key] === "blocked") {
            blockedTileValue = parseInt(key, 10); // Use the actual key mapped to "blocked"
            break;
        }
    }

    // Calculate the top-left corner of the viewport in the full map coordinates
    const startX = playerX - Math.floor(VIEWPORT_WIDTH / 2);
    const startY = playerY - Math.floor(VIEWPORT_HEIGHT / 2);

    const trimmedMapData = [];
    const trimmedWarps = [];

    // Populate the trimmed map data
    for (let y = 0; y < VIEWPORT_HEIGHT; y++) {
        const row = [];
        const currentMapY = startY + y;

        for (let x = 0; x < VIEWPORT_WIDTH; x++) {
            const currentMapX = startX + x;

            // Check if the coordinate is within the bounds of the original map
            if (currentMapY >= 0 && currentMapY < fullHeight &&
                currentMapX >= 0 && currentMapX < fullWidth) {
                // Check if the row itself exists (robustness for potentially sparse data)
                 if (fullMapData[currentMapY]) {
                    row.push(fullMapData[currentMapY][currentMapX] ?? blockedTileValue);
                 } else {
                    // This case should ideally not happen if fullMapData is correct
                    console.warn(`Row ${currentMapY} missing in full map data.`);
                    row.push(blockedTileValue);
                 }
            } else {
                // Out of bounds, fill with the blocked tile value
                row.push(blockedTileValue);
            }
        }
        trimmedMapData.push(row);
    }

    // Filter and adjust warp coordinates
    for (const warp of fullWarps) {
        const [warpX, warpY] = warp.position;
        const relativeX = warpX - startX;
        const relativeY = warpY - startY;

        // Check if the warp falls within the viewport bounds
        if (relativeX >= 0 && relativeX < VIEWPORT_WIDTH &&
            relativeY >= 0 && relativeY < VIEWPORT_HEIGHT) {
            trimmedWarps.push({
                position: [relativeX, relativeY],
                destination: warp.destination
            });
        }
    }

    // Calculate player position relative to the viewport
    // This should ideally be the center, but calculating ensures accuracy near edges.
    const relativePlayerX = playerX - startX;
    const relativePlayerY = playerY - startY;

    // Assemble the trimmed state object
    const trimmedMapState = {
        map_name: map_name,
        width: VIEWPORT_WIDTH,
        height: VIEWPORT_HEIGHT,
        tile_passability: tile_passability,
        map_data: trimmedMapData,
        player_state: {
            // Clamp position just in case, though relative calculation should be correct
            position: [
                Math.max(0, Math.min(VIEWPORT_WIDTH - 1, relativePlayerX)),
                Math.max(0, Math.min(VIEWPORT_HEIGHT - 1, relativePlayerY))
            ],
            facing: facingDirection
        },
        warps: trimmedWarps
    };

    return trimmedMapState;
}

/**
 * Example usage: Fetches the full map state and then trims it.
 * (This function would likely replace or be called by getMapStateJson
 *  if the trimmed view is always desired, or called separately when needed)
 */
export async function getVisibleMapStateJson() {
    try {
        const fullState = await getMapStateJson();
        if (!fullState) {
            console.error("Failed to get full map state.");
            return null;
        }
        const trimmedState = trimMapStateToViewport(fullState);
        return trimmedState;

    } catch (error) {
        console.error("Error getting visible map state:", error);
        return null;
    }
}
