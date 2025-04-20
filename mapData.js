import { readUint8, readUint16, readUint32, readRange } from "./httpMemoryReader.js";

const PLAYER_OBJECT_POINTER_ADDR = 0x03005008; // Address of pointer to player object in IWRAM
const PLAYER_X_OFFSET = 0x000;
const PLAYER_Y_OFFSET = 0x002;

const BACKUP_MAP_LAYOUT_ADDR = 0x03005040; // Address of structure that contains the backup map details
const BACKUP_MAP_LAYOUT_WIDTH_OFFSET = 0x00;
const BACKUP_MAP_LAYOUT_HEIGHT_OFFSET = 0x04;

const BACKUP_MAP_DATA_ADDR = 0x02031DFC; // Address of tile data for backup map (constant)

const CURRENT_MAP_HEADER_ADDR = 0x02036DFC; // Address of current map header struct 
const MAP_HEADER_MAP_LAYOUT_OFFSET = 0x00; // Offset from above to pointer to current map layout struct

const MAP_LAYOUT_WIDTH_OFFSET = 0x00 // Offset from start of map layout struct to map width
const MAP_LAYOUT_HEIGHT_OFFSET = 0x04 // Offset ... to map height (yes, these are u32s for some reason)
const MAP_LAYOUT_DATA_OFFSET = 0x0C // Offset ... to map data array pointer

const MAP_BANK_ADDR = 0x02031DBC;
const MAP_NUMBER_ADDR = 0x02031DBD;

//#region Map addressing functions

/**
 * Gets the current map bank number.
 * @returns {Promise<number>} The map bank number.
 */
export async function getCurrentMapBank() {
    return await readUint8(MAP_BANK_ADDR); // [6]
}

/**
 * Gets the current map number within the bank.
 * @returns {Promise<number>} The map number.
 */
export async function getCurrentMapNumber() {
    return await readUint8(MAP_NUMBER_ADDR); // [6]
}

//#endregion

//#region Player Object Functions

/**
 * Gets the base address of the player/camera object structure in EWRAM.
 * Reads the pointer stored at PLAYER_OBJECT_POINTER_ADDR.
 * @returns {Promise<number>} The base address (pointer value).
 */
async function getPlayerObjectBaseAddress() {
    // Pointers in GBA are typically 32-bit
    return await readUint32(PLAYER_OBJECT_POINTER_ADDR);
}

/**
 * Gets the player's current X coordinate (in tile units).
 * Reads the pointer at 0x03005008 and adds the offset.
 * @returns {Promise<number>} The player's X coordinate.
 */
export async function getPlayerX() {
    const baseAddress = await getPlayerObjectBaseAddress();
    return await readUint16(baseAddress + PLAYER_X_OFFSET); // [6]
}

/**
 * Gets the player's current Y coordinate (in tile units).
 * Reads the pointer at 0x03005008 and adds the offset.
 * @returns {Promise<number>} The player's Y coordinate.
 */
export async function getPlayerY() {
    const baseAddress = await getPlayerObjectBaseAddress();
    return await readUint16(baseAddress + PLAYER_Y_OFFSET); // [6]
}

//#endregion

//#region Backup Map Functions

/**
 * Gets the width of the backup map layout.
 * Reads a u32 value from BACKUP_MAP_LAYOUT_ADDR + BACKUP_MAP_LAYOUT_WIDTH_OFFSET.
 * @returns {Promise<number>} The width of the map layout.
 */
async function getBackupMapWidth() {
    const widthAddress = BACKUP_MAP_LAYOUT_ADDR + BACKUP_MAP_LAYOUT_WIDTH_OFFSET;
    return await readUint32(widthAddress);
}

/**
 * Gets the height of the backup map layout.
 * Reads a u32 value from BACKUP_MAP_LAYOUT_ADDR + BACKUP_MAP_LAYOUT_HEIGHT_OFFSET.
 * @returns {Promise<number>} The height of the map layout.
 */
async function getBackupMapHeight() {
    const heightAddress = BACKUP_MAP_LAYOUT_ADDR + BACKUP_MAP_LAYOUT_HEIGHT_OFFSET;
    return await readUint32(heightAddress);
}

/**
 * Gets the backup map tiles.
 * Reads a range of bytes from BACKUP_MAP_DATA_ADDR.
 * @param {number} mapWidth - The width of the map.
 * @param {number} mapHeight - The height of the map.
 * @returns {Promise<Array>} The map tiles.
 */
async function getBackupMapTiles(mapWidth, mapHeight) {
    let mapTiles = mapWidth * mapHeight * 2;

    let range = [];
    
    let offset = 0;

    while (mapTiles > 1024) {
        range = range.concat(await readRange(BACKUP_MAP_DATA_ADDR + offset, 1024));
        mapTiles -= 1024;
        offset += 1024;
    }
    range = range.concat(await readRange(BACKUP_MAP_DATA_ADDR + offset, mapTiles));

    return range;
}

