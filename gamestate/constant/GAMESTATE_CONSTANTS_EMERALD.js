// --- Bag Memory Addresses and Constants ---
export const BAG_MAIN_ADDR = 0x02039dd8; // Start address of the bag pocket pointers and sizes
export const SECURITY_KEY_POINTER_ADDR = 0x03005d90; // Address holding the pointer to the save block containing the key
export const SECURITY_KEY_OFFSET = 0x01f4; // Offset within the save block to find the security key

// Enum-like object for pocket indices for clarity
export const POCKETS = Object.freeze({
  ITEMS: 0,
  POKEBALLS: 1,
  TMS_HMS: 2,
  BERRIES: 3,
  KEY_ITEMS: 4,
});

export const POCKET_NAMES = [
  "Items",
  "Pokeballs",
  "TMs & HMs",
  "Berries",
  "Key Items",
];

// --- Savestate Object ---
export const SAVESTATE_OBJECT_POINTER = 0x03005d8c; // Address of pointer to savetate 1 object structure in IWRAM
export const SAVESTATE_FLAGS_OFFSET = 0x1270; // Offset to player flags (u8) within savestate object

// --- Player Avatar ---
export const PLAYER_AVATAR_ADDR = 0x02037590; // Address of gPlayerAvatar struct

// --- Party Pokémon Data Constants ---
export const IN_BATTLE_BIT_ADDR = 0x30026f9; // Location of the bitmask determining if the player is in battle
export const PARTY_BASE_ADDR = 0x020244ec; // Base address for party Pokémon data [1]

// --- Species Info ---
export const SPECIES_INFO_ADDR = 0x083203CC;

// --- Script Context Constants ---
// There's probably horrific issues this is going to cause down the line, but I noticed this pointer only seems to be set
// when there's an overworld text box open, so...
export const SCRIPT_CONTEXT_ADDRESS = 0x03000e40; // Pointer to the sGlobalScriptContext object with script state
export const SCRIPT_LOCK_FIELD_CONTROLS = 0x03000F2C // Address of sLockFieldControls (does what it saids)

// --- Field Message Box ---
export const FIELD_MESSAGE_BOX_ADDR = 0x020375BC; // Address of the sFieldMessageBoxMode byte in Emerald

// --- Backup Map Layout ---
export const BACKUP_MAP_LAYOUT_ADDR = 0x03005DC0;

// --- All Map Headers ---
export const ALL_MAP_HEADERS_LIST_ADDR = 0x08486578;
export const MAP_GROUP_COUNT = [
  57, 5, 5, 6, 7, 8, 9, 7, 7, 14, 8, 17, 10, 23, 13, 15, 15, 2, 2, 2, 3, 1, 1,
  1, 108, 61, 89, 2, 1, 13, 1, 1, 3, 1, 0,
];

// --- Current Map Header & Layout ---
export const CURRENT_MAP_HEADER_ADDR = 0x02037318; // Address of the current map header structure

// --- Mapgrid ---
export const PRIMARY_TILESET_METATILE_COUNT = 0x200; // Number of metatiles (max) listed in a tileset

// --- Map Events (Templates for Warps, NPCs, etc.) ---

// --- Live Object Events (Player + NPCs currently on screen/active) ---
export const OBJECT_EVENTS_ADDR = 0x02037350; // Base address of gObjectEvents array

// --- Current Map Location ---
export const MAP_BANK_ADDR = 0x020322e4; // Address of current map bank/group (u8)
export const MAP_NUMBER_ADDR = 0x020322e5; // Address of current map number (u8)

// --- Player State ---
export const FACING_DIRECTION_ADDR = 0x02037368; // Address containing player facing direction (among other things)

// --- Party Menu ---
export const PARTY_MENU_ADDR = 0x0203cec8; // Address of the global party menu handler object
export const PARTY_MENU_INTERNAL_ADDR = 0x0203cec4; // Address of global party internal object pointer (check here for contents)

// --- Tasks ---
export const TASK_ARRAY_ADDR = 0x03005e00; // Address of the gTasks array which holds all current tasks