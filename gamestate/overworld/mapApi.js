import { getMapStateJson as internalGetMapStateJson, getBackupMapStateJson as internalGetBackupMapStateJson } from "./mapStateRetriever.js";
import { trimMapStateToViewport, trimBackupMapStateToViewport } from "./mapViewportTrimmer.js";
import { validatePath as internalValidatePath } from "./mapPathValidator.js";

/**
 * Retrieves the complete current map state in a structured JSON format.
 * (This is one of the originally exported functions, so re-exporting it from the facade)
 */
export async function getMapStateJson() {
    // Directly call the internal function from mapStateRetriever.js
    return internalGetMapStateJson();
}


/**
 * Retrieves the current map state trimmed to a viewport around the player.
 */
export async function getVisibleMapStateJson() {
    try {
        const fullState = await internalGetMapStateJson();
        if (!fullState) {
            // Error already logged by internalGetMapStateJson
            return null;
        }

        const trimmedState = trimMapStateToViewport(fullState);
        if (!trimmedState) {
            // Error already logged by trimMapStateToViewport
            console.error("Facade: Failed to trim map state to viewport.");
            return null;
        }
        return trimmedState;
    } catch (error) {
        console.error("Facade: Error getting visible map state:", error);
        return null;
    }
}

/**
 * Retrieves the backup map state trimmed to a viewport around the player.
 */
export async function getVisibleBackupMapStateJson() {
    try {
        const fullState = await internalGetBackupMapStateJson();
        if (!fullState) {
            // Error already logged by internalGetBackupMapStateJson
            return null;
        }
        const trimmedState = trimBackupMapStateToViewport(fullState);
        if (!trimmedState) {
            // Error already logged by trimBackupMapStateToViewport
            console.error("Facade: Failed to trim backup map state to viewport.");
            return null;
        }
        return trimmedState;
    } catch (error) {
        console.error("Facade: Error getting visible backup map state:", error);
        return null;
    }
}

/**
 * Validates a given navigation path against the provided map state.
 */
export async function validatePath(path, mapState) {
    // Directly call the internal function from mapPathValidator.js
    return internalValidatePath(path, mapState);
}
