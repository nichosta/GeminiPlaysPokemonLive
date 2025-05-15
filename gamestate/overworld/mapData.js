import { readUint8, readUint16, readUint32, readRange } from "../emulatorInteraction/httpMemoryReader.js";
import { getMapName } from "../../constant/map_map.js";
import { getEventObjectName } from "../../constant/event_object_map.js";
import * as CONSTANTS from "../constant/constants.js";
import { getCurrentMapBank, getCurrentMapNumber, getPlayerFacingDirection, getPlayerPosition, isPlayerSurfing } from "./playerData.js";
import { getCurrentMapNpcs, getCurrentMapWarps } from "./mapEvents.js";
import { getMainMapHeight, getMainMapTiles, getMainMapWidth, getBackupMapWidth, getBackupMapHeight, getBackupMapTiles } from "./mapLayouts.js";
import { getCurrentMapConnections } from "./mapConnections.js";
import { getMainMapMetatileBehaviors, getBackupMapMetatileBehaviors } from "./mapMetatiles.js";
import { getMetatileBehaviorName, WATER_TILES, LEDGE_DIRECTIONS } from "../../constant/metatile_behaviors_map.js";

// --- Constants ---
const TILE_WALKABLE = 'O';
const TILE_BLOCKED = 'X';
const TILE_WARP = 'W';
const TILE_NPC = '!';
const TILE_WATER = '~';
const TILE_LEDGE_EAST = '→';
const TILE_LEDGE_WEST = '←';
const TILE_LEDGE_NORTH = '↑';
const TILE_LEDGE_SOUTH = '↓';
const TILE_CONNECTION = 'C';

const BASE_TILE_PASSABILITY = Object.freeze({
    [TILE_WALKABLE]: "walkable",
    [TILE_BLOCKED]: "blocked",
    [TILE_WATER]: "requires surf",
    [TILE_LEDGE_EAST]: "ledge (only walkable in the indicated direction)",
    [TILE_LEDGE_WEST]: "ledge (only walkable in the indicated direction)",
    [TILE_LEDGE_NORTH]: "ledge (only walkable in the indicated direction)",
    [TILE_LEDGE_SOUTH]: "ledge (only walkable in the indicated direction)",
    [TILE_CONNECTION]: "connection to adjacent map area",
});

const VIEWPORT_TILE_PASSABILITY = Object.freeze({
    ...BASE_TILE_PASSABILITY,
    [TILE_WARP]: "warp",
    [TILE_NPC]: "npc",
    // Ledge descriptions are inherited from BASE_TILE_PASSABILITY
});

const MAX_VIEWPORT_WIDTH = 15;
const MAX_VIEWPORT_HEIGHT = 10;

/**
 * Processes raw map tile byte data into a structured map object with coordinate-based tile strings.
 *
 * @param {number[]} tileGridData - Array of u16 values, where each value represents a map tile's full data.
 * @param {number} mapWidthTiles - The width of the map in tiles.
 * @param {number[]} allMetatileBehaviors - Array of behavior bytes for all metatiles (primary and secondary combined).
 * @returns {{width: number, height: number, tile_passability: object, map_data: string[][]}|null}
 *          An object containing:
 *          - width: The width of the map in tiles.
 *          - height: The height of the map in tiles.
 *          - tile_passability: A mapping { "O": "walkable", "X": "blocked" }.
 *          - map_data: A 2D array where each element is a string "x,y:T".
 *                      (T is 'O' for walkable, 'X' for blocked).
 *                      Coordinates (x, y) are absolute within the full map.
 *          Returns null if input is invalid or processing fails.
 */
