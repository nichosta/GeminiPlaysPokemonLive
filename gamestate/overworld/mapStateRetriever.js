import { getCurrentMapBank, getCurrentMapNumber, getPlayerPosition, getPlayerFacingDirection, getPlayerElevation } from "./playerData.js";
import { getCurrentMapWarps, getCurrentMapNpcs } from "./mapEvents.js";
import { getMainMapHeight, getMainMapTiles, getMainMapWidth, getBackupMapWidth, getBackupMapHeight, getBackupMapTiles, getMainMapLayoutBaseAddress } from "./mapLayouts.js";
import { getCurrentMapConnections } from "./mapConnections.js";
import { getMainMapMetatileBehaviors, getBackupMapMetatileBehaviors } from "./mapMetatiles.js";
import { getMapName } from "../../constant/map_map.js";
import { getEventObjectName } from "../../constant/event_object_map.js";
import * as CONSTANTS from "../constant/constants.js";
import { processMemoryDataToCollisionMap } from "./mapDataProcessor.js";
import { findRelevantConnectionForCoordinate } from "./mapConnectionUtils.js";
import { getMetatileBehaviorName, WARP_METATILES, WARP_DIRECTIONS } from "../../constant/metatile_behaviors_map.js";

/**
 * Retrieves the complete current map state in a structured JSON format.
 * @returns {Promise<object|null>}
 */
