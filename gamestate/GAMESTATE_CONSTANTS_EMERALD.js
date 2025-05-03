// Note: ! in the comment means the value is different from the FRLG one

// --- Bag Memory Addresses and Constants ---

export const BAG_MAIN_ADDR = 0x02039DD8;           //! Start address of the bag pocket pointers and sizes
export const SECURITY_KEY_POINTER_ADDR = 0x03005D90; //! Address holding the pointer to the save block containing the key
export const SECURITY_KEY_OFFSET = 0x0F20;         // Offset within the save block to find the security key

export const POCKET_ENTRY_SIZE = 8; // 4 bytes for pointer, 4 bytes for capacity
export const ITEM_ENTRY_SIZE = 4;   // 2 bytes for item ID, 2 bytes for encrypted quantity
export const POCKET_COUNT = 5;      // Total number of pockets

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


// --- Party Pokémon Data Constants ---
export const IN_BATTLE_BIT_ADDR = 0x30026F9; //! Location of the bitmask determining if the player is in battle
export const IN_BATTLE_BITMASK = 0x02; // Bitmask to determine if the player is in battle
export const PARTY_BASE_ADDR = 0x020244EC; //! Base address for party Pokémon data [1]
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
export const ATTACK_OFFSET = 0x5A; // 2 bytes (u16) [1]
export const DEFENSE_OFFSET = 0x5C; // 2 bytes (u16) [1]
export const SPEED_OFFSET = 0x5E; // 2 bytes (u16) [1]
export const SP_ATTACK_OFFSET = 0x60; // 2 bytes (u16) [1]
export const SP_DEFENSE_OFFSET = 0x62; // 2 bytes (u16) [1]
export const PARTY_SIZE = 6; // Maximum number of Pokémon in a party
export const SPECIES_NONE = 0; // The species ID representing an empty slot

// --- Script Context Constants ---
// There's probably horrific issues this is going to cause down the line, but I noticed this pointer only seems to be set
// when there's an overworld text box open, so...
export const SCRIPT_CONTEXT_ADDRESS = 0x03000EB0; // Pointer to the sGlobalScriptContext object with script state
export const SCRIPT_CONTEXT_POINTER_OFFSET = 0x08; // Offset from start of sGlobalScriptContext to pointer to scriptPtr