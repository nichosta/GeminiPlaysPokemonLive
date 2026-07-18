// =============================================================================
// A4 milestone / quest graph self-test (offline, checked-in data)
// =============================================================================
//
//   node skills/milestones.test.js
//
// Verifies: flag bit-offsets resolved from the decomp match the known
// constants (badges=0x820, Pokédex=0x829, trainer defeat = 0x500 + id); the
// milestone ordering and critical path are intact; starter-dependent battles
// carry all three variant flags under mode "any"; currentMilestone walks the
// story DAG correctly including optional-skip behavior.
// =============================================================================

import {
    milestones,
    criticalPath,
    resolveMilestone,
    previousMilestone,
    nextMilestone,
    completionFlags,
    flagBit,
    flagNames,
    flagValues,
    isComplete,
    currentMilestone,
} from "./milestones.js";

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

const MS = milestones();
const byId = new Map(MS.map((m) => [m.id, m]));

// --- 1. Flag values resolve authoritatively from the decomp ------------------
{
    check("flagBit: FLAG_BADGE01_GET = 0x820", flagBit("FLAG_BADGE01_GET") === 0x820);
    check("flagBit: FLAG_SYS_POKEMON_GET = 0x828", flagBit("FLAG_SYS_POKEMON_GET") === 0x828);
    check("flagBit: FLAG_SYS_POKEDEX_GET = 0x829", flagBit("FLAG_SYS_POKEDEX_GET") === 0x829);
    check("flagBit: FLAG_BEAT_RIVAL_IN_OAKS_LAB = 0x258", flagBit("FLAG_BEAT_RIVAL_IN_OAKS_LAB") === 0x258);
    check("flagBit: FLAG_DEFEATED_BROCK = 0x4B0", flagBit("FLAG_DEFEATED_BROCK") === 0x4b0);
    check("flagBit: unknown flag -> undefined", flagBit("FLAG_NOPE") === undefined);

    // Trainer defeat flag = TRAINER_FLAGS_START (0x500) + trainerId.
    // Rival Oaks Lab Squirtle id = 326 -> 0x646; Brock id = 414 -> 0x69E.
    check("trainer flag: RIVAL_OAKS_LAB_SQUIRTLE = 0x646", flagBit("FLAG_DEFEATED_TRAINER_RIVAL_OAKS_LAB_SQUIRTLE") === 0x646);
    check("trainer flag: RIVAL_ROUTE22_EARLY_SQUIRTLE = 0x649", flagBit("FLAG_DEFEATED_TRAINER_RIVAL_ROUTE22_EARLY_SQUIRTLE") === 0x649);
    check("trainer flag: LEADER_BROCK = 0x69E", flagBit("FLAG_DEFEATED_TRAINER_LEADER_BROCK") === 0x69e);
}

// --- 2. Ordering + critical path --------------------------------------------
{
    check("milestones: 8 entries", MS.length === 8, `got ${MS.length}`);
    check("milestones: ordered by `order` 1..8", MS.every((m, i) => m.order === i + 1));

    const ids = MS.map((m) => m.id);
    check("first is chose_starter", ids[0] === "chose_starter");
    check("last is got_boulder_badge", ids[ids.length - 1] === "got_boulder_badge");

    const cp = criticalPath();
    check("critical path excludes optionals", !cp.includes("beat_route22_rival") && !cp.includes("got_pokeballs_topup"));
    check("critical path ends at badge", cp[cp.length - 1] === "got_boulder_badge");
    check("critical path length 6", cp.length === 6, `got ${cp.length}`);
}

// --- 3. Starter-dependent battles carry all three variants under "any" -------
{
    const lab = byId.get("beat_rival_oaks_lab");
    check("rival oaks lab: mode any", lab.completion.mode === "any");
    check("rival oaks lab: 4 flags (dedicated + 3 starter variants)", lab.completion.flags.length === 4);
    check(
        "rival oaks lab: includes all three starter trainer flags",
        ["SQUIRTLE", "BULBASAUR", "CHARMANDER"].every((s) =>
            lab.completion.flags.some((f) => f.flag.endsWith(s))
        )
    );

    const r22 = byId.get("beat_route22_rival");
    check("route22 rival: mode any", r22.completion.mode === "any");
    check("route22 rival: 3 flags (no dedicated story flag)", r22.completion.flags.length === 3);
    check("route22 rival: marked optional", r22.optional === true);

    const brock = byId.get("defeated_brock");
    check("brock: mode any (dedicated OR trainer-defeat)", brock.completion.mode === "any");
    check("brock: 2 flags", brock.completion.flags.length === 2);
}

// --- 4. Parcel milestone is item-tracked (no flags) -------------------------
{
    const parcel = byId.get("got_oaks_parcel");
    check("parcel: no completion flags (item-tracked)", parcel.completion.flags.length === 0);
    check("parcel: carries an item ref to FLAG_SYS_POKEDEX_GET", parcel.completion.item?.resolvesTo?.flag === "FLAG_SYS_POKEDEX_GET");
}

