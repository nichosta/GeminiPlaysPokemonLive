// c:\repositories\GeminiPlaysPokemonLive\gamestate\constants.js
import * as FRLG_CONSTANTS from './GAMESTATE_CONSTANTS_FRLG.js';
import * as EMERALD_CONSTANTS from './GAMESTATE_CONSTANTS_EMERALD.js';

// Determine the game version from an environment variable
// Default to FRLG if not specified or invalid
const gameVersion = process.env.POKEMON_GAME_VERSION?.toUpperCase() || 'FRLG';

let selectedConstants;

if (gameVersion === 'EMERALD') {
    console.log("Using Emerald gamestate constants.");
    selectedConstants = EMERALD_CONSTANTS;
} else {
    // Default to FRLG for any other value or if undefined
    if (gameVersion !== 'FRLG') {
        console.warn(`Unknown POKEMON_GAME_VERSION "${process.env.POKEMON_GAME_VERSION}". Defaulting to FRLG constants.`);
    } else {
         console.log("Using FRLG gamestate constants.");
    }
    selectedConstants = FRLG_CONSTANTS;
}

// --- Re-export all constants from the selected set ---

// --- Player Object ---
export const PLAYER_OBJECT_POINTER_ADDR = selectedConstants.PLAYER_OBJECT_POINTER_ADDR;
export const MONEY_OFFSET = 0x490; // Offset to player money (u32) within player object

// Bag
export const BAG_MAIN_ADDR = selectedConstants.BAG_MAIN_ADDR;
export const SECURITY_KEY_POINTER_ADDR = selectedConstants.SECURITY_KEY_POINTER_ADDR;
export const SECURITY_KEY_OFFSET = selectedConstants.SECURITY_KEY_OFFSET;

export const POCKET_ENTRY_SIZE = 8; // 4 bytes for pointer, 4 bytes for capacity
export const ITEM_ENTRY_SIZE = 4;   // 2 bytes for item ID, 2 bytes for encrypted quantity
export const POCKET_COUNT = 5;      // Total number of pockets

export const POCKETS = selectedConstants.POCKETS;
export const POCKET_NAMES = selectedConstants.POCKET_NAMES;

// Party Pokémon
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
export const ATTACK_OFFSET = 0x5A; // 2 bytes (u16) [1]
export const DEFENSE_OFFSET = 0x5C; // 2 bytes (u16) [1]
export const SPEED_OFFSET = 0x5E; // 2 bytes (u16) [1]
export const SP_ATTACK_OFFSET = 0x60; // 2 bytes (u16) [1]
export const SP_DEFENSE_OFFSET = 0x62; // 2 bytes (u16) [1]
export const PARTY_SIZE = 6; // Maximum number of Pokémon in a party
export const SPECIES_NONE = 0; // The species ID representing an empty slot

// Script Context
export const SCRIPT_CONTEXT_ADDRESS = selectedConstants.SCRIPT_CONTEXT_ADDRESS;
export const SCRIPT_CONTEXT_POINTER_OFFSET = 0x08;      // Offset from start of sGlobalScriptContext to pointer to scriptPtr

// Export the determined version as well
export const ACTIVE_GAME_VERSION = gameVersion;
