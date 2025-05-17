/**
 * Validates the structure of the full map state object.
 * @param {object} state - The map state object.
 * @returns {boolean} True if the state is valid, false otherwise.
 */
export function isValidFullMapState(state) {
    if (!state || typeof state !== 'object') return false;
    if (!state.player_state || !Array.isArray(state.player_state.position) || state.player_state.position.length !== 2) return false;
    if (typeof state.width !== 'number' || state.width < 0) return false;
    if (typeof state.height !== 'number' || state.height < 0) return false;
    if (!Array.isArray(state.map_data)) return false;
    if (!Array.isArray(state.warps)) return false;
    if (!Array.isArray(state.npcs)) return false;
    if (!Array.isArray(state.connections)) return false;

    if (state.height > 0 && state.map_data.length !== state.height) {
        console.warn(`Map state height mismatch: expected ${state.height}, got ${state.map_data.length}`);
        return false;
    }
    if (state.height > 0 && state.width > 0) {
        if (!Array.isArray(state.map_data[0]) || state.map_data[0].length !== state.width) {
            console.warn(`Map state width mismatch: expected ${state.width}, got ${state.map_data[0]?.length ?? 'undefined'}`);
            return false;
        }
    }
    if ((state.width === 0 || state.height === 0) && state.map_data.length !== 0) {
        console.warn(`Map state has zero dimension but non-empty map_data`);
        return false;
    }
    if (state.width > 0 && state.height > 0 && state.map_data.length === 0) {
        console.warn(`Map state has non-zero dimensions but empty map_data`);
        return false;
    }
    return true;
}
