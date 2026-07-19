// =============================================================================
// B2 interrupt detector self-test (offline, no emulator)
// =============================================================================
//
//   node gamestate/interruptDetector.test.js
//
// `classifyInterrupt` is pure, so this exercises it directly against
// constructed getState()-shaped snapshots: one check per STOP_REASON it
// covers, the fields it deliberately leaves to C3/C5 (out_of_pp,
// about_to_faint, choice_required, blocked), and the priority order it
// resolves ties in. `watchForInterrupt`'s loop is exercised too, with a fake
// `pollState` standing in for B1's getState() so it runs with no emulator.
// =============================================================================

import { classifyInterrupt, watchForInterrupt } from "./interruptDetector.js";
import { STOP_REASON } from "../llminteract/toolInterface.js";

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

/** Minimal well-formed snapshot; overrides are shallow-merged per section. */
function makeState(overrides = {}) {
    return {
        player: { position: { x: 5, y: 5 }, map: { bank: 3, number: 0 }, ...overrides.player },
        battle: { active: false, ...overrides.battle },
        progress: { controlsLocked: false, ...overrides.progress },
        menu: { partyMenuOpen: false, ...overrides.menu },
        party: { lowestHpFraction: 1.0, ...overrides.party },
    };
}

// --- classifyInterrupt: each stop condition in isolation --------------------
{
    check("clean state -> null", classifyInterrupt(makeState()) === null);
    check("battle active -> BATTLE_STARTED", classifyInterrupt(makeState({ battle: { active: true } })) === STOP_REASON.BATTLE_STARTED);
    check("controls locked -> DIALOG", classifyInterrupt(makeState({ progress: { controlsLocked: true } })) === STOP_REASON.DIALOG);
    check(
        "party menu open -> UNEXPECTED_MENU",
        classifyInterrupt(makeState({ menu: { partyMenuOpen: true } })) === STOP_REASON.UNEXPECTED_MENU
    );
    // Low HP is intentionally NOT an interrupt (it deadlocks the walk to a
    // Pokécenter); the state prompt surfaces it as plain text instead.
    check(
        "lowest HP at threshold -> null (not an interrupt)",
        classifyInterrupt(makeState({ party: { lowestHpFraction: 0.2 } })) === null
    );
    check(
        "lowest HP at zero -> null (not an interrupt)",
        classifyInterrupt(makeState({ party: { lowestHpFraction: 0 } })) === null
    );
}

// --- classifyInterrupt: UNKNOWN_STATE on unreadable player fields -----------
{
    const noMap = makeState({ player: { position: { x: 5, y: 5 }, map: { bank: null, number: 0 } } });
    check("unreadable map bank -> UNKNOWN_STATE", classifyInterrupt(noMap) === STOP_REASON.UNKNOWN_STATE);
    const noPos = makeState({ player: { position: { x: null, y: 5 }, map: { bank: 3, number: 0 } } });
    check("unreadable position -> UNKNOWN_STATE", classifyInterrupt(noPos) === STOP_REASON.UNKNOWN_STATE);
    check("missing state -> UNKNOWN_STATE", classifyInterrupt(null) === STOP_REASON.UNKNOWN_STATE);
}

// --- classifyInterrupt: WARP_COMPLETED only fires with a baselineMap --------
{
    const moved = makeState({ player: { position: { x: 5, y: 5 }, map: { bank: 4, number: 1 } } });
    check(
        "map changed, no baseline -> null (goto's expected-progress case)",
        classifyInterrupt(moved) === null
    );
    check(
        "map changed vs baseline -> WARP_COMPLETED",
        classifyInterrupt(moved, { baselineMap: { bank: 3, number: 0 } }) === STOP_REASON.WARP_COMPLETED
    );
    check(
        "map unchanged vs baseline -> null",
        classifyInterrupt(makeState(), { baselineMap: { bank: 3, number: 0 } }) === null
    );
}

// --- classifyInterrupt: expectMenu suppresses UNEXPECTED_MENU ---------------
{
    const menuOpen = makeState({ menu: { partyMenuOpen: true } });
    check("expectMenu suppresses UNEXPECTED_MENU", classifyInterrupt(menuOpen, { expectMenu: true }) === null);
}

