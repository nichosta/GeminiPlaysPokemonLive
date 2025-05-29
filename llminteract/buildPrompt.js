import { promises as fs } from 'fs';
import path from 'path';
// Imports from other files
import { getPartyCount, getPokemonData, isInBattle } from "../gamestate/pokemonData.js";
import { getBagContents, prettyPrintBag, getPlayerMoney } from "../gamestate/bagData.js";
import { getPartyMenuSlotId } from "../gamestate/menustate/partyMenu.js";
import { areFieldControlsLocked, getPlayerBadges, getPlayerElevation, isPlayerBiking, isPlayerDiving, isPlayerSurfing } from "../gamestate/overworld/playerData.js";

/**
 * @description Formats the data for a single Pokemon into a structured object.
 * @param {object} pokemon The Pokemon data object.
 * @returns {object|null} Formatted object for the Pokemon, or null if data is invalid.
 */
function formatPokemonInfo(pokemon) {
    if (!pokemon || typeof pokemon !== 'object') {
        return null;
    }

    const movesData = [];
    const pMoves = Array.isArray(pokemon.moves) ? pokemon.moves : [];
    const pPP = Array.isArray(pokemon.currentPP) ? pokemon.currentPP : [];

    for (let i = 0; i < 4; i++) { // Always create 4 move slots
        movesData.push({
            name: pMoves[i] || null,
            pp: pPP[i] !== undefined ? pPP[i] : null,
        });
    }

    return {
        nickname: pokemon.nickname || null,
        species: pokemon.species || null,
        level: pokemon.level !== undefined ? pokemon.level : null,
        currentHP: pokemon.currentHP !== undefined ? pokemon.currentHP : null,
        maxHP: pokemon.maxHP !== undefined ? pokemon.maxHP : null,
        moves: movesData,
        types: pokemon.types,
        ability: pokemon.ability,
        statusCondition: pokemon.statusCondition,
    };
}

/**
 * @description Gets the current game state information (RAM data) as a JSON string.
 * @param {object} visibleMapState The pre-fetched visible map state object.
 * @returns {Promise<string>} JSON string containing party, inventory, location, etc.
 */
export async function getGameInfoText(visibleMapState) {
    const gameInfoObject = {};

    gameInfoObject.mapData = visibleMapState ? visibleMapState : "Error: Map data unavailable.";

    const inBattleStatus = await isInBattle();
    gameInfoObject.inBattle = inBattleStatus;

    const partyMenuSlot = await getPartyMenuSlotId();
    if (partyMenuSlot !== 7) { // Assuming 7 means not in party menu or relevant selection
        const pokemonInSlotData = await getPokemonData(partyMenuSlot);
        gameInfoObject.partyMenuSlotInfo = {
            slot: partyMenuSlot,
            pokemonNickname: pokemonInSlotData ? (pokemonInSlotData.nickname || null) : null
        };
    }

    if (!inBattleStatus) {
        gameInfoObject.overworldControlsLocked = await areFieldControlsLocked();
        gameInfoObject.surfing = await isPlayerSurfing();
        gameInfoObject.biking = await isPlayerBiking();
        gameInfoObject.diving = await isPlayerDiving();
        gameInfoObject.elevation = await getPlayerElevation();
    }

    const partyCount = await getPartyCount();
    gameInfoObject.partyCount = partyCount;

    gameInfoObject.pokemon = [];
    if (partyCount > 0) {
        const partyPokemonData = [];
        for (let i = 0; i < partyCount; i++) {
            partyPokemonData.push(await getPokemonData(i));
        }
        partyPokemonData.forEach(pokemonData => {
            const formattedPokemon = formatPokemonInfo(pokemonData);
            if (formattedPokemon) {
                gameInfoObject.pokemon.push(formattedPokemon);
            }
        });
    }

    gameInfoObject.money = await getPlayerMoney();
    gameInfoObject.bag = await getBagContents(); // Using raw bag contents for JSON

    const badgesObtained = await getPlayerBadges();
    gameInfoObject.badges = badgesObtained || []; // Ensure it's an array, empty if no badges

    return gameInfoObject; // Return the object itself, not the stringified version
}

/**
 * @description Saves a human-readable version of the prompt data to a file.
 * @param {object} gameInfoObject The game state information object (which includes mapData).
 * @param {object} imageParts The parsed image data URI parts.
 * @param {string} twitchChatContent The raw content from Twitch chat for the current turn.
 * @param {string} filePath The path to the file where the prompt should be saved.
 * @returns {Promise<void>}
 */
export async function saveHumanReadablePromptToFile(gameInfoObject, imageParts, twitchChatContent, filePath) {
    try {
        let humanReadableString = "--- Human-Readable Prompt Details ---\n\n";

        humanReadableString += "== Current Game Screenshot ==\n";
        if (imageParts && imageParts.data) {
            humanReadableString += `MIME Type: ${imageParts.mimeType}\n`;
            humanReadableString += `Data (first 100 chars): ${imageParts.data.substring(0, 100)}...\n\n`;
        } else {
            humanReadableString += "No image data available.\n\n";
        }

        humanReadableString += "== Current Game State (RAM Data) ==\n";
        humanReadableString += JSON.stringify(gameInfoObject, null, 2) + "\n\n";

        humanReadableString += "== Collision Grid View ==\n";
        const mapDataForGrid = gameInfoObject.mapData;
        if (mapDataForGrid && typeof mapDataForGrid === 'object' && mapDataForGrid.map_data && Array.isArray(mapDataForGrid.map_data)) {
            for (const row of mapDataForGrid.map_data) {
                if (Array.isArray(row)) {
                    const rowString = row.map(tileString => {
                        if (typeof tileString === 'string') {
                            const parts = tileString.split(':');
                            return parts.length > 1 ? parts[1] : '?'; // Get the emoji part
                        }
                        return '?';
                    }).join(' ');
                    humanReadableString += rowString + '\n';
                }
            }
            humanReadableString += "\n";
        } else {
            humanReadableString += "Map data not available or in unexpected format for grid view.\n";
            if (typeof mapDataForGrid === 'string') {
                 humanReadableString += `(Reason: ${mapDataForGrid})\n`;
            }
            humanReadableString += "\n";
        }

        humanReadableString += "== Twitch Chat Messages (Current Turn) ==\n";
        humanReadableString += twitchChatContent + "\n\n";

        await fs.writeFile(filePath, humanReadableString, 'utf8');
        // console.log(`Human-readable prompt saved to ${filePath}`);
    } catch (error) {
        console.error(`Error saving human-readable prompt to ${filePath}:`, error);
    }
}