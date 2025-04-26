import { readUint8, readUint16, readUint32, readRange, bytesToInt16LE } from "../httpMemoryReader.js";
import { getMapName } from "../../constant/map_map.js";
import * as MAP_CONSTANTS from "./MAP_CONSTANTS.js";
import { getCurrentMapBank, getCurrentMapNumber, getPlayerFacingDirection, getPlayerPosition } from "./playerData.js";
import { getCurrentMapWarps } from "./mapEvents.js";
import { getMainMapHeight, getMainMapTiles, getMainMapWidth } from "./mapLayouts.js";

// --- Constants ---
const TILE_WALKABLE = 'O';
const TILE_BLOCKED = 'X';
const TILE_WARP = 'W';

const BASE_TILE_PASSABILITY = Object.freeze({
    [TILE_WALKABLE]: "walkable",
    [TILE_BLOCKED]: "blocked",
});

const VIEWPORT_TILE_PASSABILITY = Object.freeze({
    ...BASE_TILE_PASSABILITY,
    [TILE_WARP]: "warp",
});

const MAX_VIEWPORT_WIDTH = 15;
const MAX_VIEWPORT_HEIGHT = 10;

/**
 * Processes raw map tile byte data into a structured map object with coordinate-based tile strings.
 *
 * @param {number[]} memory_data - Flat array of bytes representing the map tiles (2 bytes per tile).
 * @param {number} mapWidthTiles - The width of the map in tiles.
 * @returns {{width: number, height: number, tile_passability: object, map_data: string[][]}|null}
 *          An object containing:
 *          - width: The width of the map in tiles.
 *          - height: The height of the map in tiles.
 *          - tile_passability: A mapping { "O": "walkable", "X": "blocked" }.
 *          - map_data: A 2D array where each element is a string "x,y:T"
 *                      (T is 'O' for walkable, 'X' for blocked).
 *                      Coordinates (x, y) are absolute within the full map.
 *          Returns null if input is invalid or processing fails.
 */
function processMemoryDataToCollisionMap(memory_data, mapWidthTiles) {
    // --- Input Validation ---
    if (!Array.isArray(memory_data)) { // Allow empty array, process it as 0 tiles
        console.error("Invalid input: memory_data must be an array.");
        return null;
    }
    if (typeof mapWidthTiles !== 'number' || mapWidthTiles <= 0) {
        console.error("Invalid input: mapWidthTiles must be a positive number.");
        return null;
    }
    if (memory_data.length % 2 !== 0) {
        console.warn("Warning: memory_data length is not an even number. The last byte will be ignored.");
        // Adjust length to be even for tile processing
        memory_data = memory_data.slice(0, -1);
    }

    const numTiles = memory_data.length / 2;
    if (numTiles === 0) {
        // Handle empty map data gracefully
        return {
            width: mapWidthTiles, // Return requested width
            height: 0,
            tile_passability: BASE_TILE_PASSABILITY,
            map_data: []
        };
    }

    // Calculate height based on actual number of tiles and width
    const mapHeightTiles = Math.ceil(numTiles / mapWidthTiles);

    const mapDataStrings = [];
    let tileIndex = 0;

    for (let y = 0; y < mapHeightTiles; y++) {
        const row = [];
        for (let x = 0; x < mapWidthTiles; x++) {
            if (tileIndex < numTiles) {
                const byte1Index = tileIndex * 2;
                const byte2Index = byte1Index + 1;

                const byte1 = memory_data[byte1Index];
                const byte2 = memory_data[byte2Index];

                // Combine bytes into a 16-bit value (Little Endian: byte2 is high, byte1 is low)
                const tileValue = (byte2 << 8) | byte1;

                // Extract collision bits (bits 10 and 11)
                const collisionBits = (tileValue >> 10) & 0x3;

                // Map collision bits: 0 = walkable (Open), others = blocked (X)
                const tileType = (collisionBits === 0) ? TILE_WALKABLE : TILE_BLOCKED;

                row.push(`${x},${y}:${tileType}`);
                tileIndex++;
            } else {
                // If we run out of tiles before filling the expected width/height,
                // it indicates inconsistent data or a non-rectangular map source.
                // We stop adding real tiles, but the loops ensure the structure matches width/height.
                // For simplicity, we won't add placeholder strings here, the actual dimensions
                // will be derived from the generated mapDataStrings later.
                // This case shouldn't be hit if mapHeightTiles is calculated correctly from numTiles.
                console.warn(`Warning: Unexpectedly ran out of tile data at index ${tileIndex} while processing (${x}, ${y}).`);
                break; // Stop processing this row if out of tiles
            }
        }
        if (row.length > 0) {
            mapDataStrings.push(row);
        }
        if (tileIndex >= numTiles) {
             break; // Stop processing rows if we've used all tiles
        }
    }

    // Determine the actual height/width based on rows/cols created
    const actualHeight = mapDataStrings.length;
    // Use the input width as the intended width, rows might be shorter if data was insufficient
    const actualWidth = mapWidthTiles;

    // Add warning if the number of rows doesn't match the calculated height based on numTiles
    if (actualHeight > 0 && actualHeight * mapWidthTiles < numTiles) {
         console.warn(`Processed map dimensions (${actualWidth}x${actualHeight}) contain fewer tiles (${actualHeight * mapWidthTiles}) than available (${numTiles}). Data might be non-rectangular or processing stopped early.`);
    } else if (actualHeight > 0 && actualHeight * mapWidthTiles > numTiles && mapDataStrings[actualHeight-1]?.length < mapWidthTiles) {
         console.warn(`Processed map dimensions (${actualWidth}x${actualHeight}) imply more tiles than available (${numTiles}). Last row might be incomplete.`);
    }


    return {
        width: actualWidth, // Use the input width
        height: actualHeight, // Use actual processed height
        tile_passability: BASE_TILE_PASSABILITY,
        map_data: mapDataStrings // The 2D array of strings
    };
}