async function processMemoryDataToCollisionMap(tileGridData, mapWidthTiles, allMetatileBehaviors) {
    // --- Input Validation ---
    if (!Array.isArray(tileGridData)) {
        console.error("Invalid input: tileGridData must be an array.");
        return null;
    }
    if (typeof mapWidthTiles !== 'number' || mapWidthTiles <= 0) {
        console.error("Invalid input: mapWidthTiles must be a positive number.");
        return null;
    }
    if (!Array.isArray(allMetatileBehaviors)) {
        console.error("Invalid input: allMetatileBehaviors must be an array.");
        return null; // Or handle as if no special behaviors exist
    }

    const numTiles = tileGridData.length;

    // Handle cases where mapWidthTiles is valid but numTiles is 0 (e.g. map height is 0)
    if (numTiles === 0 && mapWidthTiles > 0) {
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
                const tileValue = tileGridData[tileIndex];
                let tileType;

                // Priority 1: Check for MAPGRID_UNDEFINED (boundary tile)
                if (tileValue === CONSTANTS.MAPGRID_UNDEFINED) {
                    tileType = TILE_BLOCKED;
                } else {
                    // Priority 2: Check metatile behaviors (ledges, water)
                    const metatileId = tileValue & CONSTANTS.MAPGRID_METATILE_ID_MASK;
                    const behaviorByte = allMetatileBehaviors[metatileId];
                    const behaviorName = getMetatileBehaviorName(behaviorByte); // Handles undefined behaviorByte
                    const ledgeChar = behaviorName ? LEDGE_DIRECTIONS.get(behaviorName) : undefined;

                    if (ledgeChar) {
                        tileType = ledgeChar;
                    } else if (behaviorName && WATER_TILES.includes(behaviorName)) {
                        tileType = TILE_WATER;
                    } else {
                        // Priority 3: Fallback to collision bits
                        const collisionBits = (tileValue & CONSTANTS.MAPGRID_COLLISION_MASK) >> 10;
                        tileType = (collisionBits === 0) ? TILE_WALKABLE : TILE_BLOCKED;
                    }
                 }
 
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

    const actualHeight = mapDataStrings.length;
    const actualWidth = mapWidthTiles;

    if (actualHeight > 0 && actualHeight * mapWidthTiles < numTiles) {
         console.warn(`Processed map dimensions (${actualWidth}x${actualHeight}) contain fewer tiles (${actualHeight * mapWidthTiles}) than available (${numTiles}). Data might be non-rectangular or processing stopped early.`);
    } else if (actualHeight > 0 && actualHeight * mapWidthTiles > numTiles && mapDataStrings[actualHeight-1]?.length < mapWidthTiles) {
         console.warn(`Processed map dimensions (${actualWidth}x${actualHeight}) imply more tiles than available (${numTiles}). Last row might be incomplete.`);
    }


    return {
        width: actualWidth,
        height: actualHeight,
        tile_passability: BASE_TILE_PASSABILITY,
        map_data: mapDataStrings
    };
}


/**
 * Retrieves the complete current map state in a structured JSON format.
 * Includes absolute coordinates and uses 'O'/'X' for tile types in map_data.
 *
 * @returns {Promise<object|null>} A promise that resolves to an object containing
 *          the map name, dimensions, collision data, player state, warp points,
 *          and NPC data, or null if a critical error occurs during data fetching.
 *          Structure:
 *          {
 *              map_name: string,
 *              width: number,
 *              height: number,
 *              tile_passability: { "O": string, "X": string },
 *              map_data: string[][], // e.g., ["0,0:X", "1,0:O"]
 *              player_state: { position: [number, number], facing: string},
 *              warps: Array<{ position: [number, number], destination: string }>,
 *              npcs: Array<{ id: number, position: [number, number], type: string, isOffScreen: boolean }>,
 *              connections: Array<{direction: string, mapName: string}>
 *          }
 */
export async function getMapStateJson() {
    try {
        const mapBank = await getCurrentMapBank();
        const mapNumber = await getCurrentMapNumber();
        const [ playerX, playerY ] = await getPlayerPosition();
        const facingDirection = await getPlayerFacingDirection();
        const rawWarps = await getCurrentMapWarps(); // Fetch raw warps
        const rawNpcs = await getCurrentMapNpcs(); // Fetch raw NPCs
        const mapWidth = await getMainMapWidth();
        const mapHeight = await getMainMapHeight();
        const mapConnections = await getCurrentMapConnections();
        const allMetatileBehaviors = await getMainMapMetatileBehaviors();

        const mapName = getMapName(mapBank, mapNumber);

        // Ensure width/height are valid before fetching tiles
        if (mapWidth <= 0 || mapHeight <= 0) {
             console.warn(`Invalid map dimensions fetched: ${mapWidth}x${mapHeight} for ${mapName}. Returning minimal state.`);
             return {
                map_name: mapName,
                width: 0,
                height: 0,
                tile_passability: BASE_TILE_PASSABILITY,
                map_data: [],
                player_state: { position: [playerX, playerY], facing: facingDirection },
                warps: [],
                npcs: [],
                connections: mapConnections, // Include connections even for minimal state
             };
        }

        if (!allMetatileBehaviors) {
            console.error(`Failed to fetch metatile behaviors for ${mapName}. Collision map might be inaccurate.`);
            // Proceed, but collision map will only use collision bits.
        }

        const mapTiles = await getMainMapTiles(mapWidth, mapHeight);

        // Process tiles into collision map ('O'/'X')
        const collisionData = await processMemoryDataToCollisionMap(mapTiles, mapWidth, allMetatileBehaviors || []);
        if (!collisionData) {
             console.error(`Failed to process map tiles into collision data for ${mapName}.`);
             return null; // Indicate failure
        }

        // Format warps AFTER getting collision data, ensuring coordinates are valid
        const warps = rawWarps
            .filter(warp => warp.x >= 0 && warp.x < collisionData.width && warp.y >= 0 && warp.y < collisionData.height)
            .map(warp => ({
                position: [warp.x, warp.y],
                destination: getMapName(warp.destMapGroup, warp.destMapNum) || `Unknown Map (${warp.destMapGroup}-${warp.destMapNum})`
            }));

        // Format npcs AFTER getting collision data, ensuring coordinates are valid
        const npcs = rawNpcs
            .filter(npc => npc.x >= 0 && npc.x < collisionData.width && npc.y >= 0 && npc.y < collisionData.height)
            .map(npc => ({
                id: npc.id,
                position: [npc.x, npc.y],
                type: getEventObjectName(npc.graphicsId) || `Unknown NPC (ID: ${npc.graphicsId})`,
                isOffScreen: npc.isOffScreen,
                wandering: npc.wandering,
            }));

        // Assemble the final JSON object
        const mapState = {
            map_name: mapName,
            width: collisionData.width,
            height: collisionData.height,
            tile_passability: collisionData.tile_passability, // Base passability ('O', 'X')
            map_data: collisionData.map_data, // Map data with 'O'/'X'
            player_state: {
                position: [playerX, playerY], // [col, row]
                facing: facingDirection
            },
            warps: warps,
            npcs: npcs,
            connections: mapConnections,
        };

        return mapState;

    } catch (error) {
        console.error("Error getting complete map state:", error);
        return null; // Return null on error
    }
}

/**
 * Retrieves the complete backup map state in a structured JSON format.
 * This state includes raw map data indexed from 0,0 of the backup map,
 * and the necessary offset to translate these to "unoffset" world coordinates.
 *
 * @returns {Promise<object|null>} A promise that resolves to an object containing
 *          backup map details, or null if a critical error occurs.
 *          Structure:
 *          {
 *              map_name: string,
 *              width: number, // Full padded width of the backup map
 *              height: number, // Full padded height of the backup map
 *              tile_passability: { "O": string, "X": string, ... },
 *              map_data_raw: string[][], // Raw backup map_data, coords are 0-indexed for backup map, may include 'C'
 *              coord_offset_x: number, // Offset to add to unoffset X to get backup map X
 *              coord_offset_y: number, // Offset to add to unoffset Y to get backup map Y
 *              player_state: { position: [number, number], facing: string}, // Unoffset player coords
 *              warps: Array<{ position: [number, number], destination: string }>, // Warps with unoffset coords
 *              npcs: Array<{ id: number, position: [number, number], type: string, isOffScreen: boolean, wandering: boolean }>, // NPCs with unoffset coords
 *              all_connections: Array<{direction: string, mapName: string}>, // All connections of the main map
 *              main_map_width: number, // Actual width of the main map
 *              main_map_height: number // Actual height of the main map
 *          }
 */
async function getBackupMapStateJson() {
    try {
        // --- Player and Current Map Info (for context) ---
        const [playerX, playerY] = await getPlayerPosition(); // Unoffset player coords
        const facingDirection = await getPlayerFacingDirection();
        const currentMapBank = await getCurrentMapBank();
        const currentMapNumber = await getCurrentMapNumber();
        const currentMapName = getMapName(currentMapBank, currentMapNumber) || "Unknown Main Map";

        const backupMapWidth = await getBackupMapWidth();
        const backupMapHeight = await getBackupMapHeight();
        const backupMetatileBehaviors = await getBackupMapMetatileBehaviors();

        // --- Main map dimensions needed for connection 'C' tile placement ---
        // --- and for the final output width/height of the visible backup map state ---
        const mainMapWidth = await getMainMapWidth();
        const mainMapHeight = await getMainMapHeight();

        // console.log(`[BackupMapDebug] Main Map Dimensions: ${mainMapWidth}x${mainMapHeight}`);
        if (mainMapWidth === 0 || mainMapHeight === 0) {
            console.warn("[BackupMapDebug] Main map width or height is 0. C-tiles will not be processed.");
        }

        const mainMapConnections = await getCurrentMapConnections();
        const internalBackupMapName = "Backup Map"; // Internal name for logging, etc.

        if (backupMapWidth <= 0 || backupMapHeight <= 0) {
            console.warn(`Invalid backup map dimensions fetched for ${internalBackupMapName}: ${backupMapWidth}x${backupMapHeight}. Returning minimal state.`);
            return {
                map_name: currentMapName, // Use main map's name
                width: 0,
                height: 0,
                tile_passability: VIEWPORT_TILE_PASSABILITY,
                map_data_raw: [],
                coord_offset_x: CONSTANTS.MAP_OFFSET,
                coord_offset_y: CONSTANTS.MAP_OFFSET,
                player_state: { position: [playerX, playerY], facing: facingDirection },
                warps: [],
                npcs: [],
                all_connections: mainMapConnections || [], // Pass along whatever was fetched
                main_map_width: mainMapWidth || 0,
                main_map_height: mainMapHeight || 0,
            };
        }

        if (!backupMetatileBehaviors) {
            console.error(`Failed to fetch metatile behaviors for ${internalBackupMapName}. Collision map might be inaccurate.`);
            // Proceed, but collision map will only use collision bits.
        }

        const backupMapTiles = await getBackupMapTiles(backupMapWidth, backupMapHeight);
        const collisionData = await processMemoryDataToCollisionMap(backupMapTiles, backupMapWidth, backupMetatileBehaviors || []);

        if (!collisionData) {
            console.error(`Failed to process backup map tiles into collision data for ${internalBackupMapName}.`);
            return null;
        }

        // Helper to check if a tile type is considered walkable for connection purposes.
        // Extend this if other tile types (e.g., water without surf) should also block connections.
        const isConnectableTileType = (tileType) => tileType !== TILE_BLOCKED;

        // --- Modify collisionData.map_data to add 'C' for connections ---
        // Iterate over the backup map's grid (collisionData.map_data)
        // collisionData.map_data[by][bx] is "backupX,backupY:TileType"
        // console.log("[BackupMapDebug] Main Map Connections for C-tile logic:", JSON.stringify(mainMapConnections));
        if (mainMapWidth > 0 && mainMapHeight > 0 && mainMapConnections) { // Only add 'C' if main map dimensions and connections are valid
            for (let by = 0; by < collisionData.height; by++) {
                for (let bx = 0; bx < collisionData.width; bx++) {
                    const tileString = collisionData.map_data[by][bx];
                    const originalTileType = tileString.split(':')[1];
                    let isCandidateForC = false; // Flag to see if it's even in a C-tile position

                    // Check if tile is walkable (O, or non-blocking ledges/water)
                    // For simplicity, let's consider 'O' and ledges/water as potentially connectable.
                    // TILE_BLOCKED ('X') should not be a connection.
                    // Condition 1: The backup map tile itself must be connectable.
                    if (!isConnectableTileType(originalTileType)) {
                        continue;
                    }

                    let markAsConnection = false;

                    // --- Check Straight Edges ---
                    // Left edge of main map (current tile bx is MAP_OFFSET - 1)
                    if (bx === CONSTANTS.MAP_OFFSET - 1 && (by >= CONSTANTS.MAP_OFFSET && by < CONSTANTS.MAP_OFFSET + mainMapHeight)) {
                        isCandidateForC = true;
                        const conn = mainMapConnections.find(c => c.direction === "left");
                        const mapNameForConn = conn ? conn.mapName : null;
                        // console.log(`[BackupMapDebug] Left Edge Check at (${bx},${by}): originalType=${originalTileType}, connFound=${!!conn}, mapNameForConn=${mapNameForConn}`);
                        // Condition 2: Valid connection exists (not MAP_NONE)
                        if (conn && mapNameForConn) {
                            const innerAdjTileString = collisionData.map_data[by][bx + 1]; // Tile at main map's edge
                            const innerAdjType = innerAdjTileString.split(':')[1];
                            // console.log(`[BackupMapDebug] ... InnerAdjType=${innerAdjType}, isConnectableOuter=${isConnectableTileType(originalTileType)}, isConnectableInner=${isConnectableTileType(innerAdjType)}`);
                            // Condition 3: Inner adjacent tile is also connectable
                            if (isConnectableTileType(innerAdjType)) markAsConnection = true;
                        }
                    }
                    // Right edge
                    if (!markAsConnection && bx === CONSTANTS.MAP_OFFSET + mainMapWidth && (by >= CONSTANTS.MAP_OFFSET && by < CONSTANTS.MAP_OFFSET + mainMapHeight)) {
                        isCandidateForC = true;
                        const conn = mainMapConnections.find(c => c.direction === "right");
                        const mapNameForConn = conn ? conn.mapName : null;
                        // console.log(`[BackupMapDebug] Right Edge Check at (${bx},${by}): originalType=${originalTileType}, connFound=${!!conn}, mapNameForConn=${mapNameForConn}`);
                        if (conn && mapNameForConn) {
                            const innerAdjTileString = collisionData.map_data[by][bx - 1];
                            const innerAdjType = innerAdjTileString.split(':')[1];
                            // console.log(`[BackupMapDebug] ... InnerAdjType=${innerAdjType}, isConnectableOuter=${isConnectableTileType(originalTileType)}, isConnectableInner=${isConnectableTileType(innerAdjType)}`);
                            if (isConnectableTileType(innerAdjType)) markAsConnection = true;
                        }
                    }
                    // Top edge
                    if (!markAsConnection && by === CONSTANTS.MAP_OFFSET - 1 && (bx >= CONSTANTS.MAP_OFFSET && bx < CONSTANTS.MAP_OFFSET + mainMapWidth)) {
                        isCandidateForC = true;
                        const conn = mainMapConnections.find(c => c.direction === "up");
                        const mapNameForConn = conn ? conn.mapName : null;
                        // console.log(`[BackupMapDebug] Top Edge Check at (${bx},${by}): originalType=${originalTileType}, connFound=${!!conn}, mapNameForConn=${mapNameForConn}`);
                        if (conn && mapNameForConn) {
                            const innerAdjTileString = collisionData.map_data[by + 1][bx];
                            const innerAdjType = innerAdjTileString.split(':')[1];
                            // console.log(`[BackupMapDebug] ... InnerAdjType=${innerAdjType}, isConnectableOuter=${isConnectableTileType(originalTileType)}, isConnectableInner=${isConnectableTileType(innerAdjType)}`);
                            if (isConnectableTileType(innerAdjType)) markAsConnection = true;
                        }
                    }
                    // Bottom edge
                    if (!markAsConnection && by === CONSTANTS.MAP_OFFSET + mainMapHeight && (bx >= CONSTANTS.MAP_OFFSET && bx < CONSTANTS.MAP_OFFSET + mainMapWidth)) {
                        isCandidateForC = true;
                        const conn = mainMapConnections.find(c => c.direction === "down");
                        const mapNameForConn = conn ? conn.mapName : null;
                        // console.log(`[BackupMapDebug] Bottom Edge Check at (${bx},${by}): originalType=${originalTileType}, connFound=${!!conn}, mapNameForConn=${mapNameForConn}`);
                        if (conn && mapNameForConn) {
                            const innerAdjTileString = collisionData.map_data[by - 1][bx];
                            const innerAdjType = innerAdjTileString.split(':')[1];
                            // console.log(`[BackupMapDebug] ... InnerAdjType=${innerAdjType}, isConnectableOuter=${isConnectableTileType(originalTileType)}, isConnectableInner=${isConnectableTileType(innerAdjType)}`);
                            if (isConnectableTileType(innerAdjType)) markAsConnection = true;
                        }
                    }

                    // --- Check Corners ---
                    // Top-Left Corner (bx = MAP_OFFSET - 1, by = MAP_OFFSET - 1)
                    if (!markAsConnection && bx === CONSTANTS.MAP_OFFSET - 1 && by === CONSTANTS.MAP_OFFSET - 1) {
                        isCandidateForC = true;
                        // console.log(`[BackupMapDebug] Top-Left Corner Check at (${bx},${by}): originalType=${originalTileType}`);
                        const leftConn = mainMapConnections.find(c => c.direction === "left");
                        const upConn = mainMapConnections.find(c => c.direction === "up");
                        const mapNameForLeftConn = leftConn ? getMapName(leftConn.mapGroup, leftConn.mapNum) : null;
                        const mapNameForUpConn = upConn ? getMapName(upConn.mapGroup, upConn.mapNum) : null;

                        if (leftConn && mapNameForLeftConn && isConnectableTileType(collisionData.map_data[by][bx + 1].split(':')[1])) {
                            // console.log(`[BackupMapDebug] ... TL Corner via Left: connFound=${!!leftConn}, mapName=${mapNameForLeftConn}, innerType=${collisionData.map_data[by][bx + 1].split(':')[1]}`);
                            markAsConnection = true;
                        }
                        if (!markAsConnection && upConn && mapNameForUpConn && isConnectableTileType(collisionData.map_data[by + 1][bx].split(':')[1])) {
                            // console.log(`[BackupMapDebug] ... TL Corner via Up: connFound=${!!upConn}, mapName=${mapNameForUpConn}, innerType=${collisionData.map_data[by + 1][bx].split(':')[1]}`);
                            markAsConnection = true;
                        }
                    }
                    // Top-Right Corner (bx = MAP_OFFSET + mainMapWidth, by = MAP_OFFSET - 1)
                    if (!markAsConnection && bx === CONSTANTS.MAP_OFFSET + mainMapWidth && by === CONSTANTS.MAP_OFFSET - 1) {
                        isCandidateForC = true;
                        // console.log(`[BackupMapDebug] Top-Right Corner Check at (${bx},${by}): originalType=${originalTileType}`);
                        const rightConn = mainMapConnections.find(c => c.direction === "right");
                        const upConn = mainMapConnections.find(c => c.direction === "up");
                        const mapNameForRightConn = rightConn ? getMapName(rightConn.mapGroup, rightConn.mapNum) : null;
                        const mapNameForUpConn = upConn ? getMapName(upConn.mapGroup, upConn.mapNum) : null;

                        if (rightConn && mapNameForRightConn && isConnectableTileType(collisionData.map_data[by][bx - 1].split(':')[1])) {
                            markAsConnection = true;
                        }
                        if (!markAsConnection && upConn && mapNameForUpConn && isConnectableTileType(collisionData.map_data[by + 1][bx].split(':')[1])) {
                            markAsConnection = true;
                        }
                    }
                    // Bottom-Left Corner (bx = MAP_OFFSET - 1, by = MAP_OFFSET + mainMapHeight)
                    if (!markAsConnection && bx === CONSTANTS.MAP_OFFSET - 1 && by === CONSTANTS.MAP_OFFSET + mainMapHeight) {
                        isCandidateForC = true;
                        // console.log(`[BackupMapDebug] Bottom-Left Corner Check at (${bx},${by}): originalType=${originalTileType}`);
                        const leftConn = mainMapConnections.find(c => c.direction === "left");
                        const downConn = mainMapConnections.find(c => c.direction === "down");
                        const mapNameForLeftConn = leftConn ? getMapName(leftConn.mapGroup, leftConn.mapNum) : null;
                        const mapNameForDownConn = downConn ? getMapName(downConn.mapGroup, downConn.mapNum) : null;

                        if (leftConn && mapNameForLeftConn && isConnectableTileType(collisionData.map_data[by][bx + 1].split(':')[1])) {
                            markAsConnection = true;
                        }
                        if (!markAsConnection && downConn && mapNameForDownConn && isConnectableTileType(collisionData.map_data[by - 1][bx].split(':')[1])) {
                            markAsConnection = true;
                        }
                    }
                    // Bottom-Right Corner (bx = MAP_OFFSET + mainMapWidth, by = MAP_OFFSET + mainMapHeight)
                    if (!markAsConnection && bx === CONSTANTS.MAP_OFFSET + mainMapWidth && by === CONSTANTS.MAP_OFFSET + mainMapHeight) {
                        isCandidateForC = true;
                        // console.log(`[BackupMapDebug] Bottom-Right Corner Check at (${bx},${by}): originalType=${originalTileType}`);
                        const rightConn = mainMapConnections.find(c => c.direction === "right");
                        const downConn = mainMapConnections.find(c => c.direction === "down");
                        const mapNameForRightConn = rightConn ? getMapName(rightConn.mapGroup, rightConn.mapNum) : null;
                        const mapNameForDownConn = downConn ? getMapName(downConn.mapGroup, downConn.mapNum) : null;

                        if (rightConn && mapNameForRightConn && isConnectableTileType(collisionData.map_data[by][bx - 1].split(':')[1])) {
                            markAsConnection = true;
                        }
                        if (!markAsConnection && downConn && mapNameForDownConn && isConnectableTileType(collisionData.map_data[by - 1][bx].split(':')[1])) {
                            markAsConnection = true;
                        }
                    }

                    if (markAsConnection) {
                        // console.log(`[BackupMapDebug] Marking (${bx},${by}) as TILE_CONNECTION. Original type was ${originalTileType}.`);
                        collisionData.map_data[by][bx] = `${bx},${by}:${TILE_CONNECTION}`;
                    } else if (isCandidateForC && isConnectableTileType(originalTileType)) {
                        // console.log(`[BackupMapDebug] Candidate C-tile at (${bx},${by}) was not marked. OriginalType=${originalTileType}. Conditions failed.`);
                    }
                }
            }
        }

        // --- Fetch and Format Warps and NPCs (using current map's events) ---
        // Coordinates are already unoffset or main-map relative.
        const rawWarps = await getCurrentMapWarps();
        const warps = rawWarps.map(warp => ({
            position: [warp.x, warp.y], // These are main map 0-indexed, effectively unoffset
            destination: getMapName(warp.destMapGroup, warp.destMapNum) || `Unknown Map (${warp.destMapGroup}-${warp.destMapNum})`
        }));

        const rawNpcs = await getCurrentMapNpcs(); // These return unoffset coordinates
        const npcs = rawNpcs.map(npc => ({
            id: npc.id,
            position: [npc.x, npc.y], // Already unoffset
            type: getEventObjectName(npc.graphicsId) || `Unknown NPC (ID: ${npc.graphicsId})`,
            isOffScreen: npc.isOffScreen,
            wandering: npc.wandering,
        }));

        return {
            map_name: currentMapName, // Use main map's name
            width: collisionData.width, // This is the full padded width of the backup map
            height: collisionData.height, // Full padded height
            tile_passability: VIEWPORT_TILE_PASSABILITY, // Use extended passability as 'C' is added
            map_data_raw: collisionData.map_data, // Raw data, strings contain "backupX,backupY:T"
            coord_offset_x: CONSTANTS.MAP_OFFSET,
            coord_offset_y: CONSTANTS.MAP_OFFSET,
            player_state: {
                position: [playerX, playerY], // Unoffset player coordinates
                facing: facingDirection
            },
            warps: warps,
            npcs: npcs,
            all_connections: mainMapConnections || [],
            main_map_width: mainMapWidth || 0,
            main_map_height: mainMapHeight || 0,
        };
    } catch (error) {
        console.error("Error getting complete backup map state:", error);
        return null;
    }
}


/**
 * Validates the structure of the full map state object.
 * @param {object} state - The map state object.
 * @returns {boolean} True if the state is valid, false otherwise.
 */
function isValidFullMapState(state) {
    if (!state || typeof state !== 'object') return false;
    if (!state.player_state || !Array.isArray(state.player_state.position) || state.player_state.position.length !== 2) return false;
    if (typeof state.width !== 'number' || state.width < 0) return false;
    if (typeof state.height !== 'number' || state.height < 0) return false;
    if (!Array.isArray(state.map_data)) return false;
    if (!Array.isArray(state.warps)) return false;
    if (!Array.isArray(state.npcs)) return false;
    if (!Array.isArray(state.connections)) return false;

    // Basic dimension/data consistency checks
    if (state.height > 0 && state.map_data.length !== state.height) {
        console.warn(`Map state height mismatch: expected ${state.height}, got ${state.map_data.length}`);
        return false;
    }
    if (state.height > 0 && state.width > 0) {
         if (!Array.isArray(state.map_data[0]) || state.map_data[0].length !== state.width) {
            console.warn(`Map state width mismatch: expected ${state.width}, got ${state.map_data[0]?.length ?? 'undefined'}`);
            return false;
         }
    }
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
 * using absolute coordinates from the original map. Marks warp tiles as 'W' and NPC tiles as '!'.
 * Adjusts dimensions to reflect the actual trimmed viewport bounds. Also filters NPCs and Warps.
 *
 * @param {object} fullMapState - The complete map state object obtained from getMapStateJson.
 * @returns {object|null} A new map state object containing the data within the
 *          player's viewport, adjusted for map boundaries, or null if the input is invalid.
 *          Structure includes map_name, width, height,
 *          tile_passability (with 'X'/'O'/'W'/'!'),
 *          map_data (with 'X'/'O'/'W'/'!' markers),
 *          player_state, filtered warps, and filtered npcs.
 *          NPCs include `id`, `position`, `type`, and `wandering` status.
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
        map_data: fullMapData,
        player_state,
        warps: fullWarps = [],
        npcs: fullNpcs = [],
        connections: fullConnections = []
    } = fullMapState;

    // Handle case where map is empty
    if (fullWidth === 0 || fullHeight === 0) {
         console.warn(`Trimming an empty map state for ${map_name}.`);
         return {
            map_name: map_name,
            width: 0,
            height: 0,
            tile_passability: VIEWPORT_TILE_PASSABILITY, // Use extended passability
            map_data: [],
            player_state: player_state,
            warps: [],
            npcs: [],
            connections: [] // No connections if map is empty
        };
    }

    const [playerX, playerY] = player_state.position;

    // --- Calculate Viewport Boundaries ---
    const halfWidth = Math.floor(MAX_VIEWPORT_WIDTH / 2);
    const halfHeight = Math.floor(MAX_VIEWPORT_HEIGHT / 2);

    const idealStartX = playerX - halfWidth;
    const idealStartY = playerY - halfHeight;
    const idealEndX = idealStartX + MAX_VIEWPORT_WIDTH;
    const idealEndY = idealStartY + MAX_VIEWPORT_HEIGHT;

    // Clamp boundaries to actual map dimensions
    const actualStartX = Math.max(0, idealStartX);
    const actualStartY = Math.max(0, idealStartY);
    const actualEndX = Math.min(fullWidth, idealEndX);
    const actualEndY = Math.min(fullHeight, idealEndY);

    const actualViewportWidth = actualEndX - actualStartX;
    const actualViewportHeight = actualEndY - actualStartY;

    // --- Check for invalid dimensions after clamping ---
    if (actualViewportWidth <= 0 || actualViewportHeight <= 0) {
        console.warn(`Calculated viewport has zero or negative dimensions (${actualViewportWidth}x${actualViewportHeight}) for ${map_name}. Player: [${playerX}, ${playerY}], Map: ${fullWidth}x${fullHeight}. Returning minimal valid state.`);
         return {
            map_name: map_name,
            width: 0,
            height: 0,
            tile_passability: VIEWPORT_TILE_PASSABILITY,
            map_data: [],
            player_state: player_state,
            warps: [],
            npcs: [],
            connections: [], // No connections if viewport is invalid
        };
    }

    // --- Filter Warps and Create Lookup Set ---
    const trimmedWarps = [];
    const warpLocations = new Set(); // "x,y"

    for (const warp of fullWarps) {
        if (warp?.position?.length === 2) {
            const [warpX, warpY] = warp.position;
            if (warpX >= actualStartX && warpX < actualEndX &&
                warpY >= actualStartY && warpY < actualEndY)
            {
                trimmedWarps.push({
                    position: [warpX, warpY],
                    destination: warp.destination || "Unknown Destination"
                });
                warpLocations.add(`${warpX},${warpY}`);
            }
        } else {
             console.warn("Skipping invalid warp object during trimming:", warp);
        }
    }

    // --- Filter NPCs and Create Lookup Set ---
    const trimmedNpcs = [];
    const npcLocations = new Set(); // "x,y"
    for (const npc of fullNpcs) {
        if (npc?.position?.length === 2) {
            const [npcX, npcY] = npc.position;
            if (!npc.isOffScreen)
            {
                trimmedNpcs.push({
                    id: npc.id,
                    position: [npcX, npcY],
                    type: npc.type, // Already formatted
                    wandering: npc.wandering
                });
                npcLocations.add(`${npcX},${npcY}`);
            }
        } else {
             console.warn("Skipping invalid NPC object during trimming:", npc);
        }
    }

    // --- Populate Trimmed Data (Marking Warps & NPCs) ---
    const trimmedMapData = [];
    for (let currentMapY = actualStartY; currentMapY < actualEndY; currentMapY++) {
        const row = [];
        const sourceRow = fullMapData[currentMapY];
        if (!sourceRow) {
             console.warn(`Missing expected row ${currentMapY} in fullMapData during trimming for ${map_name}.`);
             continue;
        }

        for (let currentMapX = actualStartX; currentMapX < actualEndX; currentMapX++) {
            let tileType = TILE_BLOCKED; // Default
            const coordString = `${currentMapX},${currentMapY}`;

            // Priority: Warp > NPC > Base Tile
            if (warpLocations.has(coordString)) {
                tileType = TILE_WARP;
            } else if (npcLocations.has(coordString)) {
                tileType = TILE_NPC;
            } else {
                const originalTileString = sourceRow[currentMapX];
                if (typeof originalTileString === 'string' && originalTileString.includes(':')) {
                    const typeFromData = originalTileString.split(':')[1]; // Get part after ':'
                    // Check if the typeFromData is a known base tile type (walkable, blocked, water, or any ledge)
                    if (BASE_TILE_PASSABILITY.hasOwnProperty(typeFromData)) {
                         tileType = typeFromData;
                    } else {
                         console.warn(`Unexpected base tile type '${typeFromData}' at (${currentMapX}, ${currentMapY}) for ${map_name}. Defaulting to '${TILE_BLOCKED}'.`);
                    }
                } else {
                    console.warn(`Missing or invalid base tile string at (${currentMapX}, ${currentMapY}) for ${map_name}. Defaulting to '${TILE_BLOCKED}'.`);
                }
            }
            row.push(`${coordString}:${tileType}`);
        }
        if (row.length > 0) {
            trimmedMapData.push(row);
        }
    }

    // --- Filter Connections by Viewport Edges ---
    const trimmedConnections = [];
    for (const conn of fullConnections) {
        let isVisible = false;
        switch (conn.direction) {
            case "down":
                isVisible = actualEndY === fullHeight;
                break;
            case "up":
                isVisible = actualStartY === 0;
                break;
            case "left":
                isVisible = actualStartX === 0;
                break;
            case "right":
                isVisible = actualEndX === fullWidth;
                break;
            default: // For connections like "dive", "emerge", or "unknown", assume they are always "visible" if present
                isVisible = true;
                break;
        }
        if (isVisible) {
            trimmedConnections.push(conn);
        }
    }

    // --- Assemble the Trimmed State Object ---
    return {
        map_name: map_name,
        width: fullWidth,
        height: fullHeight,
        tile_passability: VIEWPORT_TILE_PASSABILITY, // Use extended passability map
        map_data: trimmedMapData,     // Contains 'X'/'O'/'W'/'!' markers
        player_state: player_state,   // Absolute coords
        warps: trimmedWarps,          // Filtered, absolute coords
        npcs: trimmedNpcs,             // Filtered, absolute coords
        connections: trimmedConnections
    };
}

