import { isPlayerSurfing } from "./playerData.js";

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