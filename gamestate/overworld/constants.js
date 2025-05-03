// c:\repositories\GeminiPlaysPokemonLive\gamestate\overworld\constants.js
import * as FRLG_CONSTANTS from './MAP_CONSTANTS_FRLG.js';
import * as EMERALD_CONSTANTS from './MAP_CONSTANTS_EMERALD.js';

// Determine the game version from an environment variable
// Default to FRLG if not specified or invalid
const gameVersion = process.env.POKEMON_GAME_VERSION?.toUpperCase() || 'FRLG';

let selectedConstants;

if (gameVersion === 'EMERALD') {
    console.log("Using Emerald map constants.");
    selectedConstants = EMERALD_CONSTANTS;
} else {
    // Default to FRLG for any other value or if undefined
    if (gameVersion !== 'FRLG') {
        console.warn(`Unknown POKEMON_GAME_VERSION "${process.env.POKEMON_GAME_VERSION}". Defaulting to FRLG map constants.`);
    } else {
         console.log("Using FRLG map constants.");
    }
    selectedConstants = FRLG_CONSTANTS;
}

// --- Re-export all constants from the selected set ---

// Player Object
export const PLAYER_OBJECT_POINTER_ADDR = selectedConstants.PLAYER_OBJECT_POINTER_ADDR;
export const PLAYER_X_OFFSET = selectedConstants.PLAYER_X_OFFSET;
export const PLAYER_Y_OFFSET = selectedConstants.PLAYER_Y_OFFSET;

// Map Layout tilesize constant
export const BYTES_PER_TILE = selectedConstants.BYTES_PER_TILE;

// Map Coordinate offset
export const MAP_OFFSET = selectedConstants.MAP_OFFSET;

// Backup Map Layout (Note: Emerald version might not have these defined)
export const BACKUP_MAP_LAYOUT_ADDR = selectedConstants.BACKUP_MAP_LAYOUT_ADDR;
export const BACKUP_MAP_LAYOUT_WIDTH_OFFSET = selectedConstants.BACKUP_MAP_LAYOUT_WIDTH_OFFSET;
export const BACKUP_MAP_LAYOUT_HEIGHT_OFFSET = selectedConstants.BACKUP_MAP_LAYOUT_HEIGHT_OFFSET;
export const BACKUP_MAP_DATA_ADDR = selectedConstants.BACKUP_MAP_DATA_ADDR;

// Current Map Header & Layout
export const CURRENT_MAP_HEADER_ADDR = selectedConstants.CURRENT_MAP_HEADER_ADDR;
export const MAP_HEADER_MAP_LAYOUT_OFFSET = selectedConstants.MAP_HEADER_MAP_LAYOUT_OFFSET;
export const MAP_HEADER_MAP_EVENTS_OFFSET = selectedConstants.MAP_HEADER_MAP_EVENTS_OFFSET;

// MapLayout struct offsets
export const MAP_LAYOUT_WIDTH_OFFSET = selectedConstants.MAP_LAYOUT_WIDTH_OFFSET;
export const MAP_LAYOUT_HEIGHT_OFFSET = selectedConstants.MAP_LAYOUT_HEIGHT_OFFSET;
export const MAP_LAYOUT_DATA_OFFSET = selectedConstants.MAP_LAYOUT_DATA_OFFSET;

// Map Events
export const MAP_EVENTS_NPC_COUNT_OFFSET = selectedConstants.MAP_EVENTS_NPC_COUNT_OFFSET;
export const MAP_EVENTS_WARP_COUNT_OFFSET = selectedConstants.MAP_EVENTS_WARP_COUNT_OFFSET;
export const MAP_EVENTS_NPCS_POINTER_OFFSET = selectedConstants.MAP_EVENTS_NPCS_POINTER_OFFSET;
export const MAP_EVENTS_WARPS_POINTER_OFFSET = selectedConstants.MAP_EVENTS_WARPS_POINTER_OFFSET;

// WarpEvent struct
export const WARP_EVENT_SIZE = selectedConstants.WARP_EVENT_SIZE;
export const WARP_EVENT_X_OFFSET = selectedConstants.WARP_EVENT_X_OFFSET;
export const WARP_EVENT_Y_OFFSET = selectedConstants.WARP_EVENT_Y_OFFSET;
export const WARP_EVENT_ELEVATION_OFFSET = selectedConstants.WARP_EVENT_ELEVATION_OFFSET;
export const WARP_EVENT_WARP_ID_OFFSET = selectedConstants.WARP_EVENT_WARP_ID_OFFSET;
export const WARP_EVENT_MAP_NUM_OFFSET = selectedConstants.WARP_EVENT_MAP_NUM_OFFSET;
export const WARP_EVENT_MAP_GROUP_OFFSET = selectedConstants.WARP_EVENT_MAP_GROUP_OFFSET;

// Live Object Events
export const OBJECT_EVENTS_ADDR = selectedConstants.OBJECT_EVENTS_ADDR;
export const OBJECT_EVENT_COUNT = selectedConstants.OBJECT_EVENT_COUNT;
export const OBJECT_EVENT_SIZE = selectedConstants.OBJECT_EVENT_SIZE;
export const OBJECT_EVENT_FLAGS_OFFSET = selectedConstants.OBJECT_EVENT_FLAGS_OFFSET;
export const OBJECT_EVENT_GRAPHICS_ID_OFFSET = selectedConstants.OBJECT_EVENT_GRAPHICS_ID_OFFSET;
export const OBJECT_EVENT_X_OFFSET = selectedConstants.OBJECT_EVENT_X_OFFSET;
export const OBJECT_EVENT_Y_OFFSET = selectedConstants.OBJECT_EVENT_Y_OFFSET;
export const OBJECT_EVENT_OFFSCREEN_BIT = selectedConstants.OBJECT_EVENT_OFFSCREEN_BIT;

// Current Map Location
export const MAP_BANK_ADDR = selectedConstants.MAP_BANK_ADDR;
export const MAP_NUMBER_ADDR = selectedConstants.MAP_NUMBER_ADDR;

// Player State
export const FACING_DIRECTION_ADDR = selectedConstants.FACING_DIRECTION_ADDR;
export const FACING_DIRECTION_MASK = selectedConstants.FACING_DIRECTION_MASK;
export const FACING_DIRECTION_MAP = selectedConstants.FACING_DIRECTION_MAP;

// You might want to export the determined version as well
export const ACTIVE_GAME_VERSION = gameVersion;