/**
 * Trims the full backup map state to a viewport centered around the player.
 * Coordinates in the output `map_data` are "unoffset" (can be negative).
 *
 * @param {object} fullBackupMapState - The backup map state from getBackupMapStateJson().
 * @returns {object|null} A new map state object for the viewport, or null if input is invalid.
 *          Output structure:
 *          {
 *              map_name: string, // Name of the main map + " (Extended Viewport)"
 *              width: number, // Width of the main map
 *              height: number, // Height of the main map
 *              tile_passability: VIEWPORT_TILE_PASSABILITY,
 *              map_data: string[][], // Viewport data, strings are "unoffsetX,unoffsetY:T" (T can be W, !, C) 
 *              player_state: { position: [number, number], facing: string},
 *              warps: Array<{ position: [number, number], destination: string }>, // Filtered warps
 *              npcs: Array<{ id: number, position: [number, number], type: string, isOffScreen: boolean, wandering: boolean }>, // Filtered NPCs
 *              connections: Array<{direction: string, mapName: string}> // Relevant connections for visible 'C' tiles
 *          }
 */
function trimBackupMapStateToViewport(fullBackupMapState) {
    if (!fullBackupMapState || !fullBackupMapState.map_data_raw || typeof fullBackupMapState.width !== 'number' || typeof fullBackupMapState.coord_offset_x !== 'number') {
        console.error("Invalid fullBackupMapState provided for trimming.", fullBackupMapState);
        return null;
    }

    const {
        map_name,
        width: backupPaddedWidth,   // Full width of the backup map (padded)
        height: backupPaddedHeight, // Full height of the backup map (padded)
        map_data_raw, // Raw data from backup map, indexed 0..N, tile strings "backupX,backupY:T"
        coord_offset_x,
        coord_offset_y,
        player_state,
        warps: fullWarps = [],      // Warps with unoffset/main-map coordinates
        npcs: fullNpcs = [],       // NPCs with unoffset coordinates
        all_connections: mainMapAllConnections = [], // All connections from the main map
        main_map_width,             // Actual width of the main map
        main_map_height             // Actual height of the main map
    } = fullBackupMapState;

    const [playerX, playerY] = player_state.position; // These are unoffset

    // Calculate viewport boundaries in *unoffset* coordinates
    const halfWidth = Math.floor(MAX_VIEWPORT_WIDTH / 2);
    const halfHeight = Math.floor(MAX_VIEWPORT_HEIGHT / 2);

    const viewStartXUnsafe = playerX - halfWidth;
    const viewStartYUnsafe = playerY - halfHeight;

    const trimmedMapData = [];

    
    // --- Create Lookup Sets for Warps and NPCs in unoffset coordinates ---
    const warpLocations = new Set(); // "unoffsetX,unoffsetY"
    const trimmedWarps = [];
    for (const warp of fullWarps) {
        if (warp?.position?.length === 2) {
            const [wx, wy] = warp.position; // These are already unoffset
            // Check if warp is within the *potential* viewport area before adding to set
            if (wx >= viewStartXUnsafe && wx < viewStartXUnsafe + MAX_VIEWPORT_WIDTH &&
                wy >= viewStartYUnsafe && wy < viewStartYUnsafe + MAX_VIEWPORT_HEIGHT) {
                warpLocations.add(`${wx},${wy}`);
                trimmedWarps.push(warp);
            }
        }
    }

    const npcLocations = new Set(); // "unoffsetX,unoffsetY"
    const trimmedNpcs = [];
    for (const npc of fullNpcs) {
        if (npc?.position?.length === 2 && !npc.isOffScreen) { // Consider only on-screen NPCs
            const [nx, ny] = npc.position; // Already unoffset
            // Check if NPC is within the *potential* viewport area
            if (nx >= viewStartXUnsafe && nx < viewStartXUnsafe + MAX_VIEWPORT_WIDTH &&
                ny >= viewStartYUnsafe && ny < viewStartYUnsafe + MAX_VIEWPORT_HEIGHT) {
                npcLocations.add(`${nx},${ny}`);
                trimmedNpcs.push(npc);
            }
        }
    }

    for (let i = 0; i < MAX_VIEWPORT_HEIGHT; i++) {
        const currentRow = [];
        const currentUnOffsetY = viewStartYUnsafe + i;

        for (let j = 0; j < MAX_VIEWPORT_WIDTH; j++) {
            const currentUnOffsetX = viewStartXUnsafe + j;

            // Convert unoffset viewport coordinates to backup map's internal grid coordinates
            const backupX = currentUnOffsetX + coord_offset_x;
            const backupY = currentUnOffsetY + coord_offset_y;

            let finalTileType;
            const unoffsetCoordString = `${currentUnOffsetX},${currentUnOffsetY}`;

            if (warpLocations.has(unoffsetCoordString)) {
                finalTileType = TILE_WARP;
            } else if (npcLocations.has(unoffsetCoordString)) {
                finalTileType = TILE_NPC;
            } else if (backupX >= 0 && backupX < backupPaddedWidth && backupY >= 0 && backupY < backupPaddedHeight) {
                const rawTileEntry = map_data_raw[backupY][backupX]; // e.g., "backupX,backupY:T"
                finalTileType = rawTileEntry.split(':')[1]; // This T can be O, X, C, or ledge/water
            } else {
                // This part of the viewport is outside the defined backup map area
                finalTileType = TILE_BLOCKED;
            }
            currentRow.push(`${currentUnOffsetX},${currentUnOffsetY}:${finalTileType}`);
        }
        trimmedMapData.push(currentRow);
    }

    // --- Determine visible connections based on 'C' tiles in viewport ---
    const visibleConnectionsOutput = [];
    const addedConnectionDestinations = new Set(); // To avoid duplicate connection entries if multiple 'C' tiles lead to same map

    for (const row of trimmedMapData) {
        for (const tileString of row) {
            const parts = tileString.split(':');
            const coords = parts[0].split(',').map(Number);
            const tileType = parts[1];
            const unOffsetX = coords[0];
            const unOffsetY = coords[1];

            if (tileType === TILE_CONNECTION) {
                let connectionDirections = [];
                // Check edges relative to the main map's footprint
                if (unOffsetX === -1 && unOffsetY >= -1 && unOffsetY <= main_map_height) connectionDirections.push("left");
                if (unOffsetX === main_map_width && unOffsetY >= -1 && unOffsetY <= main_map_height) connectionDirections.push("right");
                if (unOffsetY === -1 && unOffsetX >= -1 && unOffsetX <= main_map_width) connectionDirections.push("up");
                if (unOffsetY === main_map_height && unOffsetX >= -1 && unOffsetX <= main_map_width) connectionDirections.push("down");

                for (const dir of connectionDirections) {
                    for (const conn of mainMapAllConnections) {
                        if (conn.direction === dir) {
                            const connKey = `${conn.direction}_${conn.mapName}`;
                            if (!addedConnectionDestinations.has(connKey)) {
                                visibleConnectionsOutput.push(conn);
                                addedConnectionDestinations.add(connKey);
                            }
                        }
                    }
                }
            }
        }
    }    

    return {
        map_name: `${map_name} (Extended Viewport)`, // Main map's name + suffix
        width: main_map_width,    // Report main map's width
        height: main_map_height,  // Report main map's height
        tile_passability: VIEWPORT_TILE_PASSABILITY, // Use extended passability as map_data can have W, !, C        
        map_data: trimmedMapData, // Viewport data with unoffset coordinates
        player_state: player_state,
        warps: trimmedWarps,       // Filtered warps
        npcs: trimmedNpcs,        // Filtered NPCs
        connections: visibleConnectionsOutput // Relevant connections for visible 'C' tiles
    };
}

