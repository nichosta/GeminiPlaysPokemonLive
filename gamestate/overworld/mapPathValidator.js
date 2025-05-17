// mapPathValidator.js

import { isPlayerSurfing } from "./playerData.js";
import * as CONSTANTS from "../constant/constants.js";

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

    let prevX = playerStartX;
    let prevY = playerStartY;
    let prevTileType = '';

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
            }
        } else {
             console.warn(`validatePath: Player start (${playerStartX},${playerStartY}) not found in viewportMapData. Viewport starts at (${viewportAbsStartX},${viewportAbsStartY}).`);
        }
    } else if (path.length > 0) { // If map_data is empty but path is not, it's an issue unless player is at the first path step
        if (playerStartX !== path[0][0] || playerStartY !== path[0][1]) {
             console.warn(`validatePath: viewportMapData is empty or malformed, but path validation is attempted.`);
        }
        // prevTileType remains empty, logic below should handle it.
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
            } else {
                 console.warn(`Path validation coordinate mismatch: searching for (${pX},${pY}), found tile string "${tileString}" at viewport local [${viewLocalY}][${viewLocalX}].`);
            }
        }

        if (!tileFound) {
            return { isValid: false, failurePoint: [pX, pY], reason: `Coordinate (${pX},${pY}) not found in current visible map data.` };
        }

        if ((tileType === CONSTANTS.TILE_BLOCKED || tileType === CONSTANTS.TILE_NPC) && prevTileType !== CONSTANTS.TILE_WARP) {
            return { isValid: false, failurePoint: [pX, pY], reason: `Tile (${pX},${pY}) is not walkable. Type: '${tileType}'.` };
        }

        if (tileType === CONSTANTS.TILE_WATER && !(await isPlayerSurfing())) {
            return { isValid: false, failurePoint: [pX, pY], reason: `Tile (${pX},${pY}) is water, and player is not surfing.` };
        }

        const actualDeltaX = pX - prevX;
        const actualDeltaY = pY - prevY;

        if (tileType === CONSTANTS.TILE_LEDGE_EAST && actualDeltaX !== 1) {
            return { isValid: false, failurePoint: [pX, pY], reason: `Cannot traverse East-ledge (${pX},${pY}) not moving East.` };
        }
        if (tileType === CONSTANTS.TILE_LEDGE_WEST && actualDeltaX !== -1) {
            return { isValid: false, failurePoint: [pX, pY], reason: `Cannot traverse West-ledge (${pX},${pY}) not moving West.` };
        }
        if (tileType === CONSTANTS.TILE_LEDGE_NORTH && actualDeltaY !== -1) {
            return { isValid: false, failurePoint: [pX, pY], reason: `Cannot traverse North-ledge (${pX},${pY}) not moving North.` };
        }
        if (tileType === CONSTANTS.TILE_LEDGE_SOUTH && actualDeltaY !== 1) {
            return { isValid: false, failurePoint: [pX, pY], reason: `Cannot traverse South-ledge (${pX},${pY}) not moving South.` };
        }

        prevX = pX;
        prevY = pY;
        prevTileType = tileType;
    }

    return { isValid: true };
}
