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
    const initialPlayerMapElevation = await getPlayerElevation(); // Player's elevation on the map grid
    let isPlayerCurrentlySurfing = await isPlayerSurfing();

    let prevX = playerStartX;
    let prevY = playerStartY;
    let previousTileType = ''; // Type of the tile the player was on
    let playerCurrentLogicalElevation = initialPlayerMapElevation; // Player's active elevation (1 for surf, actual for land)

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
                previousTileType = parts[1];
                // Adjust player's starting logical elevation based on the tile they are on
                if (previousTileType === CONSTANTS.TILE_ELEVATION_TRANSITION) playerCurrentLogicalElevation = 0;
                else if (previousTileType === CONSTANTS.TILE_WATER) playerCurrentLogicalElevation = 1; // If starting on water, logical elevation is 1
                else if (previousTileType === CONSTANTS.TILE_ELEVATION_MULTILEVEL) playerCurrentLogicalElevation = initialPlayerMapElevation; // Preserve logical elevation
                // else playerCurrentLogicalElevation remains initialPlayerMapElevation
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
        let targetTileType = '';

        const viewLocalX = pX - viewportAbsStartX;
        const viewLocalY = pY - viewportAbsStartY;

        if (viewLocalY >= 0 && viewLocalY < viewportMapData.length &&
            viewLocalX >= 0 && viewLocalX < viewportMapData[viewLocalY].length) {
            const tileString = viewportMapData[viewLocalY][viewLocalX];
            const parts = tileString.split(':');
            const coordsInString = parts[0].split(',').map(Number);
            if (coordsInString[0] === pX && coordsInString[1] === pY) {
                targetTileType = parts[1];
                tileFound = true;
            } else {
                 console.warn(`Path validation coordinate mismatch: searching for (${pX},${pY}), found tile string "${tileString}" at viewport local [${viewLocalY}][${viewLocalX}].`);
            }
        }

        if (!tileFound) {
            return { isValid: false, failurePoint: [pX, pY], reason: `Coordinate (${pX},${pY}) not found in current visible map data.` };
        }

        // Determine the physical elevation of the target tile
        // Note: initialPlayerMapElevation is used as the reference for HIGHER/LOWER types,
        // as these types are determined relative to the player's elevation during map processing.
        let targetPhysicalTileElevation;
        if (targetTileType === CONSTANTS.TILE_ELEVATION_TRANSITION) targetPhysicalTileElevation = 0;
        else if (targetTileType === CONSTANTS.TILE_WATER) targetPhysicalTileElevation = 1;
        else if (targetTileType === CONSTANTS.TILE_ELEVATION_MULTILEVEL) targetPhysicalTileElevation = 15;
        else if (targetTileType === CONSTANTS.TILE_ELEVATION_HIGHER) targetPhysicalTileElevation = initialPlayerMapElevation + 1;
        else if (targetTileType === CONSTANTS.TILE_ELEVATION_LOWER) targetPhysicalTileElevation = initialPlayerMapElevation - 1;
        else if (targetTileType === CONSTANTS.TILE_WALKABLE) targetPhysicalTileElevation = initialPlayerMapElevation;
        else { // Ledges, NPCs, Warps, Connections - assume their physical elevation is compatible or same as current logical for now
            targetPhysicalTileElevation = playerCurrentLogicalElevation;
        }

        // Basic passability (blocked, NPC)
        if ((targetTileType === CONSTANTS.TILE_BLOCKED || targetTileType === CONSTANTS.TILE_NPC) && previousTileType !== CONSTANTS.TILE_WARP) { 
            return { isValid: false, failurePoint: [pX, pY], reason: `Tile (${pX},${pY}) is not walkable. Type: '${targetTileType}'.` };
        }

        // --- Elevation, Surfing, and Movement Logic ---
        const isSpecialTransition = (type) =>
            type === CONSTANTS.TILE_WARP || type === CONSTANTS.TILE_CONNECTION ||
            type === CONSTANTS.TILE_LEDGE_EAST || type === CONSTANTS.TILE_LEDGE_WEST ||
            type === CONSTANTS.TILE_LEDGE_NORTH || type === CONSTANTS.TILE_LEDGE_SOUTH;

        if (isSpecialTransition(targetTileType) || isSpecialTransition(previousTileType)) {
            // Ledges, warps, connections have their own movement rules.
            // For ledges, player's logical elevation might change based on the ledge.
            // For now, assume if the directional ledge check (below) passes, the elevation change is implicitly valid.
            // If moving onto a ledge that implies a drop, playerCurrentLogicalElevation should become targetPhysicalTileElevation.
            // This part might need more refinement if ledges have explicit elevation targets.
            if (targetTileType.startsWith("TILE_LEDGE_")) { // A simple way to check if it's any ledge
                 playerCurrentLogicalElevation = targetPhysicalTileElevation; // Assume ledge moves to target's physical elevation
            }
        } else if (targetTileType === CONSTANTS.TILE_ELEVATION_MULTILEVEL) { // Moving TO Multilevel
            // Always allowed. playerCurrentLogicalElevation and isPlayerCurrentlySurfing are preserved.
            // No change to playerCurrentLogicalElevation or isPlayerCurrentlySurfing by this step itself.
        } else if (previousTileType === CONSTANTS.TILE_ELEVATION_MULTILEVEL) { // Moving FROM Multilevel
            // playerCurrentLogicalElevation and isPlayerCurrentlySurfing are the preserved values.
            if (targetTileType === CONSTANTS.TILE_WATER) { // From multilevel to Water
                if (isPlayerCurrentlySurfing) { // Was surfing on multilevel
                    playerCurrentLogicalElevation = 1;
                } else { // Was walking on multilevel, try to mount surf
                    if (playerCurrentLogicalElevation === 3 || playerCurrentLogicalElevation === 0) {
                        isPlayerCurrentlySurfing = true;
                        playerCurrentLogicalElevation = 1;
                    } else {
                        return { isValid: false, failurePoint: [pX, pY], reason: `Cannot mount surf from multilevel (effective elevation ${playerCurrentLogicalElevation}) to water.` };
                    }
                }
            } else { // From multilevel to Non-Water, Non-Multilevel Land
                if (isPlayerCurrentlySurfing) { // Was surfing on multilevel, try to dismount
                    if (targetPhysicalTileElevation === 3) {
                        isPlayerCurrentlySurfing = false;
                        playerCurrentLogicalElevation = 3;
                    } else {
                        return { isValid: false, failurePoint: [pX, pY], reason: `Cannot dismount surf from multilevel (surfing at logical elevation ${playerCurrentLogicalElevation}) to land with physical elevation ${targetPhysicalTileElevation}. Must be 3.` };
                    }
                } else { // Was walking on multilevel, normal land movement
                    if (playerCurrentLogicalElevation !== targetPhysicalTileElevation &&
                        targetPhysicalTileElevation !== 0 && playerCurrentLogicalElevation !== 0) {
                        return { isValid: false, failurePoint: [pX, pY], reason: `Invalid elevation change from multilevel (effective elevation ${playerCurrentLogicalElevation}) to land with physical elevation ${targetPhysicalTileElevation}.` };
                    }
                    playerCurrentLogicalElevation = targetPhysicalTileElevation;
                }
            }
        } else if (targetTileType === CONSTANTS.TILE_WATER) { // Moving TO Water (not from multilevel)
            if (isPlayerCurrentlySurfing) {
                playerCurrentLogicalElevation = 1;
            } else { // Not surfing, try to mount
                if (playerCurrentLogicalElevation === 3 || playerCurrentLogicalElevation === 0) {
                    isPlayerCurrentlySurfing = true;
                    playerCurrentLogicalElevation = 1;
                } else {
                    return { isValid: false, failurePoint: [pX, pY], reason: `Cannot mount surf from elevation ${playerCurrentLogicalElevation} to water.` };
                }
            }
        } else { // Moving TO Non-Water, Non-Multilevel Land (not from multilevel)
            if (isPlayerCurrentlySurfing) { // Currently surfing, try to dismount
                if (targetPhysicalTileElevation === 3) {
                    isPlayerCurrentlySurfing = false;
                    playerCurrentLogicalElevation = 3;
                } else {
                    return { isValid: false, failurePoint: [pX, pY], reason: `Cannot dismount surf from water to land with physical elevation ${targetPhysicalTileElevation}. Must be 3. Current logical elevation: ${playerCurrentLogicalElevation}` };
                }
            } else { // Not surfing, land-to-land movement
                if (playerCurrentLogicalElevation !== targetPhysicalTileElevation &&
                    targetPhysicalTileElevation !== 0 && playerCurrentLogicalElevation !== 0) { // Allow to/from elevation 0
                    return { isValid: false, failurePoint: [pX, pY], reason: `Invalid elevation change from ${playerCurrentLogicalElevation} to ${targetPhysicalTileElevation}.` };
                }
                playerCurrentLogicalElevation = targetPhysicalTileElevation;
            }
        }

        // Ledge Logic
        const actualDeltaX = pX - prevX;
        const actualDeltaY = pY - prevY;
        // Note: Ledge movement might implicitly change playerCurrentLogicalElevation if the targetPhysicalTileElevation of the ledge tile is different.
        // This is handled by the isSpecialTransition block setting playerCurrentLogicalElevation = targetPhysicalTileElevation for ledges.

        if (targetTileType === CONSTANTS.TILE_LEDGE_EAST && actualDeltaX !== 1) { //
            return { isValid: false, failurePoint: [pX, pY], reason: `Cannot traverse East-ledge (${pX},${pY}) not moving East.` };
        }
        if (targetTileType === CONSTANTS.TILE_LEDGE_WEST && actualDeltaX !== -1) { //
            return { isValid: false, failurePoint: [pX, pY], reason: `Cannot traverse West-ledge (${pX},${pY}) not moving West.` };
        }
        if (targetTileType === CONSTANTS.TILE_LEDGE_NORTH && actualDeltaY !== -1) { //
            return { isValid: false, failurePoint: [pX, pY], reason: `Cannot traverse North-ledge (${pX},${pY}) not moving North.` };
        }
        if (targetTileType === CONSTANTS.TILE_LEDGE_SOUTH && actualDeltaY !== 1) { //
            return { isValid: false, failurePoint: [pX, pY], reason: `Cannot traverse South-ledge (${pX},${pY}) not moving South.` };
        }

        prevX = pX;
        prevY = pY;
        previousTileType = targetTileType; // Update for the next iteration's "moving from" logic
        // playerCurrentLogicalElevation is already updated by the logic above.
     }
 
     return { isValid: true };
}