// --- 5. isComplete against a flag set ----------------------------------------
{
    const starter = byId.get("chose_starter");
    check("isComplete: starter done when flag set", isComplete(starter, new Set(["FLAG_SYS_POKEMON_GET"])));
    check("isComplete: starter not done when flag unset", !isComplete(starter, new Set()));

    // any-of: lab rival complete if any ONE variant set.
    const lab = byId.get("beat_rival_oaks_lab");
    check("isComplete: lab rival done via dedicated flag", isComplete(lab, new Set(["FLAG_BEAT_RIVAL_IN_OAKS_LAB"])));
    check("isComplete: lab rival done via a starter variant", isComplete(lab, new Set(["FLAG_DEFEATED_TRAINER_RIVAL_OAKS_LAB_BULBASAUR"])));
    check("isComplete: lab rival not done with no flags", !isComplete(lab, new Set()));
    // Two variants set still counts as complete (any-of, even if mismatched).
    check("isComplete: lab rival done with multiple variants", isComplete(lab, new Set(["FLAG_DEFEATED_TRAINER_RIVAL_OAKS_LAB_SQUIRTLE", "FLAG_DEFEATED_TRAINER_RIVAL_OAKS_LAB_CHARMANDER"])));

    const parcel = byId.get("got_oaks_parcel");
    check("isComplete: parcel incomplete before delivery (Pokedex flag unset)", !isComplete(parcel, new Set()));
    check("isComplete: parcel complete once its resolvesTo flag (Pokedex) is set", isComplete(parcel, new Set(["FLAG_SYS_POKEDEX_GET"])));
}

// --- 6. currentMilestone walks the DAG ---------------------------------------
{
    // Fresh state: nothing reached, next is chose_starter.
    let c = currentMilestone(new Set());
    check("current: nothing reached at start", c.reached === null);
    check("current: next is chose_starter", c.next?.id === "chose_starter");
    check("current: progress 0 at start", c.progress === 0);

    // Chose starter -> reached chose_starter, next is the lab rival.
    c = currentMilestone(new Set(["FLAG_SYS_POKEMON_GET"]));
    check("current: reached chose_starter", c.reached?.id === "chose_starter");
    check("current: next is beat_rival_oaks_lab", c.next?.id === "beat_rival_oaks_lab");

    // Beat the lab rival (any variant) -> reached it.
    c = currentMilestone(new Set(["FLAG_SYS_POKEMON_GET", "FLAG_BEAT_RIVAL_IN_OAKS_LAB"]));
    check("current: reached beat_rival_oaks_lab", c.reached?.id === "beat_rival_oaks_lab");
    check("current: next is got_oaks_parcel (item-tracked, unreachable by flags)",
        c.next?.id === "got_oaks_parcel");

    // Pokedex obtained: parcel is item-tracked so it can't be flag-complete,
    // but its *resolved* flag (FLAG_SYS_POKEDEX_GET) means the story has
    // advanced past it. reached should jump to got_pokedex (whose prereq,
    // got_oaks_parcel, is optional-by-flags — confirmed below).
    c = currentMilestone(new Set(["FLAG_SYS_POKEMON_GET", "FLAG_BEAT_RIVAL_IN_OAKS_LAB", "FLAG_SYS_POKEDEX_GET"]));
    check("current: reached got_pokedex after Pokédex flag", c.reached?.id === "got_pokedex");
    check("current: next is defeated_brock (skips optional Route 22 rival)",
        c.next?.id === "defeated_brock");

    // Optional skip: Route 22 rival untouched, Brock beaten — Brock still
    // counts (the optional Route 22 milestone being incomplete doesn't gate
    // a later required one).
    c = currentMilestone(new Set([
        "FLAG_SYS_POKEMON_GET",
        "FLAG_BEAT_RIVAL_IN_OAKS_LAB",
        "FLAG_SYS_POKEDEX_GET",
        "FLAG_DEFEATED_BROCK",
    ]));
    check("current: reached defeated_brock despite skipping optional Route 22", c.reached?.id === "defeated_brock");
    check("current: next is got_boulder_badge", c.next?.id === "got_boulder_badge");

    // Terminal: Boulder Badge set.
    c = currentMilestone(new Set([
        "FLAG_SYS_POKEMON_GET",
        "FLAG_BEAT_RIVAL_IN_OAKS_LAB",
        "FLAG_SYS_POKEDEX_GET",
        "FLAG_DEFEATED_BROCK",
        "FLAG_BADGE01_GET",
    ]));
    check("current: reached got_boulder_badge at terminal", c.reached?.id === "got_boulder_badge");
    check("current: no next at terminal", c.next === null);
    check("current: progress 1.0 at terminal", c.progress === 1);
}

// --- 7. prev/next + completionFlags helpers ----------------------------------
{
    check("next: chose_starter -> beat_rival_oaks_lab", nextMilestone("chose_starter")?.id === "beat_rival_oaks_lab");
    check("previous: got_boulder_badge -> defeated_brock", previousMilestone("got_boulder_badge")?.id === "defeated_brock");
    check("next: got_boulder_badge -> null (terminal)", nextMilestone("got_boulder_badge") === null);
    check("previous: chose_starter -> null (start)", previousMilestone("chose_starter") === null);
    check("resolveMilestone: by name (case-insensitive)", resolveMilestone("Received Boulder Badge")?.id === "got_boulder_badge");
    check("resolveMilestone: unknown -> null", resolveMilestone("nope") === null);
    const vals = flagValues(byId.get("got_boulder_badge"));
    check("flagValues: badge = [0x820]", vals.length === 1 && vals[0] === 0x820);
    const names = flagNames(byId.get("chose_starter"));
    check("flagNames: starter flag name present", names.includes("FLAG_SYS_POKEMON_GET"));
    check("completionFlags: returns the flag objects", completionFlags(byId.get("got_pokedex")).length === 1);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
