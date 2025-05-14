import { readUint32, readRange } from '../emulatorInteraction/httpMemoryReader.js';
import * as CONSTANTS from "../constant/constants.js";

/*
* Gets the width of the backup map layout.
* Reads a u32 value from BACKUP_MAP_LAYOUT_ADDR + BACKUP_MAP_LAYOUT_WIDTH_OFFSET.
* @returns {Promise<number>} The width of the map layout.
*/
export async function getBackupMapWidth() {
   const widthAddress = CONSTANTS.BACKUP_MAP_LAYOUT_ADDR + CONSTANTS.BACKUP_MAP_LAYOUT_WIDTH_OFFSET;
   return await readUint32(widthAddress);
}

/**
* Gets the height of the backup map layout.
* Reads a u32 value from BACKUP_MAP_LAYOUT_ADDR + BACKUP_MAP_LAYOUT_HEIGHT_OFFSET.
* @returns {Promise<number>} The height of the map layout.
*/
export async function getBackupMapHeight() {
   const heightAddress = CONSTANTS.BACKUP_MAP_LAYOUT_ADDR + CONSTANTS.BACKUP_MAP_LAYOUT_HEIGHT_OFFSET;
   return await readUint32(heightAddress);
}

/**
* Gets the backup map tiles as an array of u16 values.
* First, it reads a pointer from (BACKUP_MAP_LAYOUT_ADDR + BACKUP_MAP_DATA_ADDR) to get the actual address of the tile data.
* Then, it reads the tile data from this address. Each tile is 2 bytes (u16).
* @param {number} mapWidth - The width of the map in tiles.
* @param {number} mapHeight - The height of the map in tiles.
* @returns {Promise<number[]>} The map tiles as an array of u16 values (each representing a full tile's data), or an empty array on error.
*/
export async function getBackupMapTiles(mapWidth, mapHeight) {
   // Get the address of the pointer to the map data
   const mapDataPointerAddress = CONSTANTS.BACKUP_MAP_LAYOUT_ADDR + CONSTANTS.BACKUP_MAP_DATA_ADDR;

   // Read the actual map data address (the pointer value)
   const actualMapDataAddress = await readUint32(mapDataPointerAddress);
   if (!actualMapDataAddress) {
       console.error(`Failed to get backup map data address from pointer at 0x${mapDataPointerAddress.toString(16)}.`);
       return []; // Return empty array on error
   }

   // Use the constant for bytes per tile
   const mapTileBytes = mapWidth * mapHeight * CONSTANTS.BYTES_PER_TILE;

   // Ensure width/height/bytes are valid before reading range
   if (mapTileBytes <= 0) {
       console.warn(`getBackupMapTiles called with invalid dimensions or zero bytes: w=${mapWidth}, h=${mapHeight}`);
       return [];
   }

   const rawBytes = await readRange(actualMapDataAddress, mapTileBytes);
   if (!rawBytes || rawBytes.length !== mapTileBytes) {
       console.error(`Failed to read complete backup map tile data from 0x${actualMapDataAddress.toString(16)}. Expected ${mapTileBytes} bytes, got ${rawBytes?.length || 0}.`);
       return [];
   }

   const tileValues = [];
   for (let i = 0; i < rawBytes.length; i += CONSTANTS.BYTES_PER_TILE) {
       const byte1 = rawBytes[i];
       const byte2 = rawBytes[i + 1];
       const tileValue = (byte2 << 8) | byte1; // Little Endian u16
       tileValues.push(tileValue);
   }
   return tileValues;
}

/**
* Fetches the metatile IDs for each tile in the backup map's grid.
* @returns {Promise<number[]|null>} An array of metatile IDs (u16 values, masked according to MAPGRID_METATILE_ID_MASK),
*                                   or null if there's an error fetching map dimensions or tiles.
*                                   The order of IDs corresponds to a row-major traversal of the map grid.
*/
export async function getBackupMapMetatileIds() {
   try {
       const mapWidth = await getBackupMapWidth();
       const mapHeight = await getBackupMapHeight();

       if (mapWidth <= 0 || mapHeight <= 0) {
           console.warn(`Cannot fetch backup metatile IDs for map with invalid dimensions: ${mapWidth}x${mapHeight}`);
           return null;
       }

       const tileValues = await getBackupMapTiles(mapWidth, mapHeight); // This now returns u16[]
       if (!tileValues || tileValues.length !== mapWidth * mapHeight) {
           console.error(`Failed to get valid backup tile values or count mismatch for metatile IDs. Expected ${mapWidth * mapHeight} tiles, got ${tileValues?.length || 0}.`);
           return null;
       }

       return tileValues.map(tileValue => tileValue & CONSTANTS.MAPGRID_METATILE_ID_MASK);
   } catch (error) {
       console.error("Error fetching backup map metatile IDs:", error);
       return null;
   }
}

/**
 * Gets the base address of the current map's layout structure.
 * Reads the pointer stored at CURRENT_MAP_HEADER_ADDR + MAP_HEADER_MAP_LAYOUT_OFFSET.
 * @returns {Promise<number>} The base address (pointer value).
 */
export async function getMainMapLayoutBaseAddress() {
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
 * @param {number} mapWidth The width of the map in tiles.
 * @param {number} mapHeight The height of the map in tiles.
 * @returns {Promise<number[]>} The map tiles as an array of u16 values (each representing a full tile's data), or an empty array on error.
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

    const rawBytes = await readRange(mapDataAddress, mapTileBytes);
    if (!rawBytes || rawBytes.length !== mapTileBytes) {
        console.error(`Failed to read complete map tile data from 0x${mapDataAddress.toString(16)}. Expected ${mapTileBytes} bytes, got ${rawBytes?.length || 0}.`);
        return [];
    }

    const tileValues = [];
    for (let i = 0; i < rawBytes.length; i += CONSTANTS.BYTES_PER_TILE) {
        const byte1 = rawBytes[i];
        const byte2 = rawBytes[i + 1];
        const tileValue = (byte2 << 8) | byte1; // Little Endian u16
        tileValues.push(tileValue);
    }
    return tileValues;
}

/**
 * Fetches the metatile IDs for each tile in the current map's grid.
 * @returns {Promise<number[]|null>} An array of metatile IDs (u16 values, masked according to MAPGRID_METATILE_ID_MASK),
 *                                   or null if there's an error fetching map dimensions or tiles.
 *                                   The order of IDs corresponds to a row-major traversal of the map grid.
 */
export async function getMainMapMetatileIds() {
    try {
        const mapWidth = await getMainMapWidth();
        const mapHeight = await getMainMapHeight();

        if (mapWidth <= 0 || mapHeight <= 0) {
            console.warn(`Cannot fetch metatile IDs for map with invalid dimensions: ${mapWidth}x${mapHeight}`);
            return null;
        }

        const tileValues = await getMainMapTiles(mapWidth, mapHeight); // This now returns u16[]
        if (!tileValues || tileValues.length !== mapWidth * mapHeight) {
            console.error(`Failed to get valid tile values or count mismatch for metatile IDs. Expected ${mapWidth * mapHeight} tiles, got ${tileValues?.length || 0}.`);
            return null;
        }

        return tileValues.map(tileValue => tileValue & CONSTANTS.MAPGRID_METATILE_ID_MASK);
    } catch (error) {
        console.error("Error fetching main map metatile IDs:", error);
        return null;
    }
}
