import * as CONSTANTS from "../constant/constants.js";
import { getMetatileBehaviorName, WATER_TILES, LEDGE_DIRECTIONS, BRIDGE_WATER_TILES, BRIDGE_BLOCKED_TILES } from "../../constant/metatile_behaviors_map.js";
import { getPlayerElevation } from "./playerData.js";

/**
 * Processes raw map tile byte data into a structured map object with coordinate-based tile strings.
 *
 * @param {number[]} tileGridData - Array of u16 values, where each value represents a map tile's full data.
 * @param {number} mapWidthTiles - The width of the map in tiles.
 * @param {number[]} allMetatileBehaviors - Array of behavior bytes for all metatiles.
 * @param {number} playerElevation - The player's current elevation.
 * @returns {{width: number, height: number, tile_passability: object, map_data: string[][]}|null}
 */
export async function processMemoryDataToCollisionMap(tileGridData, mapWidthTiles, allMetatileBehaviors, playerElevation) {
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
        return null;
    }

    const numTiles = tileGridData.length;

    if (numTiles === 0 && mapWidthTiles > 0) {
        return {
            width: mapWidthTiles,
            height: 0,
            tile_passability: CONSTANTS.BASE_TILE_PASSABILITY,
            map_data: []
        };
    }

    const mapHeightTiles = Math.ceil(numTiles / mapWidthTiles);
    const mapDataStrings = [];
    let tileIndex = 0;

    for (let y = 0; y < mapHeightTiles; y++) {
        const row = [];
        for (let x = 0; x < mapWidthTiles; x++) {
            if (tileIndex < numTiles) {
                const tileValue = tileGridData[tileIndex];
                let tileType;

                if (tileValue === CONSTANTS.MAPGRID_UNDEFINED) {
                    tileType = CONSTANTS.TILE_BLOCKED;
                } else {
                    const metatileId = tileValue & CONSTANTS.MAPGRID_METATILE_ID_MASK;
                    const behaviorByte = allMetatileBehaviors[metatileId];
                    const behaviorName = getMetatileBehaviorName(behaviorByte);
                    const ledgeChar = behaviorName ? LEDGE_DIRECTIONS.get(behaviorName) : undefined;

                    if (ledgeChar) {
                        tileType = ledgeChar;
                    } else if (behaviorName && WATER_TILES.has(behaviorName)) {
                        tileType = CONSTANTS.TILE_WATER;
                    } else {
                        const collisionBits = (tileValue & CONSTANTS.MAPGRID_COLLISION_MASK) >> 10;
                        tileType = (collisionBits === 0) ? CONSTANTS.TILE_WALKABLE : CONSTANTS.TILE_BLOCKED;
                    }
                }
                row.push(`${x},${y}:${tileType}`);
                tileIndex++;
            } else {
                console.warn(`Warning: Unexpectedly ran out of tile data at index ${tileIndex} while processing (${x}, ${y}).`);
                break;
            }
        }
        if (row.length > 0) {
            mapDataStrings.push(row);
        }
        if (tileIndex >= numTiles) {
            break;
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
        tile_passability: CONSTANTS.BASE_TILE_PASSABILITY,
        map_data: mapDataStrings
    };
}