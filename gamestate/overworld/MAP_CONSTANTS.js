// --- Player Object ---
export const PLAYER_OBJECT_POINTER_ADDR = 0x03005008; // Address of pointer to player object structure in IWRAM
export const PLAYER_X_OFFSET = 0x000; // Offset to player X coordinate (u16) within player object
export const PLAYER_Y_OFFSET = 0x002; // Offset to player Y coordinate (u16) within player object

// --- Map Layout tilesize constant ---
export const BYTES_PER_TILE = 2; // 2 bytes per tile object

// --- Backup Map Layout (used to cover map overlap) ---
export const BACKUP_MAP_LAYOUT_ADDR = 0x03005040; // Address of the backup map layout structure
export const BACKUP_MAP_LAYOUT_WIDTH_OFFSET = 0x00; // Offset to map width (u32)
export const BACKUP_MAP_LAYOUT_HEIGHT_OFFSET = 0x04; // Offset to map height (u32)
export const BACKUP_MAP_DATA_ADDR = 0x02031DFC; // Address of tile data pointer for backup map

// --- Current Map Header & Layout ---
export const CURRENT_MAP_HEADER_ADDR = 0x02036DFC; // Address of the current map header structure
export const MAP_HEADER_MAP_LAYOUT_OFFSET = 0x00; // Offset to pointer to current map layout structure (struct MapLayout *)
export const MAP_HEADER_MAP_EVENTS_OFFSET = 0x04; // Offset to pointer to MapEvents structure (struct MapEvents *)

// MapLayout struct offsets
export const MAP_LAYOUT_WIDTH_OFFSET = 0x00; // Offset to map width (u32)
export const MAP_LAYOUT_HEIGHT_OFFSET = 0x04; // Offset to map height (u32)
export const MAP_LAYOUT_DATA_OFFSET = 0x0C; // Offset to map data array pointer (const u16 *)

// --- Map Events & Warps ---
// MapEvents struct offsets
export const MAP_EVENTS_WARP_COUNT_OFFSET = 0x01; // Offset to warp count (u8)
export const MAP_EVENTS_WARPS_POINTER_OFFSET = 0x08; // Offset to warps array pointer (const struct WarpEvent *)

// WarpEvent struct (Size = 8 bytes)
export const WARP_EVENT_SIZE = 8;
export const WARP_EVENT_X_OFFSET = 0x00; // Offset to X coordinate (s16)
export const WARP_EVENT_Y_OFFSET = 0x02; // Offset to Y coordinate (s16)
export const WARP_EVENT_ELEVATION_OFFSET = 0x04; // Offset to elevation (u8)
export const WARP_EVENT_WARP_ID_OFFSET = 0x05; // Offset to warp ID (u8)
export const WARP_EVENT_MAP_NUM_OFFSET = 0x06; // Offset to destination map number (u8)
export const WARP_EVENT_MAP_GROUP_OFFSET = 0x07; // Offset to destination map group/bank (u8)

// --- Current Map Location ---
export const MAP_BANK_ADDR = 0x02031DBC; // Address of current map bank/group (u8)
export const MAP_NUMBER_ADDR = 0x02031DBD; // Address of current map number (u8)

// --- Player State ---
export const FACING_DIRECTION_ADDR = 0x02036E54; // Address containing player facing direction (among other things)
export const FACING_DIRECTION_MASK = 0x03; // Mask to isolate the 2 lowest bits for direction
// Maps the raw direction value (0-3) to a string representation
export const FACING_DIRECTION_MAP = new Map([
    [0, "down"],
    [1, "up"],
    [2, "left"],
    [3, "right"]
]);
