import { readUint32, readRange } from '../emulatorInteraction/httpMemoryReader.js';
import * as CONSTANTS from "../constant/constants.js";

// Assuming BYTES_PER_TILE might be useful elsewhere, add it to MAP_CONSTANTS
// Otherwise, define it here: const BYTES_PER_TILE = 2;
// For this example, let's assume it's added to MAP_CONSTANTS.

/**
 * Gets the width of the backup map layout.
 * Reads a u32 value from BACKUP_MAP_LAYOUT_ADDR + BACKUP_MAP_LAYOUT_WIDTH_OFFSET.
 * @returns {Promise<number>} The width of the map layout.
 */
async function getBackupMapWidth() {
    const widthAddress = CONSTANTS.BACKUP_MAP_LAYOUT_ADDR + CONSTANTS.BACKUP_MAP_LAYOUT_WIDTH_OFFSET;
    return await readUint32(widthAddress);
}

/**
 * Gets the height of the backup map layout.
 * Reads a u32 value from BACKUP_MAP_LAYOUT_ADDR + BACKUP_MAP_LAYOUT_HEIGHT_OFFSET.
 * @returns {Promise<number>} The height of the map layout.
 */
async function getBackupMapHeight() {
    const heightAddress = CONSTANTS.BACKUP_MAP_LAYOUT_ADDR + CONSTANTS.BACKUP_MAP_LAYOUT_HEIGHT_OFFSET;
    return await readUint32(heightAddress);
}

/**
 * Gets the backup map tiles.
 * Reads a range of bytes from BACKUP_MAP_DATA_ADDR.
 * @param {number} mapWidth - The width of the map.
 * @param {number} mapHeight - The height of the map.
 * @returns {Promise<number[]>} The map tiles as an array of bytes.
 */
async function getBackupMapTiles(mapWidth, mapHeight) {
    let mapTileBytes = mapWidth * mapHeight * 2;
    let range = await readRange(CONSTANTS.BACKUP_MAP_DATA_ADDR, mapTileBytes);
    return range;
}

/**
 * Gets the base address of the current map's layout structure.
 * Reads the pointer stored at CURRENT_MAP_HEADER_ADDR + MAP_HEADER_MAP_LAYOUT_OFFSET.
 * @returns {Promise<number>} The base address (pointer value).
 */
async function getMainMapLayoutBaseAddress() {
    return await readUint32(CONSTANTS.CURRENT_MAP_HEADER_ADDR + CONSTANTS.MAP_HEADER_MAP_LAYOUT_OFFSET);
}

/**
 * Gets the width of the current map layout.
 * Reads a u32 value from the map layout struct + MAP_LAYOUT_WIDTH_OFFSET.
 * @returns {Promise<number>} The width of the map layout in tiles.
 */
export async function getMainMapWidth() {
    const baseAddress = await getMainMapLayoutBaseAddress();
    // Add check if baseAddress is valid/non-zero if necessary
    if (!baseAddress) {
        console.error("Failed to get main map layout base address for width.");
        return 0; // Or throw an error, depending on desired behavior
    }
    return await readUint32(baseAddress + CONSTANTS.MAP_LAYOUT_WIDTH_OFFSET);
}

/**
 * Gets the height of the current map layout.
 * Reads a u32 value from the map layout struct + MAP_LAYOUT_HEIGHT_OFFSET.
 * @returns {Promise<number>} The height of the map layout in tiles.
 */
export async function getMainMapHeight() {
    const baseAddress = await getMainMapLayoutBaseAddress();
     // Add check if baseAddress is valid/non-zero if necessary
    if (!baseAddress) {
        console.error("Failed to get main map layout base address for height.");
        return 0; // Or throw an error
    }
    return await readUint32(baseAddress + CONSTANTS.MAP_LAYOUT_HEIGHT_OFFSET);
}

/**
 * Gets the current map tiles as raw bytes.
 * Reads a range of bytes from the map data address.
 * @param {number} mapWidth - The width of the map in tiles.
 * @param {number} mapHeight - The height of the map in tiles.
 * @returns {Promise<number[]>} The map tiles as an array of bytes, or an empty array on error.
 */
export async function getMainMapTiles(mapWidth, mapHeight) {
    const baseAddress = await getMainMapLayoutBaseAddress();
    if (!baseAddress) {
        console.error("Failed to get main map layout base address for tiles.");
        return []; // Return empty array on error
    }
    const mapDataAddress = await readUint32(baseAddress + CONSTANTS.MAP_LAYOUT_MAPGRID_OFFSET);
    if (!mapDataAddress) {
        console.error("Failed to get main map data address.");
        return []; // Return empty array on error
    }

    // Use the constant for bytes per tile
    const mapTileBytes = mapWidth * mapHeight * CONSTANTS.BYTES_PER_TILE;

    // Ensure width/height/bytes are valid before reading range
    if (mapTileBytes <= 0) {
        console.warn(`getMainMapTiles called with invalid dimensions or zero bytes: w=${mapWidth}, h=${mapHeight}`);
        return [];
    }

    const range = await readRange(mapDataAddress, mapTileBytes);
    return range; // Assuming readRange handles its own errors or returns empty array/throws
}