export async function getVisibleBackupMapStateJson() {
    try {
        const fullState = await getBackupMapStateJson();
        if (!fullState) {
            return null;
        }
        const trimmedState = trimBackupMapStateToViewport(fullState);
        if (!trimmedState) {
            console.error("Failed to trim backup map state to viewport.");
            return null;
        }
        return trimmedState;
    } catch (error) {
        console.error("Error getting visible backup map state:", error);
        return null;
    }
}

/**
 * Retrieves the current map state trimmed to a viewport around the player.
 * Warp locations within the viewport are marked as 'W' and NPC locations as '!'
 * in the map_data. Includes NPCs and Warps visible within the viewport.
 *
 * @returns {Promise<object|null>} A promise that resolves to an object containing
 *          the map name, dimensions, collision data (including 'W'/'!' markers),
 *          player state, filtered warp points, and filtered NPCs, trimmed to a
 *          viewport (max 15x10) centered around the player.
 *          Also includes map connections visible from the viewport edges. Coordinates remain
 *          *absolute*. Returns null if a critical error occurs.
 */
export async function getVisibleMapStateJson() {
    try {
        const fullState = await getMapStateJson();
        if (!fullState) {
            // Error logged in getMapStateJson
            return null;
        }

        const trimmedState = trimMapStateToViewport(fullState);
        if (!trimmedState) {
             // Error logged in trimMapStateToViewport
             console.error("Failed to trim map state to viewport.");
             return null;
        }

        return trimmedState;

    } catch (error) {
        console.error("Error getting visible map state:", error);
        return null;
    }
}

