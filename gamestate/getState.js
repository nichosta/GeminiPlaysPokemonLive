// =============================================================================
// UNIFIED STATE SNAPSHOT (B1)
// =============================================================================
//
// Single entry point that consolidates the individual RAM readers scattered
// across `gamestate/` into ONE structured, serializable snapshot: player
// position/map, party, battle state, script/dialog flags, menu state, and
// (optionally) the story/quest progress from A4's milestone graph.
//
// This snapshot is the shared substrate for the rest of the harness:
//   - B2 (interrupt detector) polls it and classifies stop conditions from the
//     same fields (battle.active, progress.controlsLocked, player.map,
//     party.pokemon[].hp, menu.*) — the STOP_REASON vocabulary in
//     llminteract/toolInterface.js maps directly onto them.
//   - D2 (agent loop) builds the model prompt from it.
//   - D3 (trace logging) records it verbatim as `state_before`.
//
// Design notes:
//   - Pure aggregation. The per-field RAM reads still live in their existing
//     modules (playerData, pokemonData, bagData, …); this module only calls
//     them and shapes the result. No new memory addresses are introduced here.
//   - Per-section error isolation. A single failing reader degrades that one
//     section to null and records the error under `snapshot.errors` instead of
//     throwing away the whole snapshot — B2 must be able to poll this in a tight
//     loop without a single bad read blanking everything.
//   - Cost-aware. The map read (full tile grid + collision processing) and the
//     bag read are the expensive parts, so they are gated behind options. The
//     quest read (a flag per milestone) is gated too, OFF by default — only
//     the model-facing snapshot opts in. The fast poll B2 needs is
//     `getState({ includeMap: false, includeBag: false })`.
// =============================================================================

import { getPartyCount, getPokemonData, isInBattle } from "./pokemonData.js";
import { getBagContents, getPlayerMoney } from "./bagData.js";
import { getPartyMenuSlotId, isPartyMenuHandlerAllocated } from "./menustate/partyMenu.js";
import { getStartMenuCursorPos } from "./menustate/startMenu.js";
import { getBagItemsPocketCursorPos } from "./menustate/bagMenu.js";
import { findFirstActiveTask } from "./menustate/taskStatus.js";
import {
    getCurrentMapBank,
    getCurrentMapNumber,
    getPlayerPosition,
    getPlayerFacingDirection,
    getPlayerElevation,
    getPlayerBadges,
    readPlayerFlag,
    areFieldControlsLocked,
    isPlayerSurfing,
    isPlayerBiking,
    isPlayerDiving,
} from "./overworld/playerData.js";
import { getVisibleMapStateJson, getVisibleBackupMapStateJson, getMapStateJson } from "./overworld/mapApi.js";
import { getMapName } from "../constant/map_map.js";
import { readFlagSet, currentMilestone, milestones } from "../skills/milestones.js";

/**
 * The party-menu slot value the game reports when the party menu is closed (or
 * the Exit button is highlighted). See getPartyMenuSlotId's docstring.
 */
const PARTY_MENU_CLOSED_SLOT = 7;

/**
 * @typedef {Object} GetStateOptions
 * @property {boolean} [includeMap=true]     Read the map tile grid + collision (expensive). Set false for a fast poll.
 * @property {"visible"|"visibleBackup"|"full"} [mapMode="visibleBackup"]
 *           Which map view to fetch. "visibleBackup" mirrors the current agent
 *           loop; "visible" trims the main map; "full" returns the untrimmed map.
 * @property {boolean} [includeBag=true]     Read bag contents (moderately expensive).
 * @property {boolean} [includeParty=true]   Read the full party. Battle/HP flags need this.
 * @property {boolean} [includeQuest=false]  Read the story/quest block (a flag
 *           per milestone, so ~one RAM read per milestone). Gated OFF by default
 *           because only the model-facing snapshot (D2) uses it — interrupt
 *           detection (B2) and the macro skills don't, and they poll tightly.
 *           The agent loop opts in: `getState({ includeQuest: true })`.
 */

/**
 * Runs a reader and, on failure, records the error and returns a fallback rather
 * than letting one bad read reject the whole snapshot.
 * @template T
 * @param {Object} errors Accumulator: section name -> error message.
 * @param {string} section
 * @param {() => Promise<T>} fn
 * @param {T} fallback
 * @returns {Promise<T>}
 */
