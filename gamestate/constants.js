// c:\repositories\GeminiPlaysPokemonLive\gamestate\constants.js
import * as FRLG_CONSTANTS from './GAMESTATE_CONSTANTS_FRLG.js';
import * as EMERALD_CONSTANTS from './GAMESTATE_CONSTANTS_EMERALD.js';

// Determine the game version from an environment variable
// Default to FRLG if not specified or invalid
const gameVersion = process.env.POKEMON_GAME_VERSION?.toUpperCase() || 'FRLG';

let selectedConstants;

if (gameVersion === 'EMERALD') {
    console.log("Using Emerald constants.");
    selectedConstants = EMERALD_CONSTANTS;
} else {
    // Default to FRLG for any other value or if undefined
    if (gameVersion !== 'FRLG') {
        console.warn(`Unknown POKEMON_GAME_VERSION "${process.env.POKEMON_GAME_VERSION}". Defaulting to FRLG constants.`);
    } else {
         console.log("Using FRLG constants.");
    }
    selectedConstants = FRLG_CONSTANTS;
}

// --- Re-export all constants from the selected set ---

// Bag
export const BAG_MAIN_ADDR = selectedConstants.BAG_MAIN_ADDR;
export const SECURITY_KEY_POINTER_ADDR = selectedConstants.SECURITY_KEY_POINTER_ADDR;
export const SECURITY_KEY_OFFSET = selectedConstants.SECURITY_KEY_OFFSET;
export const POCKET_ENTRY_SIZE = selectedConstants.POCKET_ENTRY_SIZE;
export const ITEM_ENTRY_SIZE = selectedConstants.ITEM_ENTRY_SIZE;
export const POCKET_COUNT = selectedConstants.POCKET_COUNT;
export const POCKETS = selectedConstants.POCKETS;
export const POCKET_NAMES = selectedConstants.POCKET_NAMES;

// Party Pokémon
export const IN_BATTLE_BIT_ADDR = selectedConstants.IN_BATTLE_BIT_ADDR;
export const IN_BATTLE_BITMASK = selectedConstants.IN_BATTLE_BITMASK;
export const PARTY_BASE_ADDR = selectedConstants.PARTY_BASE_ADDR;
export const POKEMON_DATA_SIZE = selectedConstants.POKEMON_DATA_SIZE;

// Pokémon Data Structure
export const PID_OFFSET = selectedConstants.PID_OFFSET;
export const OTID_OFFSET = selectedConstants.OTID_OFFSET;
export const ENCRYPTED_BLOCK_OFFSET = selectedConstants.ENCRYPTED_BLOCK_OFFSET;
export const ENCRYPTED_BLOCK_SIZE = selectedConstants.ENCRYPTED_BLOCK_SIZE;
export const SUBSTRUCTURE_SIZE = selectedConstants.SUBSTRUCTURE_SIZE;
export const NICKNAME_OFFSET = selectedConstants.NICKNAME_OFFSET;
export const STATUS_OFFSET = selectedConstants.STATUS_OFFSET;
export const LEVEL_OFFSET = selectedConstants.LEVEL_OFFSET;
export const CURRENT_HP_OFFSET = selectedConstants.CURRENT_HP_OFFSET;
export const MAX_HP_OFFSET = selectedConstants.MAX_HP_OFFSET;
export const ATTACK_OFFSET = selectedConstants.ATTACK_OFFSET;
export const DEFENSE_OFFSET = selectedConstants.DEFENSE_OFFSET;
export const SPEED_OFFSET = selectedConstants.SPEED_OFFSET;
export const SP_ATTACK_OFFSET = selectedConstants.SP_ATTACK_OFFSET;
export const SP_DEFENSE_OFFSET = selectedConstants.SP_DEFENSE_OFFSET;
export const PARTY_SIZE = selectedConstants.PARTY_SIZE;
export const SPECIES_NONE = selectedConstants.SPECIES_NONE;

// Script Context
export const SCRIPT_CONTEXT_ADDRESS = selectedConstants.SCRIPT_CONTEXT_ADDRESS;
export const SCRIPT_CONTEXT_POINTER_OFFSET = selectedConstants.SCRIPT_CONTEXT_POINTER_OFFSET;

// You might want to export the determined version as well
export const ACTIVE_GAME_VERSION = gameVersion;
