import { getCurrentMapBank, getCurrentMapNumber, getPlayerPosition, getPlayerFacingDirection } from "./playerData.js";
import { getCurrentMapWarps, getCurrentMapNpcs } from "./mapEvents.js";
import { getMainMapHeight, getMainMapTiles, getMainMapWidth, getBackupMapWidth, getBackupMapHeight, getBackupMapTiles } from "./mapLayouts.js";
import { getCurrentMapConnections } from "./mapConnections.js";
import { getMainMapMetatileBehaviors, getBackupMapMetatileBehaviors } from "./mapMetatiles.js";
import { getMapName } from "../../constant/map_map.js";
import { getEventObjectName } from "../../constant/event_object_map.js";
import * as CONSTANTS from "../constant/constants.js";
import { processMemoryDataToCollisionMap } from "./mapDataProcessor.js";
import { findRelevantConnectionForCoordinate } from "./mapConnectionUtils.js";

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
        const rawWarps = await getCurrentMapWarps();
        const rawNpcs = await getCurrentMapNpcs();
        const mapWidth = await getMainMapWidth();
        const mapHeight = await getMainMapHeight();
        const mapConnections = await getCurrentMapConnections();
        const allMetatileBehaviors = await getMainMapMetatileBehaviors();

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
            console.error(`Failed to fetch metatile behaviors for ${mapName}. Collision map might be inaccurate.`);
            // Proceed, but collision map will only use collision bits.
        }

        const mapTiles = await getMainMapTiles(mapWidth, mapHeight);
        const collisionData = await processMemoryDataToCollisionMap(mapTiles, mapWidth, allMetatileBehaviors || []);

        if (!collisionData) {
            console.error(`Failed to process map tiles into collision data for ${mapName}.`);
            return null;
        }

        const warps = rawWarps
            .filter(warp => warp.x >= 0 && warp.x < collisionData.width && warp.y >= 0 && warp.y < collisionData.height)
            .map(warp => ({
                position: [warp.x, warp.y],
                destination: getMapName(warp.destMapGroup, warp.destMapNum) || `Unknown Map (${warp.destMapGroup}-${warp.destMapNum})`
            }));

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
 * @returns {Promise<object|null>}
 */