/**
 * Retrieves the complete current map state in a structured JSON format.
 * Includes absolute coordinates and uses 'O'/'X' for tile types.
 *
 * @returns {Promise<object|null>} A promise that resolves to an object containing
 *          the map name, dimensions, collision data, player state, and warp points,
 *          or null if a critical error occurs during data fetching.
 *          Structure defined in original JSDoc.
 */
export async function getMapStateJson() {
    try {
        const mapBank = await getCurrentMapBank();
        const mapNumber = await getCurrentMapNumber();
        const [ playerX, playerY ] = await getPlayerPosition();
        const facingDirection = await getPlayerFacingDirection();
        const rawWarps = await getCurrentMapWarps(); // Fetch raw warps first
        const mapWidth = await getMainMapWidth();
        const mapHeight = await getMainMapHeight();

        // Fetch map tiles using the obtained width and height
        // Ensure width/height are valid before fetching tiles
        if (mapWidth <= 0 || mapHeight <= 0) {
             console.warn(`Invalid map dimensions fetched: ${mapWidth}x${mapHeight}. Returning minimal state.`);
             const mapName = getMapName(mapBank, mapNumber);
             return {
                map_name: mapName,
                width: 0,
                height: 0,
                tile_passability: BASE_TILE_PASSABILITY,
                map_data: [],
                player_state: { position: [playerX, playerY], facing: facingDirection },
                warps: []
             };
        }

        const mapTiles = await getMainMapTiles(mapWidth, mapHeight);

        // Process tiles into collision map ('O'/'X')
        const collisionData = processMemoryDataToCollisionMap(mapTiles, mapWidth);
        if (!collisionData) {
             console.error("Failed to process map tiles into collision data.");
             return null; // Indicate failure
        }

        // Get map name
        const mapName = getMapName(mapBank, mapNumber);

        // Format warps AFTER getting collision data, ensuring coordinates are valid
        const warps = rawWarps
            .filter(warp => warp.x >= 0 && warp.x < collisionData.width && warp.y >= 0 && warp.y < collisionData.height) // Filter out warps outside processed bounds
            .map(warp => ({
                position: [warp.x, warp.y],
                destination: getMapName(warp.destMapGroup, warp.destMapNum)
            }));

        // Assemble the final JSON object
        const mapState = {
            map_name: mapName,
            width: collisionData.width, // Use width from processed data
            height: collisionData.height, // Use height from processed data
            tile_passability: collisionData.tile_passability, // Base passability ('O', 'X')
            map_data: collisionData.map_data, // Map data with 'O'/'X'
            player_state: {
                position: [playerX, playerY], // [col, row]
                facing: facingDirection
            },
            warps: warps // Use filtered and formatted warps
        };

        return mapState;

    } catch (error) {
        console.error("Error getting complete map state:", error);
        return null; // Return null on error
    }
}


/**
 * Validates the structure of the full map state object.
 * @param {object} state - The map state object.
 * @returns {boolean} True if the state is valid, false otherwise.
 */
