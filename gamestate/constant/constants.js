// c:\repositories\GeminiPlaysPokemonLive\gamestate\constants.js
import * as FRLG_CONSTANTS from "./GAMESTATE_CONSTANTS_FRLG.js";
import * as EMERALD_CONSTANTS from "./GAMESTATE_CONSTANTS_EMERALD.js";

// Determine the game version from an environment variable
// Default to EMERALD if not specified or invalid
const gameVersion =
  process.env.POKEMON_GAME_VERSION?.toUpperCase() || "EMERALD";

let selectedConstants;

if (gameVersion === "FRLG") {
  console.log("Using FRLG gamestate constants for memory addresses.");
  selectedConstants = FRLG_CONSTANTS;
} else {
  // Default to EMERALD for any other value or if undefined
  if (gameVersion !== "EMERALD") {
    console.warn(
      `Unknown POKEMON_GAME_VERSION "${process.env.POKEMON_GAME_VERSION}". Defaulting to EMERALD constants.`
    );
  } else {
    console.log("Using EMERALD gamestate constants for memory addresses.");
  }
  selectedConstants = EMERALD_CONSTANTS;
}

// --- Savestate Object ---
export const SAVESTATE_OBJECT_POINTER_ADDR =
  selectedConstants.SAVESTATE_OBJECT_POINTER;
export const SAVESTATE_PLAYER_X_OFFSET = 0x000; // Offset to player X coordinate (u16) within savestate object
export const SAVESTATE_PLAYER_Y_OFFSET = 0x002; // Offset to player Y coordinate (u16) within savestate object
export const SAVESTATE_MONEY_OFFSET = 0x490; // Offset to player money (u32) within savestate object
export const SAVESTATE_FLAGS_OFFSET = selectedConstants.SAVESTATE_FLAGS_OFFSET; // Offset to player flags (u8[]) within savestate object

// --- Player Avatar ---
export const PLAYER_AVATAR_ADDR = selectedConstants.PLAYER_AVATAR_ADDR; // Address of gPlayerAvatar struct
export const PLAYER_AVATAR_FLAGS_OFFSET = 0x00; // Offset to player avatar flags (u8)
export const PLAYER_AVATAR_FLAG_BIKING = 1 << 1 | 1 << 2; // Mask on player flags to determine if player is biking (mach or acro)
export const PLAYER_AVATAR_FLAG_SURFING = 1 << 3; // Mask on player flags to determine if player is surfing
export const PLAYER_AVATAR_FLAG_DIVING = 1 << 4; // Mask on player flags to determine if player is diving

// --- Bag ---
export const BAG_MAIN_ADDR = selectedConstants.BAG_MAIN_ADDR;
export const SECURITY_KEY_POINTER_ADDR =
  selectedConstants.SECURITY_KEY_POINTER_ADDR;
export const SECURITY_KEY_OFFSET = selectedConstants.SECURITY_KEY_OFFSET;

export const POCKET_ENTRY_SIZE = 8; // 4 bytes for pointer, 4 bytes for capacity
export const ITEM_ENTRY_SIZE = 4; // 2 bytes for item ID, 2 bytes for encrypted quantity
export const POCKET_COUNT = 5; // Total number of pockets

export const POCKETS = selectedConstants.POCKETS;
export const POCKET_NAMES = selectedConstants.POCKET_NAMES;

// --- Party Pokémon ---
export const IN_BATTLE_BIT_ADDR = selectedConstants.IN_BATTLE_BIT_ADDR;
export const IN_BATTLE_BITMASK = 0x02; // Bitmask to determine if the player is in battle

export const PARTY_BASE_ADDR = selectedConstants.PARTY_BASE_ADDR;
export const POKEMON_DATA_SIZE = 100; // Size of each Pokémon structure [1]
// Offsets within the 100-byte Pokémon structure (Unencrypted part)

