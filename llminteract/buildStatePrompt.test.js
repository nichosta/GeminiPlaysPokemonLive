// =============================================================================
// D2 state-prompt renderer self-test (offline)
// =============================================================================
//
//   node llminteract/buildStatePrompt.test.js
//
// buildStatePrompt renders a B1 getState() snapshot as the pure text the model
// reads. This verifies the key fields surface (location, position, battle/
// dialog flags, party members, bag, the on-screen collision grid, warps, NPCs,
// read errors) and that the D2 prompt contains NO screenshot/vision wording.
// =============================================================================

import { buildStatePrompt, renderOutcomeText } from "./buildStatePrompt.js";
import { makeOutcome, OUTCOME_STATUS, STOP_REASON } from "./toolInterface.js";

let passed = 0;
let failed = 0;
function check(name, cond, detail = "") {
    if (cond) {
        passed++;
        console.log(`  ok   ${name}`);
    } else {
        failed++;
        console.error(`  FAIL ${name} ${detail}`);
    }
}

const snapshot = {
    timestamp: 1730000000000,
    player: {
        position: { x: 12, y: 8 },
        facing: "down",
        elevation: 3,
        map: { bank: 3, number: 0, name: "PALLET_TOWN" },
        movement: { surfing: false, biking: false, diving: false },
        money: 3000,
        badges: ["Boulder"],
    },
    battle: { active: false },
    progress: { controlsLocked: false },
    menu: { partyMenuOpen: false, partyMenuSlot: 7, activeTaskPtr: 0 },
    party: {
        count: 1,
        pokemon: [{
            slot: 0, nickname: "CHAR", species: "CHARMANDER", level: 5,
            currentHP: 19, maxHP: 19, hpFraction: 1.0, fainted: false,
            statusCondition: "NONE", types: ["FIRE"], ability: "BLAZE",
            moves: [{ name: "SCRATCH", pp: 35 }, { name: "GROWL", pp: 40 }],
        }],
        leadHpFraction: 1.0,
        lowestHpFraction: 1.0,
        anyFainted: false,
    },
    bag: {
        Items: [{ name: "Potion", quantity: 3 }],
        "Poke Balls": [{ name: "Poke Ball", quantity: 5 }],
    },
    map: {
        map_name: "PALLET_TOWN",
        width: 20,
        height: 18,
        map_data: [
            ["0,0:🟩", "1,0:🟥", "2,0:🌀"],
            ["0,1:🟩", "1,1:❗", "2,1:🟩"],
        ],
        warps: [{ position: [2, 0], destination: "PALLET_TOWN_PLAYER_HOUSE_1F" }],
        npcs: [{ id: 1, position: [1, 1], type: "MOM", isOffScreen: false, wandering: false }],
        connections: [{ direction: "down", mapName: "ROUTE_21" }, { mapName: "MAP_NONE" }],
        player_state: { position: [12, 8], facing: "down" },
    },
    quest: {
        reached: { id: "got_pokedex", name: "Delivered Parcel / Received Pokédex", order: 4 },
        next: { id: "defeated_brock", name: "Defeated Brock", order: 7 },
        availableOptional: [{ id: "beat_route22_rival", name: "Defeated Route 22 Rival (optional)", order: 5 }],
        progress: 0.5,
        total: 8,
    },
    errors: { "bag": "read timeout" },
    ok: false,
};

const text = buildStatePrompt(snapshot);

// --- key fields surface ---
check("renders map name", text.includes("PALLET_TOWN"));
check("renders position", text.includes("[12, 8]") && text.includes("facing down"));
check("renders elevation", text.includes("elevation 3"));
check("renders money", text.includes("3000"));
check("renders badges", text.includes("Boulder"));
check("renders in-battle flag", text.includes("In battle: false"));
check("renders controls-locked flag", text.includes("controls locked (dialog/cutscene/script): false"));
check("renders party member species", text.includes("CHARMANDER"));
check("full HP -> no low-HP hint", !text.includes("low HP — consider heal"));
check("renders a move + pp", text.includes("SCRATCH(35pp)"));
check("renders bag pouch + item", text.includes("Potion") && text.includes("x3"));
check("renders collision grid header", text.includes("collision grid"));
check("renders a walkable tile", text.includes("🟩"));
check("renders a blocked tile", text.includes("🟥"));
check("renders a warp tile", text.includes("🌀"));
check("renders warp destination", text.includes("PALLET_TOWN_PLAYER_HOUSE_1F"));
check("renders NPC", text.includes("MOM"));
check("renders connection", text.includes("ROUTE_21"));
check("renders read errors", text.includes("Read errors") && text.includes("bag: read timeout"));