function isValidFullMapState(state) {
    if (!state || typeof state !== 'object') return false;
    if (!state.player_state || !Array.isArray(state.player_state.position)) return false;
    if (typeof state.width !== 'number' || state.width < 0) return false;
    if (typeof state.height !== 'number' || state.height < 0) return false;
    if (!Array.isArray(state.map_data)) return false;

    // Check dimensions match data length only if height > 0
    if (state.height > 0 && state.map_data.length !== state.height) {
        console.warn(`Map state height mismatch: expected ${state.height}, got ${state.map_data.length}`);
        return false; // Treat mismatch as invalid for trimming
    }
    // Check row length only if height > 0 and width > 0
    if (state.height > 0 && state.width > 0) {
         if (!Array.isArray(state.map_data[0]) || state.map_data[0].length !== state.width) {
            console.warn(`Map state width mismatch: expected ${state.width}, got ${state.map_data[0]?.length ?? 'undefined'}`);
            return false; // Treat mismatch as invalid for trimming
         }
    }
    // Allow width/height 0 with empty map_data
    if ((state.width === 0 || state.height === 0) && state.map_data.length !== 0) {
        console.warn(`Map state has zero dimension but non-empty map_data`);
        return false;
    }
     if (state.width > 0 && state.height > 0 && state.map_data.length === 0) {
        console.warn(`Map state has non-zero dimensions but empty map_data`);
        return false;
    }

    return true;
}


/**
 * Trims the full map state to a viewport (max 15x10) centered around the player,
 * using absolute coordinates from the original map. Marks warp tiles as 'W'.
 * Adjusts dimensions to reflect the actual trimmed viewport bounds.
 *
 * @param {object} fullMapState - The complete map state object obtained from getMapStateJson.
 * @returns {object|null} A new map state object containing the data within the
 *          player's viewport, adjusted for map boundaries, or null if the input is invalid.
 *          Structure defined in original JSDoc, but with 'W' tile type added.
 */
