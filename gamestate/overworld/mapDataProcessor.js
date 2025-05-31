import * as CONSTANTS from "../constant/constants.js";
import { getMetatileBehaviorName, LEDGE_DIRECTIONS, WATERFALL_TILE, DIVE_TILES } from "../../constant/metatile_behaviors_map.js";
import { getPlayerElevation, isPlayerSurfing } from "./playerData.js";

/**
 * Processes raw map tile byte data into a structured map object with coordinate-based tile strings.
 * Implements new elevation passability rules.
 *
 * @param {number[]} tileGridData - Array of u16 values, where each value represents a map tile's full data.
 * @param {number} mapWidthTiles - The width of the map in tiles.
 * @param {number[]} allMetatileBehaviors - Array of behavior bytes for all metatiles.
 * @returns {{width: number, height: number, tile_passability: object, map_data: string[][]}|null}
 */
export async function processMemoryDataToCollisionMap(tileGridData, mapWidthTiles, allMetatileBehaviors) {
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

    const playerElevation = await getPlayerElevation();
    const playerSurfing = await isPlayerSurfing();
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
    
    // --- First Pass: Collect raw tile data and identify special properties ---
    const intermediateTileInfo = []; // Stores {originalElevation, behaviorName, collisionBits, metatileId, isWater, isTransition, isBridge (is elev 15)}
    let tempTileIndex = 0;
    for (let y = 0; y < mapHeightTiles; y++) {
        const rowInfo = [];
        for (let x = 0; x < mapWidthTiles; x++) {
            if (tempTileIndex < numTiles) {
                const tileValue = tileGridData[tempTileIndex];
                const collisionBits = (tileValue & CONSTANTS.MAPGRID_COLLISION_MASK) >> 10;
                let tileElevation = (tileValue & CONSTANTS.MAPGRID_ELEVATION_MASK) >> 12;
                const metatileId = tileValue & CONSTANTS.MAPGRID_METATILE_ID_MASK;
                
                let behaviorName = '';
                if (metatileId < allMetatileBehaviors.length) {
                    const behaviorByte = allMetatileBehaviors[metatileId];
                    behaviorName = getMetatileBehaviorName(behaviorByte);
                } else {
                    console.warn(`Metatile ID ${metatileId} out of bounds for allMetatileBehaviors array (length ${allMetatileBehaviors.length}) at ${x},${y}.`);
                }

                // Treat bridge tiles (elevation 15) as being at the player's elevation.
                // This may cause them to become water or transition tiles, which is fine.
                if (tileElevation === 15) tileElevation = playerElevation;

                const isUndefinedTile = (tileValue === CONSTANTS.MAPGRID_UNDEFINED);
                const isWaterTile = (tileElevation === 1);
                const isTransitionTile = (tileElevation === 0);

                rowInfo.push({
                    x, y,
                    originalElevation: tileElevation,
                    behaviorName: behaviorName || '', 
                    collisionBits,
                    metatileId,
                    isWater: isWaterTile,
                    isTransition: isTransitionTile,
                    isUndefined: isUndefinedTile,
                });
                tempTileIndex++;
            } else {
                rowInfo.push(null); 
                console.warn(`Warning: Ran out of tile data at index ${tempTileIndex} while expecting tile for (${x}, ${y}).`);
            }
        }
        intermediateTileInfo.push(rowInfo);
    }

    // --- Second Pass: Determine final passability using intermediateTileInfo ---
    const mapDataStrings = [];
    for (let y = 0; y < mapHeightTiles; y++) {
        const rowStrings = [];
        for (let x = 0; x < mapWidthTiles; x++) {
            const currentTileProcessedInfo = intermediateTileInfo[y][x];

            if (!currentTileProcessedInfo) {
                rowStrings.push(`${x},${y}:${CONSTANTS.TILE_BLOCKED}`);
                continue;
            }

            let tileType;
            const { originalElevation, behaviorName, collisionBits, isWater, isTransition, isUndefined } = currentTileProcessedInfo;
            const ledgeChar = behaviorName ? LEDGE_DIRECTIONS.get(behaviorName) : undefined;

            // Rule: Tiles blocked by raw collision bits
            if (collisionBits !== 0) {
                tileType = CONSTANTS.TILE_BLOCKED;
            // Rule: Undefined (border) tiles
            } else if (isUndefined) {
                tileType = CONSTANTS.TILE_BLOCKED;
            // Rule: Water tiles
            } else if (isWater) {
                tileType = CONSTANTS.TILE_WATER;
            // Rule: Waterfall tiles
            } else if (behaviorName === WATERFALL_TILE) {
                tileType = CONSTANTS.TILE_WATERFALL;
            // Rule: Dive tiles
            } else if (DIVE_TILES.has(behaviorName)) {
                tileType = CONSTANTS.TILE_DIVE;
            // Rule: Transition tiles are walkable (original rule 3)
            } else if (isTransition) {
                tileType = CONSTANTS.TILE_WALKABLE;
            }
            // Rule: Tiles at the same elevation as the player are walkable (original rule 1)
            else if (originalElevation === playerElevation) {
                tileType = CONSTANTS.TILE_WALKABLE;
            }
            // Rule: Tiles at elevation 3 are walkable if the player is surfing
            else if (originalElevation === 3 && playerSurfing) {
                tileType = CONSTANTS.TILE_WALKABLE;
            }
            // Rule: Higher/lower elevation tiles (original rule 2)
            else { // Tile is at a different elevation, not water, not transition, not bridge (elev 15), not collision-blocked
                let isAdjacentToPlayerElevationWalkableGround = false;
                const directions = [[0, -1], [0, 1], [-1, 0], [1, 0]]; // N, S, W, E

                for (const [dx, dy] of directions) {
                    const nx = x + dx;
                    const ny = y + dy;

                    if (nx >= 0 && nx < mapWidthTiles && ny >= 0 && ny < mapHeightTiles) {
                        const neighborInfo = intermediateTileInfo[ny][nx];
                        if (neighborInfo) {
                            // Check if this neighbor is at player's elevation AND is a walkable ground-type tile
                            if (neighborInfo.originalElevation === playerElevation &&
                                !neighborInfo.isWater && // Neighbor itself is not water
                                neighborInfo.collisionBits === 0) { // Neighbor itself is not blocked by its own collision bits
                                isAdjacentToPlayerElevationWalkableGround = true;
                                break;
                            }
                        }
                    }
                }

                if (isAdjacentToPlayerElevationWalkableGround) {
                    tileType = CONSTANTS.TILE_BLOCKED;
                } else {
                    tileType = CONSTANTS.TILE_WALKABLE; 
                }
            }

            // Ledges override other passable types (final override)
            if (ledgeChar) {
                tileType = ledgeChar;
            }
            
            rowStrings.push(`${x},${y}:${tileType}`);
        }
        if (rowStrings.length > 0) {
            mapDataStrings.push(rowStrings);
        }
    }
    
    const actualHeight = mapDataStrings.length;
    const actualWidth = mapWidthTiles;

    if (actualHeight > 0 && actualHeight * mapWidthTiles < numTiles && tempTileIndex < numTiles) {
        console.warn(`Processed map dimensions (${actualWidth}x${actualHeight}) might not cover all tile data. ${numTiles - tempTileIndex} tiles remaining.`);
    } else if (actualHeight > 0 && mapDataStrings[actualHeight-1]?.length < mapWidthTiles) {
         console.warn(`Processed map dimensions (${actualWidth}x${actualHeight}). Last row might be incomplete.`);
    }

    return {
        width: actualWidth,
        height: actualHeight,
        tile_passability: CONSTANTS.BASE_TILE_PASSABILITY,
        map_data: mapDataStrings
    };
}