// --- Constants for Pokémon Data Structure ---
export const PID_OFFSET = 0x00; // u32 [1]
export const OTID_OFFSET = 0x04; // u32 [1]
// Encrypted Block Offset (Contains Species, Item, Moves, EVs, IVs etc.)
export const ENCRYPTED_BLOCK_OFFSET = 0x20; // 48 bytes [1]
export const ENCRYPTED_BLOCK_SIZE = 48;
export const SUBSTRUCTURE_SIZE = 12;
export const NICKNAME_OFFSET = 0x08; // 10 bytes [1]
export const STATUS_OFFSET = 0x50; // 4 bytes (u32) [1]
export const LEVEL_OFFSET = 0x54; // 1 byte (u8) [1]
export const CURRENT_HP_OFFSET = 0x56; // 2 bytes (u16) [1]
export const MAX_HP_OFFSET = 0x58; // 2 bytes (u16) [1]
export const ATTACK_OFFSET = 0x5a; // 2 bytes (u16) [1]
export const DEFENSE_OFFSET = 0x5c; // 2 bytes (u16) [1]
export const SPEED_OFFSET = 0x5e; // 2 bytes (u16) [1]
export const SP_ATTACK_OFFSET = 0x60; // 2 bytes (u16) [1]
export const SP_DEFENSE_OFFSET = 0x62; // 2 bytes (u16) [1]
export const PARTY_SIZE = 6; // Maximum number of Pokémon in a party
export const SPECIES_NONE = 0; // The species ID representing an empty slot

// --- Species Data ---
export const SPECIES_INFO_ADDR = selectedConstants.SPECIES_INFO_ADDR;
export const SPECIES_INFO_SIZE = 0x1C; // Size of SpeciesInfo struct (padded)
export const SPECIES_INFO_TYPES_OFFSET = 0x06; // Offset to types (uint8[2])
export const SPECIES_INFO_ABILITIES_OFFSET = 0x16; // Offset to abilities (uint8[2])
// Script Context
export const SCRIPT_CONTEXT_ADDRESS = selectedConstants.SCRIPT_CONTEXT_ADDRESS;
export const SCRIPT_CONTEXT_POINTER_OFFSET = 0x08; // Offset from start of sGlobalScriptContext to pointer to scriptPtr
export const SCRIPT_LOCK_FIELD_CONTROLS =
  selectedConstants.SCRIPT_LOCK_FIELD_CONTROLS; // Address of sLockFieldControls (does what it saids)

// Field message box
export const FIELD_MESSAGE_BOX_ADDR = selectedConstants.FIELD_MESSAGE_BOX_ADDR;

// Export the determined version as well
export const ACTIVE_GAME_VERSION = gameVersion;

// --- Map Layout tilesize constant ---
export const BYTES_PER_TILE = 2; // 2 bytes per tile object

// Undefined tile (border)
export const MAPGRID_UNDEFINED = 0x3ff;

// --- Map Coordinate offset (used for Object Event coordinates) ---
export const MAP_OFFSET = 7;

// --- Tile Type Constants ---
export const TILE_WALKABLE = "🟩";
export const TILE_BLOCKED = "🟥";
export const TILE_WARP = "🌀";
export const TILE_NPC = "❗";
export const TILE_WATER = "🌊"; // Represents general surfable water
export const TILE_WATERFALL = "💧"; // Represents a waterfall that can be climbed with HM 
export const TILE_DIVE = "⚓"; // Represents a spot where Dive can be used
export const TILE_LEDGE_EAST = "➡️";
export const TILE_LEDGE_WEST = "⬅️";
export const TILE_LEDGE_NORTH = "⬆️";
export const TILE_LEDGE_SOUTH = "⬅️";
export const TILE_CONNECTION = "🔗";

// --- Passability Definitions ---
export const BASE_TILE_PASSABILITY = Object.freeze({
  [TILE_WALKABLE]: "walkable",
  [TILE_BLOCKED]: "blocked",
  [TILE_WATER]: "surfable water, requires Surf HM",
  [TILE_LEDGE_EAST]: "ledge (only walkable in the indicated direction)",
  [TILE_LEDGE_WEST]: "ledge (only walkable in the indicated direction)",
  [TILE_LEDGE_NORTH]: "ledge (only walkable in the indicated direction)",
  [TILE_LEDGE_SOUTH]: "ledge (only walkable in the indicated direction)",
  [TILE_WATERFALL]: "waterfall, requires Waterfall HM to ascend",
  [TILE_DIVE]: "dive spot, can be surfed over, but requires Dive HM to descend/ascend",
  [TILE_CONNECTION]: "connection to adjacent map area",
});

export const VIEWPORT_TILE_PASSABILITY = Object.freeze({
  ...BASE_TILE_PASSABILITY,
  [TILE_WARP]: "warp",
  [TILE_NPC]: "npc",
  // Ledge descriptions are inherited from BASE_TILE_PASSABILITY
  // Elevation markers are also inherited
});

// --- Viewport Dimensions ---
export const MAX_VIEWPORT_WIDTH = 15;
export const MAX_VIEWPORT_HEIGHT = 10;