export async function getMapStateJson() {
    try {
        const mapBank = await getCurrentMapBank();
        const mapNumber = await getCurrentMapNumber();
        const [playerX, playerY] = await getPlayerPosition();
        const facingDirection = await getPlayerFacingDirection();
        const playerElevation = await getPlayerElevation();
        const rawWarpsOriginal = await getCurrentMapWarps();
        const rawNpcs = await getCurrentMapNpcs();
        const mapWidth = await getMainMapWidth();
        const mapHeight = await getMainMapHeight();
        const mapConnections = await getCurrentMapConnections();
        const allMetatileBehaviors = await getMainMapMetatileBehaviors();
        const mapTiles = await getMainMapTiles(mapWidth, mapHeight);

        const mapName = getMapName(mapBank, mapNumber);

        if (mapWidth <= 0 || mapHeight <= 0) {
            console.warn(`Invalid map dimensions fetched: ${mapWidth}x${mapHeight} for ${mapName}. Returning minimal state.`);
            return {
                map_name: mapName,
                width: 0,
                height: 0,
                tile_passability: CONSTANTS.BASE_TILE_PASSABILITY,
                map_data: [],
                player_state: { position: [playerX, playerY], facing: facingDirection },
                warps: [],
                npcs: [],
                connections: mapConnections || [],
            };
        }

        if (!allMetatileBehaviors) {
            console.warn(`Failed to fetch metatile behaviors for ${mapName}. Collision map might be inaccurate, and warp validation might be affected.`);
        }
        if (!mapTiles || mapTiles.length !== mapWidth * mapHeight) {
            console.warn(`Failed to fetch main map tiles or tile count mismatch for ${mapName}. Warp validation might be affected.`);
        }

        const collisionData = await processMemoryDataToCollisionMap(mapTiles || [], mapWidth, allMetatileBehaviors || [], playerElevation);

        if (!collisionData) {
            console.error(`Failed to process map tiles into collision data for ${mapName}.`);
            return null;
        }

        const processedWarps = [];
        for (const rawWarp of rawWarpsOriginal) {
            let { x: currentWarpX, y: currentWarpY, destMapNum, destMapGroup } = rawWarp;
            let effectiveWarpX = currentWarpX; // Actual tile player steps on
            let effectiveWarpY = currentWarpY;

            if (currentWarpX >= 0 && currentWarpX < mapWidth && currentWarpY >= 0 && currentWarpY < mapHeight &&
                mapTiles && allMetatileBehaviors && mapTiles.length > currentWarpY * mapWidth + currentWarpX &&
                allMetatileBehaviors.length > (mapTiles[currentWarpY * mapWidth + currentWarpX] & CONSTANTS.MAPGRID_METATILE_ID_MASK)) {
                const tileValue = mapTiles[currentWarpY * mapWidth + currentWarpX];
                const metatileId = tileValue & CONSTANTS.MAPGRID_METATILE_ID_MASK;
                const behaviorByte = allMetatileBehaviors[metatileId];
                const behaviorName = getMetatileBehaviorName(behaviorByte);

                if (!behaviorName || !WARP_METATILES.has(behaviorName)) {
                    continue;
                }

                // Calculate effective (actual trigger) warp position
                if (WARP_DIRECTIONS.has(behaviorName)) {
                    const direction = WARP_DIRECTIONS.get(behaviorName);
                    if (direction === '→') effectiveWarpX += 1;
                    else if (direction === '←') effectiveWarpX -= 1;
                    else if (direction === '↑') effectiveWarpY -= 1;
                    else if (direction === '↓') effectiveWarpY += 1;
                }
            } else {
                // Original warp location is not on the main map, or essential data missing.
                continue;
            }

            // Check if NPC blocks the *effective* (actual trigger) warp tile
            const isBlockedByNpc = rawNpcs.some(npc => npc.x === effectiveWarpX && npc.y === effectiveWarpY && !npc.isOffScreen);
            if (isBlockedByNpc) {
                // If the actual trigger tile is blocked, the warp is unusable.
                continue;
            }

            // Determine the position to store in the main map state (for minimap display)
            let displayWarpX, displayWarpY;
            const effectiveIsOffMainMap = effectiveWarpX < 0 || effectiveWarpX >= mapWidth || effectiveWarpY < 0 || effectiveWarpY >= mapHeight;
            // currentWarpX/Y (original position) is known to be on the main map if we reached this point.

            if (effectiveIsOffMainMap) {
                // Effective warp is off-map. For minimap, display at original location.
                displayWarpX = currentWarpX;
                displayWarpY = currentWarpY;
            } else {
                // Effective warp is on-map. Display it at its effective location.
                displayWarpX = effectiveWarpX;
                displayWarpY = effectiveWarpY;
            }

            processedWarps.push({
                position: [displayWarpX, displayWarpY],
                destination: getMapName(destMapGroup, destMapNum) || `Unknown Map (${destMapGroup}-${destMapNum})`
            });
        }
        const warps = processedWarps;

        const npcs = rawNpcs
            .filter(npc => npc.x >= 0 && npc.x < collisionData.width && npc.y >= 0 && npc.y < collisionData.height)
            .map(npc => ({
                id: npc.id,
                position: [npc.x, npc.y],
                type: getEventObjectName(npc.graphicsId) || `Unknown NPC (ID: ${npc.graphicsId})`,
                isOffScreen: npc.isOffScreen,
                wandering: npc.wandering,
            }));

        return {
            map_name: mapName,
            width: collisionData.width,
            height: collisionData.height,
            tile_passability: collisionData.tile_passability,
            map_data: collisionData.map_data,
            player_state: { position: [playerX, playerY], facing: facingDirection },
            warps: warps,
            npcs: npcs,
            connections: mapConnections || [],
        };

    } catch (error) {
        console.error("Error getting complete map state:", error);
        return null;
    }
}

/**
 * Retrieves the complete backup map state in a structured JSON format.
 * Warps are processed based on backup map metatiles but their coordinates remain relative to the main map.
 * @returns {Promise<object|null>}
 */
