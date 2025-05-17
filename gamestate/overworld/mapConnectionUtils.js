/**
 * Finds the most relevant connection for a given coordinate along a specific direction.
 *
 * @param {Array<object>} connections - Array of connection objects.
 * @param {string} direction - The direction to filter by.
 * @param {number} coordinate - The player's or tile's coordinate.
 * @returns {object|null} The most relevant connection object, or null.
 */
export function findRelevantConnectionForCoordinate(connections, direction, coordinate) {
    if (!connections) return null;

    const candidates = connections
        .filter(c => c.direction === direction && c.mapName !== "MAP_NONE" && typeof c.offset === 'number')
        .sort((a, b) => a.offset - b.offset); // Sort by offset ascending

    let bestMatch = null;
    for (const conn of candidates) {
        if (coordinate >= conn.offset) {
            bestMatch = conn;
        } else {
            break;
        }
    }
    return bestMatch;
}