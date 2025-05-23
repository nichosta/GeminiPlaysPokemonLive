// mapPathValidator.js

import { getPlayerElevation, isPlayerSurfing } from "./playerData.js"; //
import * as CONSTANTS from "../constant/constants.js"; //

/**
 * Validates a given navigation path against the provided map state.
 * @param {Array<[number, number]>} path - An array of [x, y] coordinates.
 * @param {object} mapState - The map state object (typically trimmed viewport state).
 * @returns {Promise<{isValid: boolean, failurePoint?: [number, number], reason?: string}>}
 */
export async function validatePath(path, mapState) {
    if (!path || path.length === 0) {
        return { isValid: true, reason: "Empty path is trivially valid." };
    }

    if (!mapState || !mapState.map_data || typeof mapState.width !== 'number' || typeof mapState.height !== 'number' || !mapState.player_state) {
        console.warn("validatePath: Invalid mapState provided.", mapState);
        return { isValid: false, reason: "Invalid map state provided for validation." };
    }

    const { map_data: viewportMapData, player_state } = mapState;
    const [playerStartX, playerStartY] = player_state.position;
    const playerStartElevation = await getPlayerElevation();
    let currentSurfingStatus = await isPlayerSurfing();

    let prevX = playerStartX;
    let prevY = playerStartY;
    let prevTileType = '';
    let prevTileElevation = playerStartElevation;

    let viewportAbsStartX = 0;
    let viewportAbsStartY = 0;

    if (viewportMapData.length > 0 && viewportMapData[0].length > 0 && viewportMapData[0][0].includes(',')) {
        [viewportAbsStartX, viewportAbsStartY] = viewportMapData[0][0].split(':')[0].split(',').map(Number);

        const playerStartViewLocalX = playerStartX - viewportAbsStartX;
        const playerStartViewLocalY = playerStartY - viewportAbsStartY;

        if (playerStartViewLocalY >= 0 && playerStartViewLocalY < viewportMapData.length &&
            playerStartViewLocalX >= 0 && playerStartViewLocalX < viewportMapData[playerStartViewLocalY].length) {
            const playerStartTileString = viewportMapData[playerStartViewLocalY][playerStartViewLocalX];
            const parts = playerStartTileString.split(':');
            const coordsInString = parts[0].split(',').map(Number);
            if (coordsInString[0] === playerStartX && coordsInString[1] === playerStartY) {
                prevTileType = parts[1];
                // Determine previous tile's effective elevation for validation start
                if (prevTileType === CONSTANTS.TILE_ELEVATION_TRANSITION) prevTileElevation = 0; //
                else if (prevTileType === CONSTANTS.TILE_WATER) prevTileElevation = 1; //
                // For '>' and '<', the playerStartElevation is the reference.
                // For 'O', elevation is same as player.
            }
        } else {
             console.warn(`validatePath: Player start (${playerStartX},${playerStartY}) not found in viewportMapData. Viewport starts at (${viewportAbsStartX},${viewportAbsStartY}).`);
        }
    } else if (path.length > 0) {
        if (playerStartX !== path[0][0] || playerStartY !== path[0][1]) {
             console.warn(`validatePath: viewportMapData is empty or malformed, but path validation is attempted.`);
        }
    }


    for (let i = 0; i < path.length; i++) {
        const [pX, pY] = path[i];
        const deltaX = Math.abs(pX - prevX);
        const deltaY = Math.abs(pY - prevY);

        if (deltaX + deltaY !== 1) {
            const previousPointDisplay = i === 0 ? `player start (${prevX},${prevY})` : `previous step (${prevX},${prevY})`;
            return {
                isValid: false,
                failurePoint: [pX, pY],
                reason: `Step (${pX},${pY}) is not adjacent to ${previousPointDisplay}.`
            };
        }

        let tileFound = false;
        let tileType = '';
        let currentTileElevation = -1; // Placeholder for target tile's intrinsic elevation

        const viewLocalX = pX - viewportAbsStartX;
        const viewLocalY = pY - viewportAbsStartY;

        if (viewLocalY >= 0 && viewLocalY < viewportMapData.length &&
            viewLocalX >= 0 && viewLocalX < viewportMapData[viewLocalY].length) {
            const tileString = viewportMapData[viewLocalY][viewLocalX];
            const parts = tileString.split(':');
            const coordsInString = parts[0].split(',').map(Number);
            if (coordsInString[0] === pX && coordsInString[1] === pY) {
                tileType = parts[1];
                tileFound = true;

                // Determine currentTileElevation based on tileType
                if (tileType === CONSTANTS.TILE_ELEVATION_TRANSITION) currentTileElevation = 0; //
                else if (tileType === CONSTANTS.TILE_WATER) currentTileElevation = 1; //
                else if (tileType === CONSTANTS.TILE_ELEVATION_HIGHER) currentTileElevation = playerStartElevation + 1; // Represents a tile higher than player
                else if (tileType === CONSTANTS.TILE_ELEVATION_LOWER) currentTileElevation = playerStartElevation - 1; // Represents a tile lower than player
                else if (tileType === CONSTANTS.TILE_WALKABLE) currentTileElevation = playerStartElevation; // Same elevation
                else currentTileElevation = prevTileElevation; // For ledges, NPCs, warps, assume same effective elevation as previous for now

            } else {
                 console.warn(`Path validation coordinate mismatch: searching for (${pX},${pY}), found tile string "${tileString}" at viewport local [${viewLocalY}][${viewLocalX}].`);
            }
        }

        if (!tileFound) {
            return { isValid: false, failurePoint: [pX, pY], reason: `Coordinate (${pX},${pY}) not found in current visible map data.` };
        }

        // Basic passability (blocked, NPC)
        if ((tileType === CONSTANTS.TILE_BLOCKED || tileType === CONSTANTS.TILE_NPC) && prevTileType !== CONSTANTS.TILE_WARP) { //
            return { isValid: false, failurePoint: [pX, pY], reason: `Tile (${pX},${pY}) is not walkable. Type: '${tileType}'.` };
        }

        // Water and Surfing Logic
        if (tileType === CONSTANTS.TILE_WATER) { //
            if (!currentSurfingStatus) { // Trying to enter water without surfing
                 // Allow entering water if it's elevation 1 (implicitly, tileType is TILE_WATER)
                if (currentTileElevation !== 1) {
                     return { isValid: false, failurePoint: [pX, pY], reason: `Cannot enter water tile (${pX},${pY}) without surfing or tile is not surfable elevation.` };
                }
                // If logic reaches here, player is entering surfable water, so update status for next step
                currentSurfingStatus = true;
            }
             // If already surfing, can continue on water
        } else { // Target tile is NOT water
            if (currentSurfingStatus) { // Trying to leave water
                if (currentTileElevation !== 3) { // Can only dismount onto elevation 3
                    return { isValid: false, failurePoint: [pX, pY], reason: `Cannot dismount surf onto tile (${pX},${pY}) as it is not elevation 3. Target tile elevation: ${currentTileElevation}` };
                }
                 // If logic reaches here, player is dismounting from surf
                currentSurfingStatus = false;
            }
        }


        // Elevation change rules (apply if not dealing with surf transitions handled above)
        // Also, warps and connections ignore elevation change rules for the step onto them
        if (prevTileType !== CONSTANTS.TILE_WARP && tileType !== CONSTANTS.TILE_WARP && prevTileType !== CONSTANTS.TILE_CONNECTION && tileType !== CONSTANTS.TILE_CONNECTION) { //
            if (prevTileElevation !== 0 && currentTileElevation !== 0 && prevTileElevation !== currentTileElevation) {
                 // Allow if current player is on elevation 1 (surfing) and target is elevation 3 (dismounting)
                if (!(prevTileElevation === 1 && currentTileElevation === 3)) {
                     // Allow if current player is on elevation 3 and target is elevation 1 (mounting)
                    if(!(prevTileElevation === 3 && currentTileElevation === 1)){
                        return { isValid: false, failurePoint: [pX, pY], reason: `Cannot move directly between different elevations: from ${prevTileElevation} to ${currentTileElevation} at (${pX},${pY}).` };
                    }
                }
            }
        }


        // Ledge Logic
        const actualDeltaX = pX - prevX;
        const actualDeltaY = pY - prevY;

        if (tileType === CONSTANTS.TILE_LEDGE_EAST && actualDeltaX !== 1) { //
            return { isValid: false, failurePoint: [pX, pY], reason: `Cannot traverse East-ledge (${pX},${pY}) not moving East.` };
        }
        if (tileType === CONSTANTS.TILE_LEDGE_WEST && actualDeltaX !== -1) { //
            return { isValid: false, failurePoint: [pX, pY], reason: `Cannot traverse West-ledge (${pX},${pY}) not moving West.` };
        }
        if (tileType === CONSTANTS.TILE_LEDGE_NORTH && actualDeltaY !== -1) { //
            return { isValid: false, failurePoint: [pX, pY], reason: `Cannot traverse North-ledge (${pX},${pY}) not moving North.` };
        }
        if (tileType === CONSTANTS.TILE_LEDGE_SOUTH && actualDeltaY !== 1) { //
            return { isValid: false, failurePoint: [pX, pY], reason: `Cannot traverse South-ledge (${pX},${pY}) not moving South.` };
        }

        prevX = pX;
        prevY = pY;
        prevTileType = tileType;
        prevTileElevation = currentTileElevation; // Update previous tile's elevation to the target's for the next step
    }

    return { isValid: true };
}