export async function getBackupMapStateJson() {
    try {
        const [playerX, playerY] = await getPlayerPosition();
        const facingDirection = await getPlayerFacingDirection();
        const playerElevation = await getPlayerElevation();
        const currentMapBank = await getCurrentMapBank();
        const currentMapNumber = await getCurrentMapNumber();
        const currentMapName = getMapName(currentMapBank, currentMapNumber) || "Unknown Main Map";

        const backupMapWidth = await getBackupMapWidth();
        const backupMapHeight = await getBackupMapHeight();
        const backupMetatileBehaviors = await getBackupMapMetatileBehaviors();
        const backupMapTiles = await getBackupMapTiles(backupMapWidth, backupMapHeight);

        const mainMapWidth = await getMainMapWidth();
        const mainMapHeight = await getMainMapHeight();
        const mainMapConnections = await getCurrentMapConnections();
        const internalBackupMapName = "Backup Map View";

        // Access CONSTANTS.MAP_OFFSET directly inside the function
        const local_coord_offset_x = CONSTANTS.MAP_OFFSET;
        const local_coord_offset_y = CONSTANTS.MAP_OFFSET;


        if (backupMapWidth <= 0 || backupMapHeight <= 0) {
            console.warn(`Invalid backup map dimensions fetched: ${backupMapWidth}x${backupMapHeight}. Returning minimal state.`);
            return {
                map_name: currentMapName,
                width: 0,
                height: 0,
                tile_passability: CONSTANTS.VIEWPORT_TILE_PASSABILITY,
                map_data_raw: [],
                coord_offset_x: local_coord_offset_x, // Use local variable
                coord_offset_y: local_coord_offset_y, // Use local variable
                player_state: { position: [playerX, playerY], facing: facingDirection },
                warps: [],
                npcs: [],
                all_connections: mainMapConnections || [],
                main_map_width: mainMapWidth || 0,
                main_map_height: mainMapHeight || 0,
            };
        }

        if (!backupMetatileBehaviors) {
            console.warn(`Failed to fetch metatile behaviors for ${internalBackupMapName}. Collision map and warp validation might be inaccurate.`);
        }
        if (!backupMapTiles || backupMapTiles.length !== backupMapWidth * backupMapHeight) {
            console.warn(`Failed to fetch backup map tiles or tile count mismatch for ${internalBackupMapName}. Warp validation might be affected.`);
        }

        const collisionData = await processMemoryDataToCollisionMap(backupMapTiles || [], backupMapWidth, backupMetatileBehaviors || [], playerElevation);

        if (!collisionData) {
            console.error(`Failed to process backup map tiles into collision data for ${internalBackupMapName}.`);
            return null;
        }

        const isConnectableTileType = (tileType) => tileType !== CONSTANTS.TILE_BLOCKED && tileType !== CONSTANTS.TILE_NPC && tileType !== CONSTANTS.TILE_WARP;
        if (mainMapWidth > 0 && mainMapHeight > 0 && mainMapConnections) {
            for (let by = 0; by < collisionData.height; by++) {
                for (let bx = 0; bx < collisionData.width; bx++) {
                    const tileString = collisionData.map_data[by][bx];
                    const originalTileType = tileString.split(':')[1];
                    if (!isConnectableTileType(originalTileType)) {
                        continue;
                    }

                    let markAsConnection = false;
                    const mainMapEquivTileX = bx - local_coord_offset_x; // Use local variable
                    const mainMapEquivTileY = by - local_coord_offset_y; // Use local variable

                    if (bx === local_coord_offset_x - 1 && (mainMapEquivTileY >= 0 && mainMapEquivTileY < mainMapHeight)) {
                        const conn = findRelevantConnectionForCoordinate(mainMapConnections, "left", mainMapEquivTileY);
                        if (conn && conn.mapName !== "MAP_NONE" && collisionData.map_data[by]?.[bx + 1]?.split(':')[1] && isConnectableTileType(collisionData.map_data[by][bx + 1].split(':')[1])) markAsConnection = true;
                    }
                    if (!markAsConnection && bx === local_coord_offset_x + mainMapWidth && (mainMapEquivTileY >= 0 && mainMapEquivTileY < mainMapHeight)) {
                        const conn = findRelevantConnectionForCoordinate(mainMapConnections, "right", mainMapEquivTileY);
                        if (conn && conn.mapName !== "MAP_NONE" && collisionData.map_data[by]?.[bx - 1]?.split(':')[1] && isConnectableTileType(collisionData.map_data[by][bx - 1].split(':')[1])) markAsConnection = true;
                    }
                    if (!markAsConnection && by === local_coord_offset_y - 1 && (mainMapEquivTileX >= 0 && mainMapEquivTileX < mainMapWidth)) {
                        const conn = findRelevantConnectionForCoordinate(mainMapConnections, "up", mainMapEquivTileX);
                        if (conn && conn.mapName !== "MAP_NONE" && collisionData.map_data[by + 1]?.[bx]?.split(':')[1] && isConnectableTileType(collisionData.map_data[by + 1][bx].split(':')[1])) markAsConnection = true;
                    }
                    if (!markAsConnection && by === local_coord_offset_y + mainMapHeight && (mainMapEquivTileX >= 0 && mainMapEquivTileX < mainMapWidth)) {
                        const conn = findRelevantConnectionForCoordinate(mainMapConnections, "down", mainMapEquivTileX);
                        if (conn && conn.mapName !== "MAP_NONE" && collisionData.map_data[by - 1]?.[bx]?.split(':')[1] && isConnectableTileType(collisionData.map_data[by - 1][bx].split(':')[1])) markAsConnection = true;
                    }

                    if (markAsConnection) {
                        collisionData.map_data[by][bx] = `${bx},${by}:${CONSTANTS.TILE_CONNECTION}`;
                    }
                }
            }
        }

        const rawWarpsOriginal = await getCurrentMapWarps();
        const rawNpcs = await getCurrentMapNpcs();

        const processedWarps = [];
        for (const rawWarp of rawWarpsOriginal) {
            let { x: mainMapWarpX, y: mainMapWarpY, destMapNum, destMapGroup } = rawWarp;
            let adjustedMainMapWarpX = mainMapWarpX;
            let adjustedMainMapWarpY = mainMapWarpY;

            const backupWarpTileX = mainMapWarpX + local_coord_offset_x; // Use local variable
            const backupWarpTileY = mainMapWarpY + local_coord_offset_y; // Use local variable

            if (backupWarpTileX >= 0 && backupWarpTileX < backupMapWidth && backupWarpTileY >= 0 && backupWarpTileY < backupMapHeight &&
                backupMapTiles && backupMetatileBehaviors && backupMapTiles.length > backupWarpTileY * backupMapWidth + backupWarpTileX &&
                backupMetatileBehaviors.length > (backupMapTiles[backupWarpTileY * backupMapWidth + backupWarpTileX] & CONSTANTS.MAPGRID_METATILE_ID_MASK)) {

                const tileValue = backupMapTiles[backupWarpTileY * backupMapWidth + backupWarpTileX];
                const metatileId = tileValue & CONSTANTS.MAPGRID_METATILE_ID_MASK;
                const behaviorByte = backupMetatileBehaviors[metatileId];
                const behaviorName = getMetatileBehaviorName(behaviorByte);

                if (!behaviorName || !WARP_METATILES.has(behaviorName)) {
                    continue;
                }

                if (WARP_DIRECTIONS.has(behaviorName)) {
                    const direction = WARP_DIRECTIONS.get(behaviorName);
                    if (direction === '→') adjustedMainMapWarpX += 1;
                    else if (direction === '←') adjustedMainMapWarpX -= 1;
                    else if (direction === '↑') adjustedMainMapWarpY -= 1;
                    else if (direction === '↓') adjustedMainMapWarpY += 1;
                }
            } else {
                continue;
            }

            const isBlockedByNpc = rawNpcs.some(npc => npc.x === adjustedMainMapWarpX && npc.y === adjustedMainMapWarpY && !npc.isOffScreen);
            if (isBlockedByNpc) {
                continue;
            }

            processedWarps.push({
                position: [adjustedMainMapWarpX, adjustedMainMapWarpY],
                destination: getMapName(destMapGroup, destMapNum) || `Unknown Map (${destMapGroup}-${destMapNum})`
            });
        }
        const warps = processedWarps;

        const npcs = rawNpcs.map(npc => ({
            id: npc.id,
            position: [npc.x, npc.y],
            type: getEventObjectName(npc.graphicsId) || `Unknown NPC (ID: ${npc.graphicsId})`,
            isOffScreen: npc.isOffScreen,
            wandering: npc.wandering,
        }));

        return {
            map_name: currentMapName,
            width: collisionData.width,
            height: collisionData.height,
            tile_passability: CONSTANTS.VIEWPORT_TILE_PASSABILITY,
            map_data_raw: collisionData.map_data,
            coord_offset_x: local_coord_offset_x, // Use local variable
            coord_offset_y: local_coord_offset_y, // Use local variable
            player_state: { position: [playerX, playerY], facing: facingDirection },
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
