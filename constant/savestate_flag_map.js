// c:\repositories\GeminiPlaysPokemonLive\constant\savestate_flag_map.js
import { getFlagAddress as getFlagAddressFRLG, BADGE_DEFINITIONS as BADGE_DEFINITIONS_FRLG } from './savestate_flag_map_frlg.js';
import { getFlagAddress as getFlagAddressEmerald, BADGE_DEFINITIONS as BADGE_DEFINITIONS_EMERALD } from './savestate_flag_map_emerald.js';

// Determine the game version from an environment variable
// Default to EMERALD if not specified or invalid
const gameVersion = process.env.POKEMON_GAME_VERSION?.toUpperCase() || 'EMERALD';

let selectedGetFlagAddress;
let selectedBadgeDefinitions;

if (gameVersion === 'FRLG') {
    console.log("Using FRLG gamestate constants for flags and badges.");
    selectedGetFlagAddress = getFlagAddressFRLG;
    selectedBadgeDefinitions = BADGE_DEFINITIONS_FRLG;
} else {
    // Default to EMERALD for any other value or if undefined
    if (gameVersion !== 'EMERALD') {
        console.warn(`Unknown POKEMON_GAME_VERSION "${process.env.POKEMON_GAME_VERSION}". Defaulting to EMERALD constants for flags and badges.`);
    } else {
         console.log("Using EMERALD gamestate constants for flags and badges.");
    }
    selectedGetFlagAddress = getFlagAddressEmerald;
    selectedBadgeDefinitions = BADGE_DEFINITIONS_EMERALD;
}

// Re-export the selected function and definitions
export const getFlagAddress = selectedGetFlagAddress;
export const BADGE_DEFINITIONS = selectedBadgeDefinitions;