function trimMapStateToViewport(fullMapState) {
    // --- Input Validation ---
    if (!isValidFullMapState(fullMapState)) {
        console.error("Invalid fullMapState provided for trimming.", fullMapState);
        return null;
    }

    const {
        map_name,
        width: fullWidth,
        height: fullHeight,
        map_data: fullMapData, // Expected format: string[][] e.g., ["0,0:X", "1,0:O"]
        player_state,
        warps: fullWarps = [] // Default to empty array if missing
    } = fullMapState;

    // Handle case where map is empty (width/height 0) gracefully
    if (fullWidth === 0 || fullHeight === 0) {
         console.warn("Trimming an empty map state.");
         return {
            map_name: map_name,
            width: 0,
            height: 0,
            tile_passability: VIEWPORT_TILE_PASSABILITY, // Include W definition
            map_data: [],
            player_state: player_state, // Keep original player state
            warps: []
        };
    }

    const [playerX, playerY] = player_state.position;

    // --- Calculate Viewport Boundaries ---
    // Center viewport around player
    const halfWidth = Math.floor(MAX_VIEWPORT_WIDTH / 2);
    const halfHeight = Math.floor(MAX_VIEWPORT_HEIGHT / 2);

    const idealStartX = playerX - halfWidth;
    const idealStartY = playerY - halfHeight;
    // Calculate end coordinates (exclusive) based on start and max size
    const idealEndX = idealStartX + MAX_VIEWPORT_WIDTH;
    const idealEndY = idealStartY + MAX_VIEWPORT_HEIGHT;

    // Clamp boundaries to actual map dimensions
    const actualStartX = Math.max(0, idealStartX);
    const actualStartY = Math.max(0, idealStartY);
    const actualEndX = Math.min(fullWidth, idealEndX); // Exclusive
    const actualEndY = Math.min(fullHeight, idealEndY); // Exclusive

    // Calculate actual viewport dimensions
    const actualViewportWidth = actualEndX - actualStartX;
    const actualViewportHeight = actualEndY - actualStartY;

    // --- Check for invalid dimensions after clamping ---
    if (actualViewportWidth <= 0 || actualViewportHeight <= 0) {
        // This might happen if player coords are somehow outside valid map range,
        // despite map dimensions being > 0.
        console.warn(`Calculated viewport has zero or negative dimensions (${actualViewportWidth}x${actualViewportHeight}). Player: [${playerX}, ${playerY}], Map: ${fullWidth}x${fullHeight}. Returning minimal valid state.`);
         return {
            map_name: map_name,
            width: 0,
            height: 0,
            tile_passability: VIEWPORT_TILE_PASSABILITY, // Include W definition
            map_data: [],
            player_state: player_state, // Use original player state
            warps: []
        };
    }

    // --- Filter Warps and Create Lookup Set ---
    const trimmedWarps = [];
    const warpLocations = new Set(); // Set for quick lookup: "x,y"

    for (const warp of fullWarps) {
        // Ensure warp position is valid before accessing
        if (warp && Array.isArray(warp.position) && warp.position.length === 2) {
            const [warpX, warpY] = warp.position;

            // Check if the warp falls within the *actual* viewport bounds
            if (warpX >= actualStartX && warpX < actualEndX &&
                warpY >= actualStartY && warpY < actualEndY)
            {
                // Keep the original absolute warp position
                trimmedWarps.push({
                    position: [warpX, warpY],
                    destination: warp.destination || "Unknown Destination" // Add fallback
                });
                warpLocations.add(`${warpX},${warpY}`); // Add to lookup set
            }
        } else {
             console.warn("Skipping invalid warp object:", warp);
        }
    }

    // --- Populate Trimmed Data (Marking Warps) ---
    const trimmedMapData = [];

    // Iterate over the *actual* map coordinates within the calculated viewport
    for (let currentMapY = actualStartY; currentMapY < actualEndY; currentMapY++) {
        const row = [];
        // Ensure the row exists in the source data
        const sourceRow = fullMapData[currentMapY];
        if (!sourceRow) {
             console.warn(`Missing expected row ${currentMapY} in fullMapData during trimming.`);
             continue; // Skip this row if missing
        }

        for (let currentMapX = actualStartX; currentMapX < actualEndX; currentMapX++) {
            let tileType = TILE_BLOCKED; // Default to Blocked
            const coordString = `${currentMapX},${currentMapY}`;

            // Check if the current tile is a warp location first
            if (warpLocations.has(coordString)) {
                tileType = TILE_WARP; // Mark as Warp
            } else {
                // Get the original tile string from the full map data
                const originalTileString = sourceRow[currentMapX]; // Access validated sourceRow

                if (typeof originalTileString === 'string' && originalTileString.includes(':')) {
                    const parts = originalTileString.split(':');
                    const typeFromData = parts[parts.length - 1]; // Get last part after ':'

                    // Validate it's one of the expected base types
                    if (typeFromData === TILE_WALKABLE || typeFromData === TILE_BLOCKED) {
                         tileType = typeFromData;
                    } else {
                         console.warn(`Unexpected tile type '${typeFromData}' found at (${currentMapX}, ${currentMapY}). Defaulting to '${TILE_BLOCKED}'.`);
                         // Keep default TILE_BLOCKED
                    }
                } else {
                    // Fallback if data is missing/malformed for this coordinate
                    console.warn(`Missing or invalid tile string at full map coords (${currentMapX}, ${currentMapY}) within calculated bounds. Defaulting to '${TILE_BLOCKED}'.`);
                    // Keep default TILE_BLOCKED
                }
            }

            // Push the string with *absolute* map coordinates "x,y:T"
            row.push(`${coordString}:${tileType}`);
        }
         // Only add non-empty rows (should always be non-empty if width > 0)
        if (row.length > 0) {
            trimmedMapData.push(row);
        }
    }

    // --- Assemble the Trimmed State Object ---
    const trimmedMapState = {
        map_name: map_name,
        width: actualViewportWidth,   // Use actual calculated width
        height: actualViewportHeight, // Use actual calculated height
        tile_passability: VIEWPORT_TILE_PASSABILITY, // Use extended passability map
        map_data: trimmedMapData,     // Contains data only for the actual viewport area
        player_state: player_state,   // Keep original player state (absolute coords)
        warps: trimmedWarps           // Warps filtered to viewport (absolute coords)
    };

    return trimmedMapState;
}


/**
 * Retrieves the current map state trimmed to a viewport around the player.
 * Warp locations within the viewport are marked as 'W' in the map_data.
 *
 * @returns {Promise<object|null>} A promise that resolves to an object containing
 *          the map name, dimensions, collision data, player state, and warp points,
 *          trimmed to a viewport (max 15x10) centered around the player.
 *          Coordinates remain *absolute*. Returns null if a critical error occurs.
 */
export async function getVisibleMapStateJson() {
    try {
        const fullState = await getMapStateJson();
        if (!fullState) {
            // Error logged in getMapStateJson
            return null;
        }

        // trimMapStateToViewport handles validation and empty states
        const trimmedState = trimMapStateToViewport(fullState);
        // trimMapStateToViewport returns null on invalid input state
        if (!trimmedState) {
             console.error("Failed to trim map state to viewport, possibly due to invalid full state.");
             return null;
        }

        return trimmedState;

    } catch (error) {
        console.error("Error getting visible map state:", error);
        return null;
    }
}