//#endregion

//#region Main Map Functions

/**
 * Gets the base address of the current map's layout structure.
 * Reads the pointer stored at CURRENT_MAP_HEADER_ADDR + MAP_HEADER_MAP_LAYOUT_OFFSET.
 * @returns {Promise<number>} The base address (pointer value).
 */
async function getMainMapLayoutBaseAddress() {
    return await readUint32(CURRENT_MAP_HEADER_ADDR + MAP_HEADER_MAP_LAYOUT_OFFSET);
}

/**
 * Gets the width of the current map layout.
 * Reads a u32 value from the map layout struct + MAP_LAYOUT_WIDTH_OFFSET.
 * @returns {Promise<number>} The width of the map layout.
 */
async function getMainMapWidth() {
    const baseAddress = await getMainMapLayoutBaseAddress();
    return await readUint32(baseAddress + MAP_LAYOUT_WIDTH_OFFSET);
}

/**
 * Gets the height of the current map layout.
 * Reads a u32 value from the map layout struct + MAP_LAYOUT_HEIGHT_OFFSET.
 * @returns {Promise<number>} The height of the map layout.
 */
async function getMainMapHeight() {
    const baseAddress = await getMainMapLayoutBaseAddress();
    return await readUint32(baseAddress + MAP_LAYOUT_HEIGHT_OFFSET);
}

/**
 * Gets the current map tiles.
 * Reads a range of bytes from the map data address.
 * @param {number} mapWidth - The width of the map.
 * @param {number} mapHeight - The height of the map.
 * @returns {Promise<Array>} The map tiles.
 */
async function getMainMapTiles(mapWidth, mapHeight) {
    const baseAddress = await getMainMapLayoutBaseAddress();
    const mapDataAddress = await readUint32(baseAddress + MAP_LAYOUT_DATA_OFFSET);

    let mapTiles = mapWidth * mapHeight * 2;

    let range = [];
    
    let offset = 0;

    while (mapTiles > 1024) {
        range = range.concat(await readRange(mapDataAddress + offset, 1024));
        mapTiles -= 1024;
        offset += 1024;
    }
    range = range.concat(await readRange(mapDataAddress + offset, mapTiles));

    return range;
}

//#endregion

//#region Tilemap processing function

/**
 * Processes memory data (an array of hex numbers) to extract and display a tile map
 * based on specific bits within 16-bit words derived from the data.
 *
 * @param {number[]} memory_data - A flat array of numbers, where each number is a
 * byte (e.g., [255, 3, 0, 26, ...]).
 * @returns {string} The formatted tile map as a multi-line string.
 * Returns an empty string if input is invalid or results in no map data.
 */
