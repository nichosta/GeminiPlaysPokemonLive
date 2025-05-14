// Imports from other files
import { getPartyCount, getPokemonData, isInBattle } from "../gamestate/pokemonData.js";
import { getBagContents, prettyPrintBag, getPlayerMoney } from "../gamestate/bagData.js";
import { getPartyMenuSlotId } from "../gamestate/menustate/partyMenu.js";
import { areFieldControlsLocked } from "../gamestate/overworld/playerData.js";

/**
 * @description Formats the data for a single Pokemon into a readable string.
 * @param {object} pokemon The Pokemon data object.
 * @returns {string} Formatted string for the Pokemon.
 */
function formatPokemonInfo(pokemon) {
    if (!pokemon) return "Invalid Pokemon data";
    return `
    Nickname: ${pokemon.nickname}
  Species: ${pokemon.species}
  Level: ${pokemon.level}
  HP: ${pokemon.currentHP}/${pokemon.maxHP}
  Moves:
    \t${pokemon.moves[0]} (PP ${pokemon.currentPP[0]})
    \t${pokemon.moves[1]} (PP ${pokemon.currentPP[1]})
    \t${pokemon.moves[2]} (PP ${pokemon.currentPP[2]})
    \t${pokemon.moves[3]} (PP ${pokemon.currentPP[3]})
`;
}

/**
 * @description Gets the current game state information (RAM data) as a formatted string.
 * @param {object} visibleMapState The pre-fetched visible map state object.
 * @returns {Promise<string>} Formatted string containing party, inventory, location, etc.
 */
export async function getGameInfoText(visibleMapState) {
    // console.log("--- Getting Game Info (for stringification) ---"); // Less verbose logging
    let partyCount = await getPartyCount();
    let pokemonInfo = [];
    if (partyCount > 0) {
        for (let i = 0; i < partyCount; i++) {
            pokemonInfo.push(formatPokemonInfo(await getPokemonData(i)));
        }
    }

    let bagInfo = await getBagContents();
    let prettyBagInfo = prettyPrintBag(bagInfo);

    let mapStateJSON = visibleMapState; // Use the passed visibleMapState
    let inBattleStatus = await isInBattle(); // Renamed to avoid conflict with import
    let fieldControlsLocked = await areFieldControlsLocked();
    let playerMoney = await getPlayerMoney();
    let partyMenuSlot = await getPartyMenuSlotId();

    const gameInfo = `
      Map Data:\n${mapStateJSON ? JSON.stringify(mapStateJSON) : "Error: Map data unavailable."}
      In Battle: ${inBattleStatus ? "Yes" : "No"}
      ${partyMenuSlot === 7 ? "" : `Party Menu Slot: ${partyMenuSlot} (${(await getPokemonData(partyMenuSlot)).nickname})`}
      ${inBattleStatus ? "" : `Overworld Controls Locked: ${fieldControlsLocked ? "Yes" : "No"}`}
      Party Count: ${partyCount}
      Pokemon:\n        ${pokemonInfo.length > 0 ? pokemonInfo.join("\n") : "No available pokemon"}
      Money: ${playerMoney}
      ${prettyBagInfo}`;
    return gameInfo.replace(/\n +/g, "\n").trim();
}