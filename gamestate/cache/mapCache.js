// c:/repositories/GeminiPlaysPokemonLive/gamestate/cache/mapCache.js

let currentMapId = null; // Stores "bank-number" string
let cachedMapStructure = null; // Stores { mapName, width, height, tile_passability, map_data, rawWarps, connections }

/**
 * Retrieves the cached map structure if the mapBank and mapNumber match the cached ID.
 * @param {number} mapBank - The current map bank.
 * @param {number} mapNumber - The current map number.
 * @returns {object|null} The cached map structure or null if not found or ID mismatch.
 */
export function getCachedMapStructure(mapBank, mapNumber) {
    const mapId = `${mapBank}-${mapNumber}`;
    if (currentMapId === mapId && cachedMapStructure) {
        // console.debug(`Cache hit for map structure: ${mapId}`);
        return cachedMapStructure;
    }
    // console.debug(`Cache miss for map structure: ${mapId} (current: ${currentMapId})`);
    return null;
}

/**
 * Stores the provided map structure in the cache, associating it with the given mapBank and mapNumber.
 * @param {number} mapBank - The current map bank.
 * @param {number} mapNumber - The current map number.
 * @param {object} mapStructure - The map structural data to cache.
 */
export function setCachedMapStructure(mapBank, mapNumber, mapStructure) {
    const mapId = `${mapBank}-${mapNumber}`;
    currentMapId = mapId;
    cachedMapStructure = mapStructure;
    // console.debug(`Cached map structure for: ${mapId}`);
}

/**
 * Invalidates the current map cache.
 */
export function invalidateMapCache() {
    // console.debug("Map cache invalidated.");
    currentMapId = null;
    cachedMapStructure = null;
}