// mapPathValidator.js

import { isPlayerSurfing } from "./playerData.js"; 
import * as CONSTANTS from "../constant/constants.js"; 

/**
 * Validates a given navigation path against the provided map state.
 * Assumes mapDataProcessor.js has already handled complex elevation logic.
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
    
    let isPlayerCurrentlySurfing = await isPlayerSurfing(); 

    let prevX = playerStartX;
    let prevY = playerStartY;
    let previousTileType = ''; 

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
            previousTileType = parts[1];
        } else {
             console.warn(`validatePath: Player start (${playerStartX},${playerStartY}) not found in viewportMapData. Viewport starts at (${viewportAbsStartX},${viewportAbsStartY}).`);
        }
    }

    const isAlwaysOneStepTile = (type) =>
        type === CONSTANTS.TILE_WARP || type === CONSTANTS.TILE_CONNECTION ||
        type === CONSTANTS.TILE_LEDGE_EAST || type === CONSTANTS.TILE_LEDGE_WEST ||
        type === CONSTANTS.TILE_LEDGE_NORTH || type === CONSTANTS.TILE_LEDGE_SOUTH;

    for (let i = 0; i < path.length; i++) {
        const [pX, pY] = path[i];
        const deltaX = pX - prevX; // Used for intermediate tile calculation
        const deltaY = pY - prevY; // Used for intermediate tile calculation
        const stepManhattanDistance = Math.abs(deltaX) + Math.abs(deltaY);

        let tileFound = false;
        let targetTileType = '';

        const viewLocalX = pX - viewportAbsStartX;
        const viewLocalY = pY - viewportAbsStartY;

        if (viewLocalY >= 0 && viewLocalY < viewportMapData.length &&
            viewLocalX >= 0 && viewLocalX < viewportMapData[viewLocalY].length) {
            const tileString = viewportMapData[viewLocalY][viewLocalX];
            const parts = tileString.split(':');
            targetTileType = parts[1];
            tileFound = true;
        }

        if (!tileFound) {
            return { isValid: false, failurePoint: [pX, pY], reason: `Coordinate (${pX},${pY}) not found in current visible map data.` };
        }
        
        if ((targetTileType === CONSTANTS.TILE_BLOCKED || targetTileType === CONSTANTS.TILE_NPC) && 
            previousTileType !== CONSTANTS.TILE_WARP) { 
            return { isValid: false, failurePoint: [pX, pY], reason: `Tile (${pX},${pY}) is not walkable. Type: '${targetTileType}'.` };
        }

        // --- Step Distance Validation ---
        let expectedStepDistance;
        if (isAlwaysOneStepTile(targetTileType)) {
            expectedStepDistance = 1;
        } else if (isPlayerCurrentlySurfing) {
            if (targetTileType === CONSTANTS.TILE_WALKABLE) { // Dismounting
                if (stepManhattanDistance === 1 || stepManhattanDistance === 2) {
                    expectedStepDistance = stepManhattanDistance; // Valid dismount distance
                } else {
                    // Invalid step distance for dismount attempt
                    const previousPointDisplay = i === 0 ? `player start (${playerStartX},${playerStartY})` : `previous step (${prevX},${prevY})`;
                    return {
                        isValid: false,
                        failurePoint: [pX, pY],
                        reason: `Invalid step distance (${stepManhattanDistance}) for dismount attempt from ${previousPointDisplay} to (${pX},${pY}). Expected 1 or 2.`
                    };
                }
            } else if (targetTileType === CONSTANTS.TILE_WATER || targetTileType === CONSTANTS.TILE_DIVE) { // Continuing surf
                expectedStepDistance = 2;
            } else { 
                // Attempting to surf onto other unexpected tile types (e.g. TILE_BLOCKED that wasn't caught yet)
                // This will likely fail the stepManhattanDistance !== expectedStepDistance check if not 2.
                expectedStepDistance = 2; 
            }
        } else { // Not surfing
            expectedStepDistance = 1;
        }
        
        if (stepManhattanDistance !== expectedStepDistance) {
            const previousPointDisplay = i === 0 ? `player start (${playerStartX},${playerStartY})` : `previous step (${prevX},${prevY})`;
            return {
                isValid: false,
                failurePoint: [pX, pY],
                reason: `Step (${pX},${pY}) is ${stepManhattanDistance} tile(s) away from ${previousPointDisplay}, but ${expectedStepDistance} was expected. Target: ${targetTileType}, Surfing: ${isPlayerCurrentlySurfing}`
            };
        }

        // --- Intermediate Tile Check for 2-Tile Surf Moves ---
        if (isPlayerCurrentlySurfing && stepManhattanDistance === 2) {
            const interX = prevX + deltaX / 2; // deltaX is already (pX - prevX)
            const interY = prevY + deltaY / 2; // deltaY is already (pY - prevY)

            const interViewLocalX = interX - viewportAbsStartX;
            const interViewLocalY = interY - viewportAbsStartY;

            let interTileType = CONSTANTS.TILE_BLOCKED; // Default to blocked if out of bounds or not found

            if (interViewLocalY >= 0 && interViewLocalY < viewportMapData.length &&
                interViewLocalX >= 0 && interViewLocalX < viewportMapData[interViewLocalY].length) {
                const interTileString = viewportMapData[interViewLocalY][interViewLocalX];
                if (interTileString && interTileString.includes(':')) {
                    const interParts = interTileString.split(':');
                    // Ensure the coordinate in the string matches the calculated intermediate coordinate
                    const interCoordsInString = interParts[0].split(',').map(Number);
                    if (interCoordsInString[0] === interX && interCoordsInString[1] === interY) {
                         interTileType = interParts[1];
                    } else {
                        console.warn(`Intermediate tile coordinate mismatch: expected ${interX},${interY}, found in string ${interParts[0]}`);
                    }
                } else {
                     console.warn(`Malformed intermediate tile string at ${interX},${interY}: ${interTileString}`);
                }
            } else {
                console.warn(`Intermediate tile (${interX},${interY}) is outside viewport bounds.`);
            }

            if (interTileType === CONSTANTS.TILE_BLOCKED || interTileType === CONSTANTS.TILE_NPC) {
                return { 
                    isValid: false, 
                    failurePoint: [pX, pY], 
                    reason: `Cannot surf to (${pX},${pY}) because intermediate tile (${interX},${interY}) is blocked (Type: '${interTileType}').` 
                };
            }
        }


        // --- Surfing State and Movement Logic (Simplified, as elevation is handled by processor) ---
        const isSpecialMovementTile = (type) => 
            type === CONSTANTS.TILE_WARP || type === CONSTANTS.TILE_CONNECTION ||
            type.startsWith("TILE_LEDGE_");

        if (isSpecialMovementTile(targetTileType) || isSpecialMovementTile(previousTileType)) {
            // Player surf state doesn't inherently change by moving onto these.
        } else if (targetTileType === CONSTANTS.TILE_WATER || targetTileType === CONSTANTS.TILE_DIVE) {
            if (!isPlayerCurrentlySurfing) {
                return { isValid: false, failurePoint: [pX, pY], reason: `Cannot move onto water tile (${pX},${pY}) without being in surf state.` };
            }
        } else if (targetTileType === CONSTANTS.TILE_WALKABLE) {
            // If isPlayerCurrentlySurfing, this is a dismount. If not, it's normal land movement.
            // The surf state itself is assumed to be handled by game logic after validation.
        }

        // --- Ledge Direction Logic ---
        const actualDeltaX = pX - prevX; // Recalculate for clarity, or reuse deltaX from above
        const actualDeltaY = pY - prevY; // Recalculate for clarity, or reuse deltaY from above
        
        if (targetTileType === CONSTANTS.TILE_LEDGE_EAST && actualDeltaX !== 1) { 
            return { isValid: false, failurePoint: [pX, pY], reason: `Cannot traverse East-ledge (${pX},${pY}) not moving East.` };
        }
        if (targetTileType === CONSTANTS.TILE_LEDGE_WEST && actualDeltaX !== -1) { 
            return { isValid: false, failurePoint: [pX, pY], reason: `Cannot traverse West-ledge (${pX},${pY}) not moving West.` };
        }
        if (targetTileType === CONSTANTS.TILE_LEDGE_NORTH && actualDeltaY !== -1) { 
            return { isValid: false, failurePoint: [pX, pY], reason: `Cannot traverse North-ledge (${pX},${pY}) not moving North.` };
        }
        if (targetTileType === CONSTANTS.TILE_LEDGE_SOUTH && actualDeltaY !== 1) { 
            return { isValid: false, failurePoint: [pX, pY], reason: `Cannot traverse South-ledge (${pX},${pY}) not moving South.` };
        }

        // Player is attempting to move upwards onto a waterfall tile
        if (targetTileType === CONSTANTS.TILE_WATERFALL && isPlayerCurrentlySurfing && actualDeltaY == -1) {
            return { isValid: false, failurePoint: [pX, pY], reason: `Ascending this Waterfall tile requires the use of the Waterfall HM.`};
        }

        prevX = pX;
        prevY = pY;
        previousTileType = targetTileType; 
     }
 
     return { isValid: true };
}
