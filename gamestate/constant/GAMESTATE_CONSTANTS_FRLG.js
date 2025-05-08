// --- Bag Memory Addresses and Constants ---
export const BAG_MAIN_ADDR = 0x0203988C;                // Start address of the bag pocket pointers and sizes
export const SECURITY_KEY_POINTER_ADDR = 0x0300500C;    // Address holding the pointer to the save block containing the key
export const SECURITY_KEY_OFFSET = 0x0F20;              // Offset within the save block to find the security key

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
    "Berries"
];

// --- Player Object ---
export const PLAYER_OBJECT_POINTER_ADDR = 0x03005008; // Address of pointer to player object structure in IWRAM

// --- Party Pokémon Data Constants ---
export const IN_BATTLE_BIT_ADDR = 0x03003529; // Location of the bitmask determining if the player is in battle
export const PARTY_BASE_ADDR = 0x02024284; // Base address for party Pokémon data [1]

// --- Script Context Constants ---
// There's probably horrific issues this is going to cause down the line, but I noticed this pointer only seems to be set
// when there's an overworld text box open, so...
export const SCRIPT_CONTEXT_ADDRESS = 0x03000EB0; //! Pointer to the sGlobalScriptContext object with script state

// --- Current Map Header & Layout ---
export const CURRENT_MAP_HEADER_ADDR = 0x02036DFC; // Address of the current map header structure

// --- Map Events (Templates for Warps, NPCs, etc.) ---

// --- Live Object Events (Player + NPCs currently on screen/active) ---
export const OBJECT_EVENTS_ADDR = 0x02036E38; // Base address of gObjectEvents array

// --- Current Map Location ---
export const MAP_BANK_ADDR = 0x02031DBC; // Address of current map bank/group (u8)
export const MAP_NUMBER_ADDR = 0x02031DBD; // Address of current map number (u8)

// --- Player State ---
export const FACING_DIRECTION_ADDR = 0x02036E50; // Address containing player facing direction (among other things)