/**
 * Validates a given navigation path against the provided map state.
 * Checks for out-of-bounds coordinates and non-walkable tiles ('O' is walkable).
 *
 * @param {Array<[number, number]>} path - An array of [x, y] coordinates representing the path.
 * @param {object} mapState - The map state object, typically from getVisibleMapStateJson() or getVisibleBackupMapStateJson().
 *                            This object contains map_data (viewport) and viewport width/height.
 *                            The full map dimensions are implicitly handled by the viewport calculation.
 * @returns {Promise<{isValid: boolean, failurePoint?: [number, number], reason?: string}>}
 *          An object indicating if the path is valid. If invalid, includes
 *          the point of failure and a reason.
 */
export async function validatePath(path, mapState) {
    if (!path || path.length === 0) {
        return { isValid: true, reason: "Empty path is trivially valid." };
    }

    // It's crucial that mapState here is the *trimmed* viewport state,
    // because map_data in it reflects the viewport's content and coordinates.
    // The width/height in mapState should be the viewport's width/height.
    // The tile strings "x,y:T" within map_data use *absolute* map coordinates (unoffset for backup map).
    if (!mapState || !mapState.map_data || typeof mapState.width !== 'number' || typeof mapState.height !== 'number' || !mapState.player_state) {
        console.warn("validatePath: Invalid mapState provided (must be trimmed viewport state).", mapState);
        return { isValid: false, reason: "Invalid map state provided for validation (expecting trimmed viewport state)." };
    }

    if (!mapState || !mapState.map_data || typeof mapState.width !== 'number' || typeof mapState.height !== 'number') {
        console.warn("validatePath: Invalid mapState provided.", mapState);
        return { isValid: false, reason: "Invalid map state provided for validation." };
    }

    const { map_data: viewportMapData, width: viewportWidth, height: viewportHeight, player_state } = mapState;
    const [playerStartX, playerStartY] = player_state.position;

    // Initialize previous coordinates with the player's starting position
    let prevX = playerStartX;
    let prevY = playerStartY;

    // Determine the absolute coordinate bounds of the current viewport
    // This requires knowing the top-left absolute coordinate of the viewport.
    // We can infer this if map_data is not empty.
    let viewportAbsStartX = 0;
    let viewportAbsStartY = 0;
    if (viewportMapData.length > 0 && viewportMapData[0].length > 0 && viewportMapData[0][0].includes(',')) {
        [viewportAbsStartX, viewportAbsStartY] = viewportMapData[0][0].split(':')[0].split(',').map(Number);
    }

    for (let i = 0; i < path.length; i++) {
        const [pX, pY] = path[i];

        // 0. Adjacency Check (Manhattan distance must be 1)
        const deltaX = Math.abs(pX - prevX);
        const deltaY = Math.abs(pY - prevY);

        if (deltaX + deltaY !== 1) {
            const previousPointDisplay = i === 0 ? `player start (${prevX},${prevY})` : `previous step (${prevX},${prevY})`;
            return {
                isValid: false,
                failurePoint: [pX, pY],
                reason: `Step (${pX},${pY}) is not adjacent to ${previousPointDisplay}. Distance: dx=${deltaX}, dy=${deltaY}.`
            };
        }

        // 2. Find the tile in the viewportMapData (which uses absolute/unoffset coordinates in its strings)
        let tileFound = false;
        let tileType = '';

        // The viewportMapData is a 2D array where each element is "x,y:T".
        // The x,y in the string are the actual coordinates for that tile.
        // The array indices of viewportMapData are 0..MAX_VIEWPORT_HEIGHT-1 and 0..MAX_VIEWPORT_WIDTH-1.
        // We need to find the tile string that corresponds to pX, pY.
        // The viewport's top-left unoffset coordinate is (viewportAbsStartX, viewportAbsStartY).
        const viewLocalX = pX - viewportAbsStartX;
        const viewLocalY = pY - viewportAbsStartY;

        if (viewLocalY >= 0 && viewLocalY < viewportMapData.length &&
            viewLocalX >= 0 && viewLocalX < viewportMapData[viewLocalY].length) {
            const tileString = viewportMapData[viewLocalY][viewLocalX];
            // Double check the coordinate in the string matches, though it should if viewport is constructed correctly.
            const parts = tileString.split(':');
            const coordsInString = parts[0].split(',').map(Number);
            if (coordsInString[0] === pX && coordsInString[1] === pY) {
                tileType = parts[1];
                tileFound = true;
            } else {
                // This would indicate an issue with viewport construction or path coordinates
                console.warn(`Path validation coordinate mismatch: searching for (${pX},${pY}), found tile string "${tileString}" at viewport local [${viewLocalY}][${viewLocalX}].`);
            }
        }

        if (!tileFound) {
            return { isValid: false, failurePoint: [pX, pY], reason: `Coordinate (${pX},${pY}) not found in current visible map data (viewport).` };
        }

        if (tileType === TILE_BLOCKED || tileType === TILE_NPC) { // TILE_NPC check is for main map, harmless for backup
            return { isValid: false, failurePoint: [pX, pY], reason: `Tile (${pX},${pY}) is not walkable. Type: '${tileType}'.` };
        }

        if (tileType === TILE_WATER && !(await isPlayerSurfing())) {
            return { isValid: false, failurePoint: [pX, pY], reason: `Tile (${pX},${pY}) is a water tile (~), and the player is not surfing.` }
        }

        // 3. Ledge Check (if applicable)
        const actualDeltaX = pX - prevX;
        const actualDeltaY = pY - prevY;

        if (tileType === TILE_LEDGE_EAST && actualDeltaX !== 1) {
            return { isValid: false, failurePoint: [pX, pY], reason: `Cannot traverse East-facing ledge (${pX},${pY}) when not moving East. Actual move: dx=${actualDeltaX}, dy=${actualDeltaY}.` };
        }
        if (tileType === TILE_LEDGE_WEST && actualDeltaX !== -1) {
            return { isValid: false, failurePoint: [pX, pY], reason: `Cannot traverse West-facing ledge (${pX},${pY}) when not moving West. Actual move: dx=${actualDeltaX}, dy=${actualDeltaY}.` };
        }
        if (tileType === TILE_LEDGE_NORTH && actualDeltaY !== -1) {
            return { isValid: false, failurePoint: [pX, pY], reason: `Cannot traverse North-facing ledge (${pX},${pY}) when not moving North. Actual move: dx=${actualDeltaX}, dy=${actualDeltaY}.` };
        }
        if (tileType === TILE_LEDGE_SOUTH && actualDeltaY !== 1) {
            return { isValid: false, failurePoint: [pX, pY], reason: `Cannot traverse South-facing ledge (${pX},${pY}) when not moving South. Actual move: dx=${actualDeltaX}, dy=${actualDeltaY}.` };
        }

        prevX = pX;
        prevY = pY;
    }

    return { isValid: true };
}