// --- Bag Memory Addresses and Constants ---
export const BAG_MAIN_ADDR = 0x0203988c; // Start address of the bag pocket pointers and sizes
export const SECURITY_KEY_POINTER_ADDR = 0x0300500c; // Address holding the pointer to the save block containing the key
export const SECURITY_KEY_OFFSET = 0x0f20; // Offset within the save block to find the security key

// Enum-like object for pocket indices for clarity
export const POCKETS = Object.freeze({
  ITEMS: 0,
  KEY_ITEMS: 1,
  POKEBALLS: 2,
  TMS_HMS: 3,
  BERRIES: 4,
});

export const POCKET_NAMES = [
  "Items",
  "Key Items",
  "Pokeballs",
  "TMs & HMs",
  "Berries",
];

// --- Savestate Object ---
export const SAVESTATE_OBJECT_POINTER = 0x03005008; // Address of pointer to savestate 1 object structure in IWRAM
export const SAVESTATE_FLAGS_OFFSET = 0x0EE0; // Offset to player flags (u32) within savestate object

// --- Player Avatar ---
export const PLAYER_AVATAR_ADDR = 0x02037078; // Address of gPlayerAvatar struct

// --- Party Pokémon Data Constants ---
export const IN_BATTLE_BIT_ADDR = 0x03003529; // Location of the bitmask determining if the player is in battle
export const PARTY_BASE_ADDR = 0x02024284; // Base address for party Pokémon data [1]

// --- Species Info ---
export const SPECIES_INFO_ADDR = 0x08254784;

// --- Script Context Constants ---
// There's probably horrific issues this is going to cause down the line, but I noticed this pointer only seems to be set
// when there's an overworld text box open, so...
export const SCRIPT_CONTEXT_ADDRESS = 0x03000eb0; //! Pointer to the sGlobalScriptContext object with script state
export const SCRIPT_LOCK_FIELD_CONTROLS = 0x03000F9C // Address of sLockFieldControls (does what it saids)

// --- Message Box Type ---
export const FIELD_MESSAGE_BOX_ADDR = 0x0203709c; // Address of sMessageBoxType byte

// --- Backup Map Layout ---
export const BACKUP_MAP_LAYOUT_ADDR = 0x03005040; // Called VMap in FRLG

// --- All Map Headers ---
export const ALL_MAP_HEADERS_LIST_ADDR = 0x083526a8; // Address of the gMapGroups list of pointers to map headers
export const MAP_GROUP_COUNT = [
  5, 123, 60, 66, 4, 6, 8, 10, 6, 8, 20, 10, 8, 2, 10, 4, 2, 2, 2, 1, 1, 2, 2,
  3, 2, 3, 2, 1, 1, 1, 1, 7, 5, 5, 8, 8, 5, 5, 1, 1, 1, 2, 1,
];

// --- Current Map Header & Layout ---
export const CURRENT_MAP_HEADER_ADDR = 0x02036dfc; // Address of the current map header structure

// --- Mapgrid ---
export const PRIMARY_TILESET_METATILE_COUNT = 0x280; // Number of metatiles (max) listed in a tileset

// --- Map Events (Templates for Warps, NPCs, etc.) ---

// --- Live Object Events (Player + NPCs currently on screen/active) ---
export const OBJECT_EVENTS_ADDR = 0x02036e38; // Base address of gObjectEvents array

// --- Current Map Location ---
export const MAP_BANK_ADDR = 0x02031dbc; // Address of current map bank/group (u8)
export const MAP_NUMBER_ADDR = 0x02031dbd; // Address of current map number (u8)

// --- Player State ---
export const FACING_DIRECTION_ADDR = 0x02036e50; // Address containing player facing direction (among other things)

// --- Party Menu ---
export const PARTY_MENU_ADDR = 0x0203b0a0; // Address of the global party menu handler object
export const PARTY_MENU_INTERNAL_ADDR = 0x0203b09c; // Address of global party internal object pointer (check here for contents)

// --- Tasks ---
export const TASK_ARRAY_ADDR = 0x03005090; // Address of the gTasks array which holds all current tasks