async function safeRead(errors, section, fn, fallback) {
    try {
        return await fn();
    } catch (error) {
        errors[section] = error?.message ?? String(error);
        console.error(`[getState] Failed to read "${section}":`, error);
        return fallback;
    }
}

/**
 * Normalizes a raw getPokemonData() result into the compact, prompt/trace-ready
 * shape used across the harness. Moves are paired with current PP; the heavy
 * IV/EV/ribbon fields are intentionally dropped from the snapshot.
 * @param {object|null} pokemon
 * @param {number} slot
 * @returns {object|null}
 */
function formatPartyMember(pokemon, slot) {
    if (!pokemon || typeof pokemon !== "object") {
        return null;
    }

    const moveNames = Array.isArray(pokemon.moves) ? pokemon.moves : [];
    const pp = Array.isArray(pokemon.currentPP) ? pokemon.currentPP : [];
    const moves = [];
    for (let i = 0; i < 4; i++) {
        if (!moveNames[i]) continue;
        moves.push({ name: moveNames[i], pp: pp[i] ?? null });
    }

    const currentHP = pokemon.currentHP ?? null;
    const maxHP = pokemon.maxHP ?? null;
    const hpFraction =
        currentHP !== null && maxHP ? currentHP / maxHP : null;

    return {
        slot,
        nickname: pokemon.nickname ?? null,
        species: pokemon.species ?? null,
        level: pokemon.level ?? null,
        currentHP,
        maxHP,
        hpFraction,
        fainted: currentHP === 0,
        statusCondition: pokemon.statusCondition ?? "NONE",
        types: pokemon.types ?? [],
        ability: pokemon.ability ?? null,
        moves,
    };
}

/**
 * Reads the whole party and derives convenience aggregates used by the interrupt
 * detector (lead HP fraction, lowest HP fraction, any-fainted).
 * @param {Object} errors Error accumulator.
 * @returns {Promise<object>}
 */
async function readParty(errors) {
    const count = await safeRead(errors, "party.count", getPartyCount, 0);
    const pokemon = [];
    for (let slot = 0; slot < count; slot++) {
        const raw = await safeRead(errors, `party.slot${slot}`, () => getPokemonData(slot), null);
        const formatted = formatPartyMember(raw, slot);
        if (formatted) pokemon.push(formatted);
    }

    const hpFractions = pokemon
        .map((p) => p.hpFraction)
        .filter((f) => typeof f === "number");

    return {
        count,
        pokemon,
        leadHpFraction: pokemon.length ? pokemon[0].hpFraction : null,
        lowestHpFraction: hpFractions.length ? Math.min(...hpFractions) : null,
        anyFainted: pokemon.some((p) => p.fainted),
    };
}

/**
 * Reads the player/overworld block: position, facing, map identity, elevation,
 * movement mode, money, and badges.
 * @param {Object} errors Error accumulator.
 * @returns {Promise<object>}
 */
async function readPlayer(errors) {
    const mapBank = await safeRead(errors, "player.mapBank", getCurrentMapBank, null);
    const mapNumber = await safeRead(errors, "player.mapNumber", getCurrentMapNumber, null);
    const position = await safeRead(errors, "player.position", getPlayerPosition, [null, null]);
    const facing = await safeRead(errors, "player.facing", getPlayerFacingDirection, "unknown");
    const elevation = await safeRead(errors, "player.elevation", getPlayerElevation, null);
    const surfing = await safeRead(errors, "player.surfing", isPlayerSurfing, false);
    const biking = await safeRead(errors, "player.biking", isPlayerBiking, false);
    const diving = await safeRead(errors, "player.diving", isPlayerDiving, false);
    const money = await safeRead(errors, "player.money", getPlayerMoney, null);
    const badges = await safeRead(errors, "player.badges", getPlayerBadges, []);

    return {
        position: { x: position[0], y: position[1] },
        facing,
        elevation,
        map: {
            bank: mapBank,
            number: mapNumber,
            name: mapBank !== null && mapNumber !== null ? getMapName(mapBank, mapNumber) : null,
        },
        movement: { surfing, biking, diving },
        money,
        badges,
    };
}

/**
 * Reads the map view for the requested mode.
 * @param {"visible"|"visibleBackup"|"full"} mapMode
 * @returns {Promise<object|null>}
 */
