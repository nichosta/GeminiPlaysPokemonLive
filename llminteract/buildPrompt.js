// Imports from other files
import { getPartyCount, getPokemonData, isInBattle } from "../gamestate/pokemonData.js";
import { getBagContents, prettyPrintBag, getPlayerMoney } from "../gamestate/bagData.js";
import { getPartyMenuSlotId } from "../gamestate/menustate/partyMenu.js";
import { areFieldControlsLocked, getPlayerBadges, getPlayerElevation, isPlayerSurfing } from "../gamestate/overworld/playerData.js";

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

    return JSON.stringify(gameInfoObject);
}

console.log(await getGameInfoText());