export async function getBackupMapStateJson() {
    try {
        const [playerX, playerY] = await getPlayerPosition();
        const facingDirection = await getPlayerFacingDirection();
        const currentMapBank = await getCurrentMapBank();
        const currentMapNumber = await getCurrentMapNumber();
        const currentMapName = getMapName(currentMapBank, currentMapNumber) || "Unknown Main Map";

        const backupMapWidth = await getBackupMapWidth();
        const backupMapHeight = await getBackupMapHeight();
        const backupMetatileBehaviors = await getBackupMapMetatileBehaviors();
        const mainMapWidth = await getMainMapWidth();
        const mainMapHeight = await getMainMapHeight();
        const mainMapConnections = await getCurrentMapConnections();
        const internalBackupMapName = "Backup Map";

        if (backupMapWidth <= 0 || backupMapHeight <= 0) {
            console.warn(`Invalid backup map dimensions fetched for ${internalBackupMapName}: ${backupMapWidth}x${backupMapHeight}. Returning minimal state.`);
            return {
                map_name: currentMapName,
                width: 0,
                height: 0,
                tile_passability: CONSTANTS.VIEWPORT_TILE_PASSABILITY,
                map_data_raw: [],
                coord_offset_x: CONSTANTS.MAP_OFFSET,
                coord_offset_y: CONSTANTS.MAP_OFFSET,
                player_state: { position: [playerX, playerY], facing: facingDirection },
                warps: [],
                npcs: [],
                all_connections: mainMapConnections || [],
                main_map_width: mainMapWidth || 0,
                main_map_height: mainMapHeight || 0,
            };
        }

        if (!backupMetatileBehaviors) {
            console.error(`Failed to fetch metatile behaviors for ${internalBackupMapName}. Collision map might be inaccurate.`);
        }

        const backupMapTiles = await getBackupMapTiles(backupMapWidth, backupMapHeight);
        const collisionData = await processMemoryDataToCollisionMap(backupMapTiles, backupMapWidth, backupMetatileBehaviors || []);

        if (!collisionData) {
            console.error(`Failed to process backup map tiles into collision data for ${internalBackupMapName}.`);
            return null;
        }

        const isConnectableTileType = (tileType) => tileType !== CONSTANTS.TILE_BLOCKED;

        if (mainMapWidth > 0 && mainMapHeight > 0 && mainMapConnections) {
            for (let by = 0; by < collisionData.height; by++) {
                for (let bx = 0; bx < collisionData.width; bx++) {
                    const tileString = collisionData.map_data[by][bx];
                    const originalTileType = tileString.split(':')[1];
                    let isCandidateForC = false;
                    if (!isConnectableTileType(originalTileType)) {
                        continue;
                    }

                    let markAsConnection = false;
                    const mainMapTileX = bx - CONSTANTS.MAP_OFFSET;
                    const mainMapTileY = by - CONSTANTS.MAP_OFFSET;

                    // Left edge
                    if (bx === CONSTANTS.MAP_OFFSET - 1 && (mainMapTileY >= 0 && mainMapTileY < mainMapHeight)) {
                        isCandidateForC = true;
                        const conn = findRelevantConnectionForCoordinate(mainMapConnections, "left", mainMapTileY);
                        if (conn) {
                            const innerAdjType = collisionData.map_data[by][bx + 1].split(':')[1];
                            if (isConnectableTileType(innerAdjType)) markAsConnection = true;
                        }
                    }
                    // Right edge
                    if (!markAsConnection && bx === CONSTANTS.MAP_OFFSET + mainMapWidth && (mainMapTileY >= 0 && mainMapTileY < mainMapHeight)) {
                        isCandidateForC = true;
                        const conn = findRelevantConnectionForCoordinate(mainMapConnections, "right", mainMapTileY);
                        if (conn) {
                            const innerAdjType = collisionData.map_data[by][bx - 1].split(':')[1];
                            if (isConnectableTileType(innerAdjType)) markAsConnection = true;
                        }
                    }
                    // Top edge
                    if (!markAsConnection && by === CONSTANTS.MAP_OFFSET - 1 && (mainMapTileX >= 0 && mainMapTileX < mainMapWidth)) {
                        isCandidateForC = true;
                        const conn = findRelevantConnectionForCoordinate(mainMapConnections, "up", mainMapTileX);
                        if (conn) {
                            const innerAdjType = collisionData.map_data[by + 1][bx].split(':')[1];
                            if (isConnectableTileType(innerAdjType)) markAsConnection = true;
                        }
                    }
                    // Bottom edge
                    if (!markAsConnection && by === CONSTANTS.MAP_OFFSET + mainMapHeight && (mainMapTileX >= 0 && mainMapTileX < mainMapWidth)) {
                        isCandidateForC = true;
                        const conn = findRelevantConnectionForCoordinate(mainMapConnections, "down", mainMapTileX);
                        if (conn) {
                            const innerAdjType = collisionData.map_data[by - 1][bx].split(':')[1];
                            if (isConnectableTileType(innerAdjType)) markAsConnection = true;
                        }
                    }

                    if (markAsConnection) {
                        collisionData.map_data[by][bx] = `${bx},${by}:${CONSTANTS.TILE_CONNECTION}`;
                    } else if (isCandidateForC && isConnectableTileType(originalTileType)) {
                        // console.log(`[BackupMapDebug] Candidate C-tile at (${bx},${by}) was not marked. OriginalType=${originalTileType}.`);
                    }
                }
            }
        }

        const rawWarps = await getCurrentMapWarps();
        const warps = rawWarps.map(warp => ({
            position: [warp.x, warp.y],
            destination: getMapName(warp.destMapGroup, warp.destMapNum) || `Unknown Map (${warp.destMapGroup}-${warp.destMapNum})`
        }));

        const rawNpcs = await getCurrentMapNpcs();
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
            coord_offset_x: CONSTANTS.MAP_OFFSET,
            coord_offset_y: CONSTANTS.MAP_OFFSET,
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
