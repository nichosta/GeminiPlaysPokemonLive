// Note: ! in the comment means the value is different from the FRLG one

// --- Player Object ---
export const PLAYER_OBJECT_POINTER_ADDR = 0x03005D8C; //! Address of pointer to player object structure in IWRAM
export const PLAYER_X_OFFSET = 0x000; // Offset to player X coordinate (u16) within player object
export const PLAYER_Y_OFFSET = 0x002; // Offset to player Y coordinate (u16) within player object

// --- Map Layout tilesize constant ---
export const BYTES_PER_TILE = 2; // 2 bytes per tile object

// --- Map Coordinate offset (used for Object Event coordinates) ---
export const MAP_OFFSET = 7;

// --- Backup Map Layout (used to cover map overlap) --- (I don't know where this is in Emerald and I don't really care)
// export const BACKUP_MAP_LAYOUT_ADDR = 0x03005040; // Address of the backup map layout structure
// export const BACKUP_MAP_LAYOUT_WIDTH_OFFSET = 0x00; // Offset to map width (u32)
// export const BACKUP_MAP_LAYOUT_HEIGHT_OFFSET = 0x04; // Offset to map height (u32)
// export const BACKUP_MAP_DATA_ADDR = 0x02031DFC; // Address of tile data pointer for backup map

// --- Current Map Header & Layout ---
export const CURRENT_MAP_HEADER_ADDR = 0x02037318; //! Address of the current map header structure
export const MAP_HEADER_MAP_LAYOUT_OFFSET = 0x00; // Offset to pointer to current map layout structure (struct MapLayout *)
export const MAP_HEADER_MAP_EVENTS_OFFSET = 0x04; // Offset to pointer to MapEvents structure (struct MapEvents *)

// MapLayout struct offsets
export const MAP_LAYOUT_WIDTH_OFFSET = 0x00; // Offset to map width (u32)
export const MAP_LAYOUT_HEIGHT_OFFSET = 0x04; // Offset to map height (u32)
export const MAP_LAYOUT_DATA_OFFSET = 0x0C; // Offset to map data array pointer (const u16 *)

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

// --- Live Object Events (Player + NPCs currently on screen/active) ---
export const OBJECT_EVENTS_ADDR = 0x02037350; //! Base address of gObjectEvents array
export const OBJECT_EVENT_COUNT = 16;         // Number of objects to read (Player + 15 NPCs)
export const OBJECT_EVENT_SIZE = 0x24;          // Size of one ObjectEvent struct (0x24 bytes)

// ObjectEvent struct offsets (relative to start of one 32-byte struct)
export const OBJECT_EVENT_FLAGS_OFFSET = 0x00;      // Offset to the 32-bit flags field (u32)
export const OBJECT_EVENT_GRAPHICS_ID_OFFSET = 0x05; // Offset to graphics ID (u8)
export const OBJECT_EVENT_X_OFFSET = 0x10;          // Offset to current X coordinate (s16)
export const OBJECT_EVENT_Y_OFFSET = 0x12;          // Offset to current Y coordinate (s16)
// export const OBJECT_EVENT_FACING_DIR_OFFSET = 0x19; // Offset to facing direction (u8), lower nibble matters (Not needed for current request)

// --- Current Map Location ---
export const MAP_BANK_ADDR = 0x020322E4; //! Address of current map bank/group (u8)
export const MAP_NUMBER_ADDR = 0x020322E5; //! Address of current map number (u8)

// --- Player State ---
export const FACING_DIRECTION_ADDR = 0x02037368; //! Address containing player facing direction (among other things)
export const FACING_DIRECTION_MASK = 0x07; // Mask to isolate the 4 lowest bits for direction
export const FACING_DIRECTION_MAP = new Map([
    [1, "down"],
    [2, "up"],
    [3, "left"],
    [4, "right"]
]);
