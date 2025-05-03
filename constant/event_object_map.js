// c:\repositories\GeminiPlaysPokemonLive\constant\event_object_map.js
import { getEventObjectName as getEventObjectNameFRLG } from './event_object_map_frlg.js';
import { getEventObjectName as getEventObjectNameEmerald } from './event_object_map_emerald.js';

// Determine the game version from an environment variable
// Default to FRLG if not specified or invalid
const gameVersion = process.env.POKEMON_GAME_VERSION?.toUpperCase() || 'FRLG';

let selectedGetEventObjectName;

if (gameVersion === 'EMERALD') {
    console.log("Using Emerald event object name definitions.");
    selectedGetEventObjectName = getEventObjectNameEmerald;
} else {
    // Default to FRLG for any other value or if undefined
    if (gameVersion !== 'FRLG') {
        console.warn(`Unknown POKEMON_GAME_VERSION "${process.env.POKEMON_GAME_VERSION}". Defaulting to FRLG event object name definitions.`);
    } else {
         console.log("Using FRLG event object name definitions.");
    }
    selectedGetEventObjectName = getEventObjectNameFRLG;
}

// Re-export the selected function
export const getEventObjectName = selectedGetEventObjectName;
export const ACTIVE_GAME_VERSION = gameVersion; // Optionally export the version