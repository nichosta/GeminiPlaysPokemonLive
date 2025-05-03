// c:\repositories\GeminiPlaysPokemonLive\constant\map_map.js
import { getMapName as getMapNameFRLG } from './map_map_frlg.js';
import { getMapName as getMapNameEmerald } from './map_map_emerald.js';

// Determine the game version from an environment variable
// Default to FRLG if not specified or invalid
const gameVersion = process.env.POKEMON_GAME_VERSION?.toUpperCase() || 'FRLG';

let selectedGetMapName;

if (gameVersion === 'EMERALD') {
    console.log("Using Emerald map name definitions.");
    selectedGetMapName = getMapNameEmerald;
} else {
    // Default to FRLG for any other value or if undefined
    if (gameVersion !== 'FRLG') {
        console.warn(`Unknown POKEMON_GAME_VERSION "${process.env.POKEMON_GAME_VERSION}". Defaulting to FRLG map name definitions.`);
    } else {
         console.log("Using FRLG map name definitions.");
    }
    selectedGetMapName = getMapNameFRLG;
}

// Re-export the selected function
export const getMapName = selectedGetMapName;
export const ACTIVE_GAME_VERSION = gameVersion; // Optionally export the version