// --- classifyInterrupt: priority order (battle > dialog > warp > menu) -----
{
    const battleAndDialog = makeState({ battle: { active: true }, progress: { controlsLocked: true } });
    check("battle beats dialog", classifyInterrupt(battleAndDialog) === STOP_REASON.BATTLE_STARTED);

    const dialogAndWarp = makeState({
        progress: { controlsLocked: true },
        player: { position: { x: 5, y: 5 }, map: { bank: 4, number: 1 } },
    });
    check(
        "dialog beats warp",
        classifyInterrupt(dialogAndWarp, { baselineMap: { bank: 3, number: 0 } }) === STOP_REASON.DIALOG
    );

    const warpAndMenu = makeState({
        player: { position: { x: 5, y: 5 }, map: { bank: 4, number: 1 } },
        menu: { partyMenuOpen: true },
    });
    check(
        "warp beats unexpected_menu",
        classifyInterrupt(warpAndMenu, { baselineMap: { bank: 3, number: 0 } }) === STOP_REASON.WARP_COMPLETED
    );
}

// --- classifyInterrupt: out-of-scope reasons are never emitted --------------
// choice_required, out_of_pp, about_to_faint, and blocked all need context
// (a surfaced prompt, battle move data, live NPC positions) this detector
// doesn't have; only C3/C5 callers can classify them. See docs/state-snapshot.md.
{
    const outOfScope = new Set([STOP_REASON.CHOICE_REQUIRED, STOP_REASON.OUT_OF_PP, STOP_REASON.ABOUT_TO_FAINT, STOP_REASON.BLOCKED]);
    let sawOutOfScope = false;
    for (const hp of [0, 0.05, 0.5, 1]) {
        for (const menuOpen of [false, true]) {
            for (const locked of [false, true]) {
                const reason = classifyInterrupt(makeState({ party: { lowestHpFraction: hp }, menu: { partyMenuOpen: menuOpen }, progress: { controlsLocked: locked } }));
                if (reason && outOfScope.has(reason)) sawOutOfScope = true;
            }
        }
    }
    check("never emits choice_required/out_of_pp/about_to_faint/blocked", !sawOutOfScope);
}

// --- watchForInterrupt: baseline already interrupted returns immediately ----
{
    let polls = 0;
    const result = await watchForInterrupt({
        pollState: async () => {
            polls++;
            return makeState({ battle: { active: true } });
        },
        intervalMs: 5,
    });
    check("baseline interrupt: resolves on first poll", result.interrupted && result.stopReason === STOP_REASON.BATTLE_STARTED);
    check("baseline interrupt: exactly one poll", polls === 1, `got ${polls}`);
}

// --- watchForInterrupt: fires once the underlying state changes -------------
{
    let polls = 0;
    const result = await watchForInterrupt({
        pollState: async () => {
            polls++;
            return polls < 3 ? makeState() : makeState({ progress: { controlsLocked: true } });
        },
        intervalMs: 5,
    });
    check("watch loop: fires on the poll where dialog appears", result.interrupted && result.stopReason === STOP_REASON.DIALOG);
    check("watch loop: took 3 polls", polls === 3, `got ${polls}`);
}

// --- watchForInterrupt: timeout returns uninterrupted -----------------------
{
    const result = await watchForInterrupt({
        pollState: async () => makeState(),
        intervalMs: 5,
        timeoutMs: 20,
    });
    check("watch loop: timeout -> not interrupted", result.interrupted === false && result.stopReason === null);
}

// --- watchForInterrupt: expectWarp suppresses map-change false positives ----
{
    let polls = 0;
    const result = await watchForInterrupt({
        pollState: async () => {
            polls++;
            const map = polls < 3 ? { bank: 3, number: 0 } : { bank: 4, number: 1 };
            return makeState({ player: { position: { x: 5, y: 5 }, map } });
        },
        intervalMs: 5,
        timeoutMs: 40,
        expectWarp: true,
    });
    check("watch loop: expectWarp rides through a map change uninterrupted", result.interrupted === false);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
