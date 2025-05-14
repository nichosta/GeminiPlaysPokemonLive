// c:\repositories\GeminiPlaysPokemonLive\constant\event_object_map.js
import { getEventObjectName as getEventObjectNameFRLG } from './event_object_map_frlg.js';
import { getEventObjectName as getEventObjectNameEmerald } from './event_object_map_emerald.js';

// Determine the game version from an environment variable
// Default to EMERALD if not specified or invalid
const gameVersion = process.env.POKEMON_GAME_VERSION?.toUpperCase() || 'EMERALD';

let selectedGetEventObjectName;

if (gameVersion === 'FRLG') {
    console.log("Using FRLG gamestate constants.");
    selectedGetEventObjectName = getEventObjectNameFRLG;
} else {
    // Default to EMERALD for any other value or if undefined
    if (gameVersion !== 'EMERALD') {
        console.warn(`Unknown POKEMON_GAME_VERSION "${process.env.POKEMON_GAME_VERSION}". Defaulting to EMERALD constants.`);
    } else {
         console.log("Using EMERALD gamestate constants.");
    }
    selectedGetEventObjectName = getEventObjectNameEmerald;
}

// Re-export the selected function
export const getEventObjectName = selectedGetEventObjectName;