// Backup Map Layout
export const BACKUP_MAP_LAYOUT_ADDR = selectedConstants.BACKUP_MAP_LAYOUT_ADDR; // Address of the gBackupMapLayout object (VMap in FRLG)
export const BACKUP_MAP_LAYOUT_WIDTH_OFFSET = 0x00; // Offset to backup map layout width (s32)
export const BACKUP_MAP_LAYOUT_HEIGHT_OFFSET = 0x04; // Offset to backup map layout height (s32)
export const BACKUP_MAP_DATA_ADDR = 0x08; // Offset to pointer to backup map layout data (*u16)

// All Map Headers
export const ALL_MAP_HEADERS_LIST_ADDR =
  selectedConstants.ALL_MAP_HEADERS_LIST_ADDR; // Pointer to pointer array, organized as [mapGroup][mapNum]
export const MAP_GROUP_COUNT = selectedConstants.MAP_GROUP_COUNT; // Array of map counts per group

// Current Map Header & Layout
export const CURRENT_MAP_HEADER_ADDR =
  selectedConstants.CURRENT_MAP_HEADER_ADDR;
export const MAP_HEADER_MAP_LAYOUT_OFFSET = 0x00; // Offset to pointer to current map layout structure (struct MapLayout *)
export const MAP_HEADER_MAP_EVENTS_OFFSET = 0x04; // Offset to pointer to MapEvents structure (struct MapEvents *)
export const MAP_HEADER_MAP_CONNECTIONS_OFFSET = 0x0c; // Offset to pointer to MapConnections structure (struct MapConnections *)

// --- Map Layout ---

// MapLayout struct offsets
export const MAP_LAYOUT_WIDTH_OFFSET = 0x00; // Offset to map width (u32)
export const MAP_LAYOUT_HEIGHT_OFFSET = 0x04; // Offset to map height (u32)
export const MAP_LAYOUT_MAPGRID_OFFSET = 0x0c; // Offset to map data array pointer (const u16 *)
export const MAP_LAYOUT_PRIMARY_TILESET_OFFSET = 0x10; // Offset to secondary tileset pointer (const struct Tileset *)
export const MAP_LAYOUT_SECONDARY_TILESET_OFFSET = 0x14; // Offset to secondary tileset pointer (const struct Tileset *)

// --- Mapgrid ---

export const MAPGRID_METATILE_ID_MASK = 0x03ff; // The part of the mapgrid info that holds the metatile ID
export const MAPGRID_COLLISION_MASK = 0x0c00; // The part of the mapgrid info that holds the collision info
export const MAPGRID_ELEVATION_MASK = 0xf000; // The part of the mapgrid info that holds the elevation info

// --- Tileset ---
export const TILESET_METATILE_ATTRIBUTES_POINTER_OFFSET = 0x10; // Offset to metatile attributes array pointer (const u16 *)
export const PRIMARY_TILESET_METATILE_COUNT =
  selectedConstants.PRIMARY_TILESET_METATILE_COUNT; // Number of metatiles (max) listed in a tileset
export const METATILE_ATTR_BEHAVIOR_MASK = 0x00ff; // Mask for the bits in a u16 metatile that correspond to behavior

// --- Map Events (Templates for Warps, NPCs, etc.) ---

// MapEvents struct offsets
export const MAP_EVENTS_NPC_COUNT_OFFSET = 0x00; // Offset to NPC template count (u8)
export const MAP_EVENTS_WARP_COUNT_OFFSET = 0x01; // Offset to warp count (u8)
export const MAP_EVENTS_NPCS_POINTER_OFFSET = 0x04; // Offset to NPC templates array pointer (const struct MapObjectTemplate *)
export const MAP_EVENTS_WARPS_POINTER_OFFSET = 0x08; // Offset to warps array pointer (const struct WarpEvent *)

// WarpEvent struct (Size = 8 bytes) - From Map Events
export const WARP_EVENT_SIZE = 8;
export const WARP_EVENT_X_OFFSET = 0x00; // Offset to X coordinate (s16)
export const WARP_EVENT_Y_OFFSET = 0x02; // Offset to Y coordinate (s16)
export const WARP_EVENT_ELEVATION_OFFSET = 0x04; // Offset to elevation (u8)
export const WARP_EVENT_WARP_ID_OFFSET = 0x05; // Offset to warp ID (u8)
export const WARP_EVENT_MAP_NUM_OFFSET = 0x06; // Offset to destination map number (u8)
export const WARP_EVENT_MAP_GROUP_OFFSET = 0x07; // Offset to destination map group/bank (u8)