// --- story / quest progress (A4 milestone graph surfaced to the model) ---
check("renders story reached milestone", text.includes("Delivered Parcel / Received Pokédex"));
check("renders story progress fraction", text.includes("(4/8)"));
check("renders next objective", text.includes("Next objective: Defeated Brock"));
check("renders available optional side content", text.includes("Side content available") && text.includes("Route 22 Rival"));

// --- quest absent (includeQuest was false) is graceful, not a crash ---
{
    const noQuest = { ...snapshot, quest: undefined };
    const t = buildStatePrompt(noQuest);
    check("missing quest -> graceful placeholder", t.includes("quest read not included this poll"));
}

// --- low HP surfaces as a NON-BLOCKING hint line (replaces the old hp_low
//     interrupt, which deadlocked the walk to a Pokécenter) ---
{
    const lowHp = {
        ...snapshot,
        party: {
            ...snapshot.party,
            lowestHpFraction: 5 / 34,
            pokemon: [{
                ...snapshot.party.pokemon[0],
                currentHP: 5, maxHP: 34,
            }],
        },
    };
    const t = buildStatePrompt(lowHp);
    check("low HP -> hint line", t.includes("low HP — consider heal"));
    check("low HP -> hint is non-blocking text (not an interrupt)",
        !t.toLowerCase().includes("interrupt"));
}
{
    // Hint also fires from the per-member fallback when lowestHpFraction is absent.
    const noFrac = {
        ...snapshot,
        party: { ...snapshot.party, lowestHpFraction: undefined, pokemon: [{ ...snapshot.party.pokemon[0], currentHP: 3, maxHP: 34 }] },
    };
    const t = buildStatePrompt(noFrac);
    check("low HP (fallback min) -> hint line", t.includes("low HP — consider heal"));
}

// --- quest read failed -> null, reported via errors, not a crash ---
{
    const failedQuest = { ...snapshot, quest: null, errors: { ...snapshot.errors, quest: "flag read failed" } };
    const t = buildStatePrompt(failedQuest);
    check("null quest -> graceful placeholder", t.includes("quest read not included this poll"));
    check("null quest -> error surfaced", t.includes("quest: flag read failed"));
}

// --- all critical-path beats complete (reached terminal, no next) ---
{
    const doneQuest = {
        ...snapshot,
        quest: {
            reached: { id: "got_boulder_badge", name: "Received Boulder Badge", order: 8 },
            next: null,
            availableOptional: [],
            progress: 1.0,
            total: 8,
        },
    };
    const t = buildStatePrompt(doneQuest);
    check("terminal reached renders order", t.includes("(8/8)"));
    check("no next objective at terminal", t.includes("all critical-path beats complete"));
}

// --- no screenshot / vision wording (D2 dropped the Cerebras call) ---
check("no 'screenshot' wording", !/screenshot/i.test(text));
check("no 'vision' wording", !/vision model/i.test(text));

// --- null snapshot is handled, not crashed ---
check("null snapshot -> graceful fallback", buildStatePrompt(null).includes("snapshot unavailable"));

// --- renderOutcomeText compactness ---
{
    const o = makeOutcome(OUTCOME_STATUS.INTERRUPTED, { stopReason: STOP_REASON.BATTLE_STARTED, stepsUsed: 4, message: "battle started", stateDelta: { map: "R22" } });
    const t = renderOutcomeText(o);
    check("outcome text has status", t.includes("status=interrupted"));
    check("outcome text has stop_reason", t.includes("stop_reason=battle_started"));
    check("outcome text has steps_used", t.includes("steps_used=4"));
    check("outcome text has message", t.includes("battle started"));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
