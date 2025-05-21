// c:\repositories\GeminiPlaysPokemonLive\constant\map_map.js
import { getMapName as getMapNameFRLG } from './map_map_frlg.js';
import { getMapName as getMapNameEmerald } from './map_map_emerald.js';

// Determine the game version from an environment variable
// Default to EMERALD if not specified or invalid
const gameVersion = process.env.POKEMON_GAME_VERSION?.toUpperCase() || 'EMERALD';

let selectedGetMapName;

if (gameVersion === 'FRLG') {
    console.log("Using FRLG gamestate constants for map names.");
    selectedGetMapName = getMapNameFRLG;
} else {
    // Default to EMERALD for any other value or if undefined
    if (gameVersion !== 'EMERALD') {
        console.warn(`Unknown POKEMON_GAME_VERSION "${process.env.POKEMON_GAME_VERSION}". Defaulting to EMERALD constants.`);
    } else {
         console.log("Using EMERALD gamestate constants for map names.");
    }
    selectedGetMapName = getMapNameEmerald;
}

// Re-export the selected function
export const getMapName = selectedGetMapName;