function processMemoryDataToTilemap(memory_data, width, playerX, playerY) {
    // --- Input Validation ---
    if (!Array.isArray(memory_data) || memory_data.length === 0) {
      console.error("Invalid input: memory_data must be a non-empty array.");
      return "";
    }

    // Turn data into hex strings
    memory_data = memory_data.map(byte =>
        byte.toString(16).padStart(2, '0').toUpperCase()
    );
  
    // --- Step 1: Reshape flat data into a grid ---
    // Group the flat memory_data array into rows of a specific width.
    const grid = [];
    const rowWidth = width; // Each row consists of (width) hex strings (bytes)
    for (let i = 0; i < memory_data.length; i += rowWidth) {
      // Slice the flat array into chunks representing rows
      grid.push(memory_data.slice(i, i + rowWidth));
    }
  
    // --- Step 2: Group bytes into pairs (words) within each row ---
    // Each row (width bytes) is further processed into width/2 pairs (16-bit words).
    const byte_grid = grid.map(row => {
      const rowPairs = [];
      for (let j = 0; j < row.length; j += 2) {
        // Ensure we always take pairs of bytes. Slice handles array boundaries.
        if (j + 1 < row.length) {
             rowPairs.push(row.slice(j, j + 2)); // Push the pair ['XX', 'YY']
        } else if (j < row.length) {
             // This case handles an odd number of bytes in the last row, if memory_data.length % width != 0
             // Depending on the data format, this might be an error or require specific handling.
             console.warn(`Warning: Row ending with an incomplete pair at index ${j}. Element: ${row[j]}`);
             // Optionally push the single element or handle as needed: rowPairs.push([row[j]]);
        }
      }
      return rowPairs; // Return the array of pairs for this row
    });
  
    // --- Step 3: Filter out specific marker pairs ---
    // Remove pairs that exactly match ['FF', '03'], which might represent empty space or delimiters.
    const formatted_grid = byte_grid.map(row =>
      // Use filter to keep only the pairs that DO NOT match ['FF', '03']
      row.filter(pair => !(pair.length === 2 && pair[0] === 'FF' && pair[1] === '03'))
    );
  
    // --- Step 4: Remove empty rows ---
    // After filtering, some rows might become empty. Remove them.
    const full_map = formatted_grid.filter(row => row.length > 0); // Keep only rows with pairs left
  
    // --- Step 5: Process each pair to generate map characters ---
    const tilemap = full_map.map(row => // Iterate through the valid rows
      row.map(pair => { // Iterate through the pairs in the current row
        // 5a. Reverse byte order and combine into a hex string
        // Example: ['1A', '00'] becomes ['00', '1A'], then joined to "001A".
        // This often handles endianness conversion (little-endian to big-endian interpretation).
        const reversedPair = pair.slice().reverse(); // Use slice() to create a copy before reversing
        const cellHex = reversedPair.join(''); // e.g., "001A"

        // 5b. Convert hex string to integer, then to 16-bit binary string
        const intValue = parseInt(cellHex, 16); // Convert hex string to a base-10 integer
        if (isNaN(intValue)) {
           // Handle cases where the hex string was invalid (e.g., contained non-hex characters)
           console.warn(`Invalid hex value encountered in pair: ${pair} -> "${cellHex}"`);
           return '?'; // Return a placeholder for invalid data
        }
        // Convert integer to binary string and pad with leading zeros to ensure 16 bits
        const binaryString = intValue.toString(2).padStart(16, '0');
  
        // 5c. Extract specific bits for collision/type information
        const collisionBits = binaryString.slice(4, 6); // Extracts the two characters, e.g., "01"
  
        // 5d. Map the extracted bits to corresponding map characters
        let character;
        switch (collisionBits) {
          case '00': character = '.'; break;
          case '01': character = '1'; break;
          case '10': character = '2'; break;
          case '11': character = '3'; break;
          default:
            // This case should technically not be reachable if binaryString is correct.
            console.warn(`Unexpected collision bits extracted: ${collisionBits} from ${binaryString}`);
            character = '?'; // Placeholder for unexpected bit patterns
        }
        return character; // Return the character ('.', '1', '2', '3', or '?') for this pair
      })
    );

    // Add an AT sign at the player's position
    tilemap[playerY][playerX] = '@';
  
    // --- Step 6: Format the tilemap into a final output string ---
    // Join the characters in each row, then join the rows with newline characters.
    const outputString = tilemap.map(row => row.join(' ')).join('\n');
  
    return outputString; // Return the final multi-line string representation of the map
}

//#endregion

//#region Collision data helper functions

// TODO: Need to figure out how to get "true" playerX and playerY as they relate to the backup map
/**
 * @deprecated
 * @see getMainMapCollisionData Do not use this function until the player location issuese are fixed
 * Retrieves the collision data for the backup map.
 * This function fetches the map's width and height, then reads the tile data.
 * It then processes this data to generate a collision map, which is returned as a string.
 *
 * @returns {Promise<string>} A string representing the collision map.
 * Each character in the string represents a tile's collision type:
 *   - '.' : Walkable
 *   - '1' : Collision type 1
 *   - '2' : Collision type 2
 *   - '3' : Collision type 3
 *   - '?' : Unknown or invalid collision type
 * The string is formatted with newline characters to represent the map's rows.
 * @throws {Error} Throws an error if there is a problem fetching or processing the map data.
 */
export async function getBackupMapCollisionData() {
    // Get the height and width of the backup map
    let width = await getBackupMapWidth();
    let height = await getBackupMapHeight();

    // console.info(`Map dimensions: ${width}x${height}`);

    // Get the set of tiles composing the backup map
    let tiles = await getBackupMapTiles(width, height);
    
    let playerX = await getPlayerX();
    let playerY = await getPlayerY();

    // Get the collision map (note this will be smaller than height * width due to truncating border tiles)
    return processMemoryDataToTilemap(tiles, width * 2, playerX, playerY);
}

/**
 * Retrieves the collision data for the main map.
 * This function fetches the map's width and height, then reads the tile data.
 * It then processes this data to generate a collision map, which is returned as a string.
 *
 * @returns {Promise<string>} A string representing the collision map.
 * Each character in the string represents a tile's collision type:
 *   - '.' : Walkable
 *   - '1' : Collision type 1
 *   - '2' : Collision type 2
 *   - '3' : Collision type 3
 *   - '?' : Unknown or invalid collision type
 * The string is formatted with newline characters to represent the map's rows.
 * @throws {Error} Throws an error if there is a problem fetching or processing the map data.
 */
export async function getMainMapCollisionData() {
    // Get the height and width of the main map
    let width = await getMainMapWidth();
    let height = await getMainMapHeight();

    // console.info(`Map dimensions: ${width}x${height}`);

    // Get the set of tiles composing the main map
    let tiles = await getMainMapTiles(width, height);

    let playerX = await getPlayerX();
    let playerY = await getPlayerY();

    // Get the collision map (note this will be smaller than height * width due to truncating border tiles)
    return processMemoryDataToTilemap(tiles, width * 2, playerX, playerY);
}