function readMap(mapMode) {
    if (mapMode === "visible") return getVisibleMapStateJson();
    if (mapMode === "full") return getMapStateJson();
    return getVisibleBackupMapStateJson();
}

/**
 * Reads the story/quest block: which milestone the player has furthest reached,
 * the next critical-path target, and any optional side content that's available
 * — derived the same way D4's eval harness derives it (readFlagSet over the
 * runtime readPlayerFlag, then currentMilestone walks the A4 story DAG). This is
 * what surfaces "where am I in the run toward Brock" to the model in D2's
 * prompt, instead of leaving it to infer progress from badges + party alone.
 *
 * The milestone objects are large (they carry their full flag sets); only the
 * id/name/order are kept here so the snapshot/trace stay compact. The full
 * graph is available via skills/milestones.js when needed.
 *
 * @param {Object} errors Error accumulator.
 * @returns {Promise<object>}
 */
async function readQuest(errors) {
    const setFlags = await readFlagSet(readPlayerFlag);
    const cur = currentMilestone(setFlags);
    const total = milestones().length;
    const reached = cur.reached
        ? { id: cur.reached.id, name: cur.reached.name, order: cur.reached.order }
        : null;
    const next = cur.next
        ? { id: cur.next.id, name: cur.next.name, order: cur.next.order }
        : null;
    const availableOptional = (cur.availableOptional ?? []).map((m) => ({
        id: m.id, name: m.name, order: m.order,
    }));
    return { reached, next, availableOptional, progress: cur.progress, total };
}

/**
 * Consolidated game-state snapshot. Aggregates every relevant RAM reader into a
 * single structured, JSON-serializable object.
 *
 * @param {GetStateOptions} [options]
 * @returns {Promise<object>} snapshot with sections: player, party, battle,
 *          progress, menu, and (optionally) bag, map, and quest. `errors`
 *          lists any sections that failed to read; `ok` is true when none did.
 */
export async function getState(options = {}) {
    const {
        includeMap = true,
        mapMode = "visibleBackup",
        includeBag = true,
        includeParty = true,
        includeQuest = false,
    } = options;

    const errors = {};

    const player = await readPlayer(errors);
    const active = await safeRead(errors, "battle.active", isInBattle, false);
    const controlsLocked = await safeRead(errors, "progress.controlsLocked", areFieldControlsLocked, false);

    const partyMenuSlot = await safeRead(errors, "menu.partyMenuSlot", getPartyMenuSlotId, PARTY_MENU_CLOSED_SLOT);
    const partyMenuHandlerAllocated = await safeRead(errors, "menu.partyMenuHandlerAllocated", isPartyMenuHandlerAllocated, false);
    const activeTaskPtr = await safeRead(errors, "menu.activeTask", findFirstActiveTask, 0);
    const startMenuCursorPos = await safeRead(errors, "menu.startMenuCursorPos", getStartMenuCursorPos, null);
    const bagItemsPocketCursorPos = await safeRead(errors, "menu.bagItemsPocketCursorPos", getBagItemsPocketCursorPos, null);

    const snapshot = {
        timestamp: Date.now(),
        player,
        battle: { active },
        // Script/dialog/cutscene lock. When true the field controls are frozen,
        // which B2 reads as the DIALOG stop condition.
        progress: { controlsLocked },
        menu: {
            // Gated on partyMenuHandlerAllocated too: the slot byte is
            // zero-initialized at boot (reads as slot 0, not the documented
            // closed value 7) until the game has opened+closed the menu at
            // least once. Without this gate, a save that never opened the
            // party menu yet reads as permanently "open" — see
            // isPartyMenuHandlerAllocated's docstring.
            partyMenuOpen: partyMenuHandlerAllocated && partyMenuSlot !== PARTY_MENU_CLOSED_SLOT,
            partyMenuSlot,
            activeTaskPtr,
            startMenuCursorPos,
            bagItemsPocketCursorPos,
        },
    };

    if (includeParty) {
        snapshot.party = await readParty(errors);
    }

    if (includeBag) {
        snapshot.bag = await safeRead(errors, "bag", getBagContents, null);
    }

    if (includeMap) {
        snapshot.map = await safeRead(errors, "map", () => readMap(mapMode), null);
    }

    if (includeQuest) {
        snapshot.quest = await safeRead(errors, "quest", readQuest, null);
    }

    snapshot.errors = errors;
    snapshot.ok = Object.keys(errors).length === 0;
    return snapshot;
}
