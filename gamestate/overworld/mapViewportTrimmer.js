import { isValidFullMapState } from "./mapStateValidator.js";
import { findRelevantConnectionForCoordinate } from "./mapConnectionUtils.js";
import * as CONSTANTS from "../constant/constants.js";

/**
 * Trims the full map state to a viewport centered around the player.
 * @param {object} fullMapState - The complete map state object.
 * @returns {object|null}
 */
export function trimMapStateToViewport(fullMapState) {
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

    if (fullWidth === 0 || fullHeight === 0) {
        console.warn(`Trimming an empty map state for ${map_name}.`);
        return {
            map_name: map_name,
            width: 0,
            height: 0,
            tile_passability: CONSTANTS.VIEWPORT_TILE_PASSABILITY,
            map_data: [],
            player_state: player_state,
            warps: [],
            npcs: [],
            connections: []
        };
    }

    const [playerX, playerY] = player_state.position;
    const halfWidth = Math.floor(CONSTANTS.MAX_VIEWPORT_WIDTH / 2);
    const halfHeight = Math.floor(CONSTANTS.MAX_VIEWPORT_HEIGHT / 2);

    const idealStartX = playerX - halfWidth;
    const idealStartY = playerY - halfHeight;
    const idealEndX = idealStartX + CONSTANTS.MAX_VIEWPORT_WIDTH;
    const idealEndY = idealStartY + CONSTANTS.MAX_VIEWPORT_HEIGHT;

    const actualStartX = Math.max(0, idealStartX);
    const actualStartY = Math.max(0, idealStartY);
    const actualEndX = Math.min(fullWidth, idealEndX);
    const actualEndY = Math.min(fullHeight, idealEndY);

    const actualViewportWidth = actualEndX - actualStartX;
    const actualViewportHeight = actualEndY - actualStartY;

    if (actualViewportWidth <= 0 || actualViewportHeight <= 0) {
        console.warn(`Calculated viewport has zero or negative dimensions (${actualViewportWidth}x${actualViewportHeight}) for ${map_name}.`);
        return {
            map_name: map_name,
            width: 0,
            height: 0,
            tile_passability: CONSTANTS.VIEWPORT_TILE_PASSABILITY,
            map_data: [],
            player_state: player_state,
            warps: [],
            npcs: [],
            connections: [],
        };
    }

    const trimmedWarps = [];
    const warpLocations = new Set();
    for (const warp of fullWarps) {
        if (warp?.position?.length === 2) {
            const [warpX, warpY] = warp.position;
            if (warpX >= actualStartX && warpX < actualEndX && warpY >= actualStartY && warpY < actualEndY) {
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

    const trimmedNpcs = [];
    const npcLocations = new Set();
    for (const npc of fullNpcs) {
        if (npc?.position?.length === 2) {
            const [npcX, npcY] = npc.position;
            if (!npc.isOffScreen) { // Only consider on-screen NPCs for adding to map, but all NPCs for the list
                trimmedNpcs.push({
                    id: npc.id,
                    position: [npcX, npcY],
                    type: npc.type,
                    wandering: npc.wandering
                });
                // Add to locations set only if within viewport for tile marking
                if (npcX >= actualStartX && npcX < actualEndX && npcY >= actualStartY && npcY < actualEndY) {
                     npcLocations.add(`${npcX},${npcY}`);
                }
            }
        } else {
            console.warn("Skipping invalid NPC object during trimming:", npc);
        }
    }
    
    // Filter NPCs again to only include those strictly within the viewport for the final list
    const viewportNpcs = trimmedNpcs.filter(npc => {
        const [npcX, npcY] = npc.position;
        return npcX >= actualStartX && npcX < actualEndX && npcY >= actualStartY && npcY < actualEndY;
    });


    const trimmedMapData = [];
    for (let currentMapY = actualStartY; currentMapY < actualEndY; currentMapY++) {
        const row = [];
        const sourceRow = fullMapData[currentMapY];
        if (!sourceRow) {
            console.warn(`Missing expected row ${currentMapY} in fullMapData during trimming for ${map_name}.`);
            continue;
        }
        for (let currentMapX = actualStartX; currentMapX < actualEndX; currentMapX++) {
            let tileType = CONSTANTS.TILE_BLOCKED;
            const coordString = `${currentMapX},${currentMapY}`;

            if (warpLocations.has(coordString)) {
                tileType = CONSTANTS.TILE_WARP;
            } else if (npcLocations.has(coordString)) {
                tileType = CONSTANTS.TILE_NPC;
            } else {
                const originalTileString = sourceRow[currentMapX];
                if (typeof originalTileString === 'string' && originalTileString.includes(':')) {
                    const typeFromData = originalTileString.split(':')[1];
                    if (CONSTANTS.BASE_TILE_PASSABILITY.hasOwnProperty(typeFromData)) {
                        tileType = typeFromData;
                    } else {
                        console.warn(`Unexpected base tile type '${typeFromData}' at (${currentMapX}, ${currentMapY}). Defaulting to '${CONSTANTS.TILE_BLOCKED}'.`);
                    }
                } else {
                     console.warn(`Missing or invalid base tile string at (${currentMapX}, ${currentMapY}). Defaulting to '${CONSTANTS.TILE_BLOCKED}'.`);
                }
            }
            row.push(`${coordString}:${tileType}`);
        }
        if (row.length > 0) {
            trimmedMapData.push(row);
        }
    }

    const trimmedConnections = [];
    const STANDARD_DIRECTIONS_VIEWPORT = ["up", "down", "left", "right"];
    for (const dir of STANDARD_DIRECTIONS_VIEWPORT) {
        let isEdgeVisible = false;
        let relevantPlayerCoord;
        switch (dir) {
            case "down": isEdgeVisible = actualEndY === fullHeight; relevantPlayerCoord = playerX; break;
            case "up": isEdgeVisible = actualStartY === 0; relevantPlayerCoord = playerX; break;
            case "left": isEdgeVisible = actualStartX === 0; relevantPlayerCoord = playerY; break;
            case "right": isEdgeVisible = actualEndX === fullWidth; relevantPlayerCoord = playerY; break;
        }
        if (isEdgeVisible) {
            const relevantConn = findRelevantConnectionForCoordinate(fullConnections, dir, relevantPlayerCoord);
            if (relevantConn) {
                trimmedConnections.push(relevantConn);
            } else {
                const placeholderConn = fullConnections.find(c => c.direction === dir && c.mapName === "MAP_NONE");
                if (placeholderConn) trimmedConnections.push(placeholderConn);
            }
        }
    }
    for (const conn of fullConnections) {
        if (!STANDARD_DIRECTIONS_VIEWPORT.includes(conn.direction)) {
            trimmedConnections.push(conn);
        }
    }

    return {
        map_name: map_name,
        width: fullWidth, // Report full map width, not viewport width
        height: fullHeight, // Report full map height
        tile_passability: CONSTANTS.VIEWPORT_TILE_PASSABILITY,
        map_data: trimmedMapData, // Viewport data
        player_state: player_state,
        warps: trimmedWarps, // Warps within viewport
        npcs: viewportNpcs, // NPCs within viewport
        connections: trimmedConnections
    };
}

/**
 * Trims the full backup map state to a viewport centered around the player.
 * @param {object} fullBackupMapState - The backup map state.
 * @returns {object|null}
 */
export function trimBackupMapStateToViewport(fullBackupMapState) {
    if (!fullBackupMapState || !fullBackupMapState.map_data_raw || typeof fullBackupMapState.width !== 'number' || typeof fullBackupMapState.coord_offset_x !== 'number') {
        console.error("Invalid fullBackupMapState provided for trimming.", fullBackupMapState);
        return null;
    }

    const {
        map_name, // Main map's name
        width: backupPaddedWidth,
        height: backupPaddedHeight,
        map_data_raw,
        coord_offset_x,
        coord_offset_y,
        player_state,
        warps: fullWarps = [],
        npcs: fullNpcs = [],
        all_connections: mainMapAllConnections = [],
        main_map_width,
        main_map_height
    } = fullBackupMapState;

    const [playerX, playerY] = player_state.position; // Unoffset
    const halfWidth = Math.floor(CONSTANTS.MAX_VIEWPORT_WIDTH / 2);
    const halfHeight = Math.floor(CONSTANTS.MAX_VIEWPORT_HEIGHT / 2);

    const viewStartXUnsafe = playerX - halfWidth;
    const viewStartYUnsafe = playerY - halfHeight;

    const trimmedMapData = [];
    const warpLocations = new Set();
    const trimmedWarps = [];
    for (const warp of fullWarps) {
        if (warp?.position?.length === 2) {
            const [wx, wy] = warp.position;
            if (wx >= viewStartXUnsafe && wx < viewStartXUnsafe + CONSTANTS.MAX_VIEWPORT_WIDTH &&
                wy >= viewStartYUnsafe && wy < viewStartYUnsafe + CONSTANTS.MAX_VIEWPORT_HEIGHT) {
                warpLocations.add(`${wx},${wy}`);
                trimmedWarps.push(warp);
            }
        }
    }

    const npcLocations = new Set();
    const trimmedNpcs = [];
    for (const npc of fullNpcs) {
        if (npc?.position?.length === 2 && !npc.isOffScreen) {
            const [nx, ny] = npc.position;
            if (nx >= viewStartXUnsafe && nx < viewStartXUnsafe + CONSTANTS.MAX_VIEWPORT_WIDTH &&
                ny >= viewStartYUnsafe && ny < viewStartYUnsafe + CONSTANTS.MAX_VIEWPORT_HEIGHT) {
                npcLocations.add(`${nx},${ny}`);
                trimmedNpcs.push(npc);
            }
        }
    }

    for (let i = 0; i < CONSTANTS.MAX_VIEWPORT_HEIGHT; i++) {
        const currentRow = [];
        const currentUnOffsetY = viewStartYUnsafe + i;
        for (let j = 0; j < CONSTANTS.MAX_VIEWPORT_WIDTH; j++) {
            const currentUnOffsetX = viewStartXUnsafe + j;
            const backupX = currentUnOffsetX + coord_offset_x;
            const backupY = currentUnOffsetY + coord_offset_y;
            let finalTileType;
            const unoffsetCoordString = `${currentUnOffsetX},${currentUnOffsetY}`;

            if (warpLocations.has(unoffsetCoordString)) {
                finalTileType = CONSTANTS.TILE_WARP;
            } else if (npcLocations.has(unoffsetCoordString)) {
                finalTileType = CONSTANTS.TILE_NPC;
            } else if (backupX >= 0 && backupX < backupPaddedWidth && backupY >= 0 && backupY < backupPaddedHeight && map_data_raw[backupY] && map_data_raw[backupY][backupX]) {
                finalTileType = map_data_raw[backupY][backupX].split(':')[1];
            } else {
                finalTileType = CONSTANTS.TILE_BLOCKED;
            }
            currentRow.push(`${currentUnOffsetX},${currentUnOffsetY}:${finalTileType}`);
        }
        trimmedMapData.push(currentRow);
    }

    const visibleConnectionsOutput = [];
    const addedConnectionDetails = new Set();
    for (const row of trimmedMapData) {
        for (const tileString of row) {
            const parts = tileString.split(':');
            const coords = parts[0].split(',').map(Number);
            const tileType = parts[1];
            const unOffsetX = coords[0];
            const unOffsetY = coords[1];

            if (tileType === CONSTANTS.TILE_CONNECTION) {
                let potentialDirectionsAndCoords = [];
                if (unOffsetX === -1 && unOffsetY >= -1 && unOffsetY <= main_map_height) potentialDirectionsAndCoords.push({ dir: "left", coord: unOffsetY });
                if (unOffsetX === main_map_width && unOffsetY >= -1 && unOffsetY <= main_map_height) potentialDirectionsAndCoords.push({ dir: "right", coord: unOffsetY });
                if (unOffsetY === -1 && unOffsetX >= -1 && unOffsetX <= main_map_width) potentialDirectionsAndCoords.push({ dir: "up", coord: unOffsetX });
                if (unOffsetY === main_map_height && unOffsetX >= -1 && unOffsetX <= main_map_width) potentialDirectionsAndCoords.push({ dir: "down", coord: unOffsetX });

                for (const pd of potentialDirectionsAndCoords) {
                    const relevantConn = findRelevantConnectionForCoordinate(mainMapAllConnections, pd.dir, pd.coord);
                    if (relevantConn) {
                        const connKey = `${relevantConn.direction}_${relevantConn.mapName}_${relevantConn.offset}`;
                        if (!addedConnectionDetails.has(connKey)) {
                            visibleConnectionsOutput.push(relevantConn);
                            addedConnectionDetails.add(connKey);
                        }
                    }
                }
            }
        }
    }
    for (const conn of mainMapAllConnections) {
        if (!["up", "down", "left", "right"].includes(conn.direction)) {
            const connKey = `${conn.direction}_${conn.mapName}_${conn.offset !== undefined ? conn.offset : 'nooffset'}`;
            if (!addedConnectionDetails.has(connKey)) {
                visibleConnectionsOutput.push(conn);
                addedConnectionDetails.add(connKey);
            }
        }
    }

    return {
        map_name: `${map_name} (Extended Viewport)`,
        width: main_map_width,
        height: main_map_height,
        tile_passability: CONSTANTS.VIEWPORT_TILE_PASSABILITY,
        map_data: trimmedMapData,
        player_state: player_state,
        warps: trimmedWarps,
        npcs: trimmedNpcs,
        connections: visibleConnectionsOutput
    };
}