// Live Object Events
export const OBJECT_EVENTS_ADDR = selectedConstants.OBJECT_EVENTS_ADDR;
export const OBJECT_EVENTS_PLAYER_INDEX = 0; // Index of the player avatar's ObjectEvent struct
export const OBJECT_EVENT_COUNT = 16; // Number of objects to read (Player + 15 NPCs)
export const OBJECT_EVENT_SIZE = 0x24; // Size of one ObjectEvent struct (0x24 bytes)

// ObjectEvent struct offsets (relative to start of one 32-byte struct)
export const OBJECT_EVENT_FLAGS_OFFSET = 0x00; // Offset to the 32-bit flags field (u32)
export const OBJECT_EVENT_GRAPHICS_ID_OFFSET = 0x05; // Offset to graphics ID (u8)
export const OBJECT_EVENT_MOVEMENT_TYPE_OFFSET = 0x06; // Offest to object event movement type (u8)
export const OBJECT_EVENT_ELEVATION_OFFSET = 0x0b; // Offset to the 8-bit current and previous elevation (u8)
export const OBJECT_EVENT_CURRENT_ELEVATION_MASK = 0x0f; // Mask to isolate the current elevation
export const OBJECT_EVENT_X_OFFSET = 0x10; // Offset to current X coordinate (s16)
export const OBJECT_EVENT_Y_OFFSET = 0x12; // Offset to current Y coordinate (s16)
export const OBJECT_EVENT_ACTIVE_BIT = 0; // Bit 0: 1 = Active
export const OBJECT_EVENT_FROZEN_BIT = 8; // Bit 8: 1 = Frozen/Inactive movement
export const OBJECT_EVENT_OFFSCREEN_BIT = 14; // Bit 14: 1 = Offscreen/Inactive rendering (technically this gives an extra tile of buffer but I don't care)
export const OBJECT_EVENT_WANDERING_TYPES = [0x2, 0x3, 0x4, 0x5, 0x6]; // Types for the movement type byte which indicate the NPC wanders around on the map

// --- Map Connections ---

// MapConnections struct offsets
export const MAP_CONNECTIONS_COUNT_OFFSET = 0x00; // Offset to connection count (s32)
export const MAP_CONNECTIONS_CONNECTION_POINTER_OFFSET = 0x04; // Offset to connections array pointer (const struct MapConnection *)

// MapConnection struct offsets
export const MAP_CONNECTION_SIZE = 0x0c; // Size of one MapConnection struct (0x0C bytes)
export const MAP_CONNECTION_DIRECTION_OFFSET = 0x00; // Offset to direction (u8 padded)
export const MAP_CONNECTION_OFFSET_OFFSET = 0x04; // Offset to "offset" field (s32)
export const MAP_CONNECTION_MAP_GROUP_OFFSET = 0x08; // Offset to destination map group (u8)
export const MAP_CONNECTION_MAP_NUM_OFFSET = 0x09; // Offset to destination map num (u8)
// 2 bytes padding

// Current Map Location
export const MAP_BANK_ADDR = selectedConstants.MAP_BANK_ADDR;
export const MAP_NUMBER_ADDR = selectedConstants.MAP_NUMBER_ADDR;

// Player State
export const FACING_DIRECTION_ADDR = selectedConstants.FACING_DIRECTION_ADDR;
export const FACING_DIRECTION_MASK = 0x07; // Mask to isolate the 4 lowest bits for direction
export const FACING_DIRECTION_MAP = new Map([
  [1, "down"],
  [2, "up"],
  [3, "left"],
  [4, "right"],
]);

// --- Party Menu ---

// Party pointers
export const PARTY_MENU_ADDR = selectedConstants.PARTY_MENU_ADDR;
export const PARTY_MENU_SLOTID_OFFSET = 0x09; // Offset to slot ID (u8)
export const PARTY_MENU_INTERNAL_ADDR =
  selectedConstants.PARTY_MENU_INTERNAL_ADDR;

// --- Tasks ---
export const TASK_ARRAY_ADDR = selectedConstants.TASK_ARRAY_ADDR; // Address of the gTasks array which holds all current tasks
export const TASK_COUNT = 16; // Number of tasks in the array
export const TASK_HEAD_SENTINEL = 0xfe; // Indicator that this is the highest-priority task at the moment if it is in the prev field
export const TASK_SIZE = 0x28; // Size of one task struct in bytes
export const TASK_FUNC_PTR_OFFSET = 0x00; // Offset to function pointer
export const TASK_IS_ACTIVE_OFFSET = 0x04; // Offset to is active flag
export const TASK_PREV_OFFSET = 0x05; // Offset to prev field (= HEAD_SENTINEL if top priority task)