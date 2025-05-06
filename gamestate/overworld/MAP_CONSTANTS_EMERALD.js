// --- Player Object ---
export const PLAYER_OBJECT_POINTER_ADDR = 0x03005D8C; // Address of pointer to player object structure in IWRAM

// --- Current Map Header & Layout ---
export const CURRENT_MAP_HEADER_ADDR = 0x02037318; // Address of the current map header structure

// --- Map Events (Templates for Warps, NPCs, etc.) ---

// --- Live Object Events (Player + NPCs currently on screen/active) ---
export const OBJECT_EVENTS_ADDR = 0x02037350; // Base address of gObjectEvents array

// --- Current Map Location ---
export const MAP_BANK_ADDR = 0x020322E4; // Address of current map bank/group (u8)
export const MAP_NUMBER_ADDR = 0x020322E5; // Address of current map number (u8)

// --- Player State ---
export const FACING_DIRECTION_ADDR = 0x02037368; // Address containing player facing direction (among other things)