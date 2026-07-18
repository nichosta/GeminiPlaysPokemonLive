// =============================================================================
// MENU MACROS (C4)
// =============================================================================
//
// The four menu interactions the harness owns behind D1's tools:
//   - heal at a Pokécenter     (the `heal` tool, method "pokecenter")
//   - use an item from the bag (the `use_item` tool)
//   - reorder the party         (no dedicated tool — the party menu this drives
//                                is shared by `use_item`'s target step and the
//                                C3 battle engine's switch path)
//   - handle move-learn prompts (surfaces during level-up; auto-applied inside
//                                the agent loop, not a model tool)
//
// Same two-layer split as C1 (pathfinding) / C2 (crossMapRouter) / C3
// (battlePolicy):
//   - PURE helpers below build the button sequences + resolve bag/party state
//     from plain objects, fully exercised by menuMacros.test.js offline.
//   - LIVE adapters poll B1's getState(), drive the menus through B3's
//     executeQueue / advanceDialog, poll B2's classifyInterrupt, and return a
//     D1 `makeOutcome(...)` envelope — escalating to the model on any interrupt
//     in the shared STOP_REASON vocabulary.
//
// RELIABLE vs GAP-LIMITED navigation (read this before trusting a live run):
//   - The PARTY-MENU cursor IS readable from B1's snapshot
//     (`menu.partyMenuSlot`, via getPartyMenuSlotId). So navigating to a party
//     slot by re-reading the slot id after every up/down press is EXACT — no
//     guessing, no wrap-around bugs. `selectPartySlotLive` is the reliable
//     primitive the reorder / use_item-target / move-learn steps build on.
//   - The START-MENU and BAG cursors are NOT readable from B1's snapshot (no
//     RAM read exists for them yet). Navigating to the BAG entry, to a specific
//     bag pocket, or to a specific item slot therefore assumes a known cursor
//     start position and presses a counted up/down — the SAME class of gap as
//     C3's battle-move cursor (see battlePolicy.js's docstring). A wrong count
//     still presses SOMETHING valid (never a dead press) and B2 surfaces any
//     resulting odd state next poll; making it exact is downstream B-work (a
//     bag/start-menu cursor RAM read), NOT this workstream.
//   - The POKÉCENTER NURSE heal sidesteps both gaps: the nurse stands at a
//     fixed tile in every standard-layout center (verified for both pre-Brock
//     centers — Viridian 5:4, Pewter 6:5 — nurse at (7,2) behind an MB_COUNTER
//     at (7,3), so the player talks to her by standing on (7,4) facing up), and
//     the heal itself is a dialog the B3 dialog-advance primitive mashes
//     through (the YES/NO "heal your Pokémon?" prompt defaults to YES, so
//     mashing A confirms it). This is the reliable heal path; `heal method=auto`
//     prefers it when a center is reachable.
// =============================================================================

import { makeOutcome, OUTCOME_STATUS, STOP_REASON } from "../llminteract/toolInterface.js";

// -----------------------------------------------------------------------------
// Static layout: nurse-interact tile per in-scope Pokécenter.
// Keyed by "group:num". Extracted from the decomp's map.json object_events +
// the A1 static collision/behavior grid (see module docstring): both pre-Brock
// centers share FRLG's standard center layout — nurse (7,2) facing down, an
// MB_COUNTER tile (7,3) in front of her, so the player stands on the walkable
// tile (7,4) and presses up+A to talk across the counter. A center not in this
// table is an unknown layout; healAtPokecenterLive surfaces that as
// precondition_failed rather than guessing a tile.
// -----------------------------------------------------------------------------
export const POKECENTER_NURSE_INTERACT = Object.freeze({
    "5:4": { x: 7, y: 4 }, // Viridian City Pokémon Center 1F
    "6:5": { x: 7, y: 4 }, // Pewter City Pokémon Center 1F
});

// FRLG bag pocket order (matches POCKET_NAMES in GAMESTATE_CONSTANTS_FRLG.js):
// 0 Items, 1 Key Items, 2 Pokeballs, 3 TMs & HMs, 4 Berries. Used by the
// gap-limited bag navigation (press Right from pocket 0 to reach pocket N).
const POCKET_INDEX = {
    items: 0,
    "key items": 1,
    keyitems: 1,
    pokeballs: 2,
    "poke balls": 2,
    "tms & hms": 3,
    "tms&hms": 3,
    berries: 4,
};

// =============================================================================
// PURE HELPERS
// =============================================================================

/**
 * Normalizes an item name for matching: lowercase, strip spaces / apostrophes
 * / underscores, so the model's "Potion", "poke ball", "Oak's Parcel" all line
 * up with the runtime UPPER_SNAKE bag names ("POTION", "POKE_BALL",
 * "OAKS_PARCEL") the way locationGraph normalizes place names.
 * @param {string} s
 * @returns {string}
 */
function normalizeItemName(s) {
    return String(s || "")
        .toLowerCase()
        .replace(/['’]/g, "")
        .replace(/[\s_]+/g, "")
        .trim();
}

/**
 * Finds an item in a B1 bag snapshot by name. The bag is keyed by pocket name
 * (POCKET_NAMES: "Items", "Key Items", "Pokeballs", "TMs & HMs", "Berries"),
 * each a list of `{name, quantity}` (name from getItemName, UPPER_SNAKE).
 * Returns the match with its pocket + 0-based item index, or null.
 *
 * @param {object} bag A getBagContents() result (pocketName -> [{name,quantity}]).
 * @param {string} itemName
 * @returns {{pocketName:string, pocketIndex:number, itemIndex:number, name:string, quantity:number}|null}
 */
export function resolveBagItem(bag, itemName) {
    if (!bag || typeof itemName !== "string") return null;
    const want = normalizeItemName(itemName);
    if (!want) return null;
    for (const [pocketName, items] of Object.entries(bag)) {
        if (!Array.isArray(items)) continue;
        for (let i = 0; i < items.length; i++) {
            const it = items[i];
            if (!it) continue;
            if (normalizeItemName(it.name) === want) {
                const pocketIndex = POCKET_INDEX[normalizeItemName(pocketName)] ?? 0;
                return {
                    pocketName,
                    pocketIndex,
                    itemIndex: i,
                    name: it.name,
                    quantity: typeof it.quantity === "number" ? it.quantity : 0,
                };
            }
        }
    }
    return null;
}

/**
 * Pure sequence: navigate the bag to a specific pocket + item slot, assuming
 * the bag opens on pocket 0 with the cursor at item 0 (the GAP — see module
 * docstring). Returns the up/down/right presses to reach pocket `pocketIndex`,
 * item `itemIndex`, NOT including the A that enters the item's action menu
 * (the caller presses A so it can poll for the action-menu state).
 *
 * @param {number} pocketIndex 0-4.
 * @param {number} itemIndex 0-based position within the pocket.
 * @returns {string[]} button names (lowercase, executor's enum).
 */
export function buildBagNavigationSequence(pocketIndex, itemIndex) {
    const seq = [];
    // Pocket switch: Right advances one pocket in FRLG's bag (Left reverses).
    // Assume opening pocket = 0; press Right `pocketIndex` times.
    for (let i = 0; i < (pocketIndex || 0); i++) seq.push("right");
    // Item selection: Down advances one item slot. Assume opening cursor = 0.
    for (let i = 0; i < (itemIndex || 0); i++) seq.push("down");
    return seq;
}

/**
 * Pure sequence: from the start menu, navigate to the BAG entry and enter it.
 * FRLG start menu order is POKéDEX, POKéMON, BAG, <player>, SAVE, OPTION, EXIT
 * (BAG is index 2). GAP: assumes the start-menu cursor opens at index 0; the
 * real cursor remembers the last-used entry, so the down count can be off (same
 * class of gap as the bag cursor). Returns the presses up to (not including)
 * the A that enters BAG, so the caller can poll for the bag-open state.
 * @returns {string[]}
 */
export function buildStartMenuToBagSequence() {
    // Cursor assumed at top (POKéDEX); BAG is 2 entries down.
    return ["start", "down", "down"];
}

/**
 * Pure sequence: in an item's BAG action menu (Use/Register/Give/Cancel),
 * select "Use". GAP: assumes the cursor opens on "Use" (index 0), which is the
 * usual default for usable items; key items open on "Register" or "Give" and
 * the count would be off. Caller presses A after, then polls for the party-menu
 * or result state.
 * @returns {string[]}
 */
export function buildUseActionSequence() {
    return []; // "Use" is the default cursor; no navigation needed, just A.
}

/**
 * Pure sequence: decline a move-learn prompt (press B → "No"). The safest
 * default for the harness — it never overwrites a move the model might want
 * without the model asking. The model can opt INTO learning via press, or a
 * future tool arg, once the live path is reliable.
 * @returns {string[]}
 */
export function buildMoveLearnDeclineSequence() {
    return ["b"];
}

/**
 * Pure sequence: accept a move-learn prompt and replace slot `replaceSlot`
 * (0-3). YES is the default on the "want to learn?" prompt (press A); the
 * "which move to forget?" menu then opens with the 4 current moves + the new
 * one. GAP: the move-forget cursor's start position is not readable (same gap
 * class as the battle-move cursor); press Down `replaceSlot` times assuming it
 * opens on slot 0. Caller polls.
 * @param {number} replaceSlot 0-3.
 * @returns {string[]}
 */
export function buildMoveLearnAcceptSequence(replaceSlot) {
    const seq = ["a"]; // accept "learn" (YES default)
    for (let i = 0; i < (replaceSlot || 0); i++) seq.push("down");
    seq.push("a"); // confirm the slot to replace
    return seq;
}

/**
 * Direction to move the party-menu cursor from `from` to `to` (re-read each
 * press in the live loop, so wrap-around is handled by polling, not by this).
 * @param {number} from current partyMenuSlot
 * @param {number} to target slot
 * @returns {"up"|"down"|null} null if already there.
 */
export function partySlotDirection(from, to) {
    if (from === to) return null;
    return to > from ? "down" : "up";
}

// =============================================================================
// LIVE ADAPTER: party-menu slot selection (RELIABLE — cursor is readable)
// =============================================================================

/**
 * Navigate the party menu cursor to `targetSlot`, re-reading
 * `menu.partyMenuSlot` after every press so wrap-around and remembered cursor
 * positions are handled exactly (no guessing). Does NOT press A to confirm —
 * the caller does that, since "confirm" means different things (use an item on
 * the slot vs. open the SUMMARY/SWITCH menu vs. forget a move).
 *
 * Precondition: the party menu must already be open (`menu.partyMenuOpen`
 * true). Opening it is the caller's job — the start-menu→Pokémon path is
 * gap-limited (no start-menu cursor read); the bag's "Use <item>" flow opens
 * the party menu automatically, so use_item's target step arrives here with it
 * already open.
 *
 * @param {number} targetSlot 0-5.
 * @param {object} [options]
 * @param {() => Promise<object>} [options.pollState] defaults to B1 fast poll.
 * @param {object} [options.io] injectable transport forwarded to executeQueue.
 * @param {number} [options.maxSteps=40] cap on navigation presses.
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<object>} makeOutcome envelope; OK when the cursor is on
 *          `targetSlot`, FAILED/precondition if the menu isn't open, BLOCKED if
 *          the slot can't be reached within maxSteps.
 */
export async function selectPartySlotLive(targetSlot, options = {}) {
    const {
        pollState = () => import("../gamestate/getState.js").then((m) => m.getState({ includeMap: false, includeBag: false })),
        io,
        maxSteps = 40,
        signal,
    } = options;
    const { executeQueue } = await import("../tools/inputExecutor.js");

    const state = await pollState();
    if (!state?.menu?.partyMenuOpen) {
        return makeOutcome(OUTCOME_STATUS.FAILED, {
            stopReason: STOP_REASON.PRECONDITION_FAILED,
            message: "selectPartySlotLive: party menu not open (open it via the bag's Use flow or Start→Pokémon first)",
        });
    }
    let stepsUsed = 0;
    for (;;) {
        if (signal?.aborted) {
            return makeOutcome(OUTCOME_STATUS.INTERRUPTED, { stopReason: STOP_REASON.NONE, stepsUsed, message: "aborted" });
        }
        const cur = await pollState();
        const slot = cur?.menu?.partyMenuSlot;
        if (typeof slot !== "number") {
            return makeOutcome(OUTCOME_STATUS.FAILED, {
                stopReason: STOP_REASON.UNKNOWN_STATE,
                stepsUsed,
                message: "party-menu slot unreadable mid-navigation",
            });
        }
        const dir = partySlotDirection(slot, targetSlot);
        if (!dir) {
            return makeOutcome(OUTCOME_STATUS.OK, {
                stepsUsed,
                message: `party-menu cursor on slot ${targetSlot}`,
                stateDelta: { partyMenuSlot: slot },
            });
        }
        if (stepsUsed >= maxSteps) {
            return makeOutcome(OUTCOME_STATUS.FAILED, {
                stopReason: STOP_REASON.BLOCKED,
                stepsUsed,
                message: `could not navigate party menu to slot ${targetSlot} within ${maxSteps} presses (got ${slot})`,
                stateDelta: { partyMenuSlot: slot },
            });
        }
        const res = await executeQueue([dir], { io, signal });
        stepsUsed += res.stepsUsed ?? 1;
        if (res.error) {
            return makeOutcome(OUTCOME_STATUS.FAILED, {
                stopReason: STOP_REASON.UNKNOWN_STATE,
                stepsUsed,
                message: `party-menu nav press failed: ${res.error}`,
            });
        }
        // B2-style interrupt check: a battle starting or HP dropping low
        // mid-navigation is a real stop (the party menu would be torn down).
        if (cur.battle?.active) {
            return makeOutcome(OUTCOME_STATUS.INTERRUPTED, {
                stopReason: STOP_REASON.BATTLE_STARTED,
                stepsUsed,
                message: "battle started mid party-menu nav",
            });
        }
    }
}

// =============================================================================
// LIVE ADAPTER: wait for a dialog/script lock to engage after a talk press.
// advanceDialog returns immediately if the baseline is unlocked; after we
// press A to TALK to an NPC the dialog lock needs a few frames to engage, so
// we poll for `progress.controlsLocked` first. Returns true once locked.
// =============================================================================

async function waitForDialogEngaged(pollState, { io, timeoutMs = 1200, intervalMs = 30, signal } = {}) {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const delay = typeof io?.delay === "function" ? io.delay.bind(io) : sleep;
    const start = Date.now();
    for (;;) {
        if (signal?.aborted) return false;
        const st = await pollState().catch(() => null);
        if (st?.progress?.controlsLocked) return true;
        if (Date.now() - start >= timeoutMs) return false;
        await delay(intervalMs);
    }
}

// =============================================================================
// LIVE ADAPTER: use_item (GAP-LIMITED on bag/start-menu cursor — see docstring)
// =============================================================================

/**
 * Use one bag item. Opens the start menu → BAG → (gap-limited) navigates to the
 * item's pocket + slot → opens the item's action menu → Use → if `targetSlot`
 * is given, navigates the (game-opened) party menu to that slot via the
 * RELIABLE selectPartySlotLive → confirms → advances the result dialog → backs
 * out to the overworld. Polls B2 after each phase and returns a D1 outcome,
 * escalating on any interrupt in the shared vocabulary.
 *
 * RELIABILITY: the party-menu target step is exact (readable cursor). The
 * start-menu→BAG and bag→item navigation are gap-limited (no cursor read); a
 * wrong cursor still selects SOME valid entry and B2 surfaces odd state next
 * poll. See module docstring.
 *
 * @param {{item:string, targetSlot?:number, quantity?:number}} args
 * @param {object} [options]
 * @param {() => Promise<object>} [options.pollState]
 * @param {object} [options.io] transport forwarded to executeQueue/advanceDialog.
 * @param {number} [options.maxSteps=200]
 * @param {AbortSignal} [options.signal]
 * @param {() => object} [options.advanceDialog] override (test hook).
 * @param {() => object} [options.selectPartySlotLive] override (test hook).
 * @returns {Promise<object>} makeOutcome envelope.
 */
export async function useItemLive({ item, targetSlot, quantity = 1 }, options = {}) {
    const {
        pollState = () => import("../gamestate/getState.js").then((m) => m.getState({ includeMap: false })),
        io,
        maxSteps = 200,
        signal,
        advanceDialog,
        selectPartySlotLive: selectSlotLive = selectPartySlotLive,
    } = options;
    const { executeQueue } = await import("../tools/inputExecutor.js");
    const advanceDialogFn = advanceDialog || (await import("../tools/inputExecutor.js")).advanceDialog;
    const { classifyInterrupt } = await import("../gamestate/interruptDetector.js");

    if (typeof item !== "string" || !item.trim()) {
        return makeOutcome(OUTCOME_STATUS.FAILED, {
            stopReason: STOP_REASON.INVALID_ARGS,
            message: "use_item requires an item name",
        });
    }

    let stepsUsed = 0;
    const consume = (n) => { stepsUsed += n; };
    const runPhase = async (presses) => {
        if (signal?.aborted) return makeOutcome(OUTCOME_STATUS.INTERRUPTED, { stopReason: STOP_REASON.NONE, stepsUsed, message: "aborted" });
        if (stepsUsed >= maxSteps) {
            return makeOutcome(OUTCOME_STATUS.BUDGET_EXHAUSTED, { stopReason: STOP_REASON.BUDGET_EXHAUSTED, stepsUsed, message: "use_item step budget exhausted" });
        }
        const res = await executeQueue(presses, {
            io, signal,
            onStep: async () => {
                const st = await pollState().catch(() => null);
                if (!st) return false;
                const reason = classifyInterrupt(st, { hpThreshold: 0.2, expectMenu: true, baselineMap: null });
                // A menu open / dialog lock is EXPECTED mid-use (we're driving
                // menus); only stop on the things we can't press through.
                if (reason && reason !== STOP_REASON.UNEXPECTED_MENU && reason !== STOP_REASON.DIALOG) {
                    abortedReason = reason;
                    return true;
                }
                return false;
            },
        });
        consume(res.stepsUsed ?? presses.length);
        return null;
    };
    let abortedReason = null;

    // Resolve the item against the bag now (the bag read is the expensive one;
    // the model asked for this item, so the cost is justified).
    const state0 = await pollState();
    const bag = state0?.bag;
    const found = resolveBagItem(bag, item);
    if (!found) {
        return makeOutcome(OUTCOME_STATUS.FAILED, {
            stopReason: STOP_REASON.PRECONDITION_FAILED,
            stepsUsed,
            message: `item not in bag: ${item}`,
        });
    }
    if (typeof quantity === "number" && quantity > found.quantity) {
        return makeOutcome(OUTCOME_STATUS.FAILED, {
            stopReason: STOP_REASON.PRECONDITION_FAILED,
            stepsUsed,
            message: `only ${found.quantity} ${found.name} in bag (asked for ${quantity})`,
        });
    }

    // Must be in the overworld to open the start menu. (In-battle item use is a
    // different menu path — the battle engine's domain; surfaced as
    // precondition_failed here so the model uses set_battle_strategy / press.)
    if (state0.battle?.active) {
        return makeOutcome(OUTCOME_STATUS.FAILED, {
            stopReason: STOP_REASON.PRECONDITION_FAILED,
            stepsUsed,
            message: "use_item overworld-only (in-battle item use is the battle engine's path)",
        });
    }
    if (state0.progress?.controlsLocked) {
        return makeOutcome(OUTCOME_STATUS.INTERRUPTED, {
            stopReason: STOP_REASON.DIALOG,
            stepsUsed,
            message: "controls locked (dialog/script) — cannot open bag",
        });
    }

    // Phase 1: Start menu → BAG entry (gap-limited cursor).
    let out = await runPhase([...buildStartMenuToBagSequence(), "a"]);
    if (out || abortedReason) return out || makeOutcome(OUTCOME_STATUS.INTERRUPTED, { stopReason: abortedReason, stepsUsed, message: `interrupted opening bag: ${abortedReason}` });

    // Phase 2: navigate to the item's pocket + slot (gap-limited), open action menu.
    out = await runPhase([...buildBagNavigationSequence(found.pocketIndex, found.itemIndex), "a"]);
    if (out || abortedReason) return out || makeOutcome(OUTCOME_STATUS.INTERRUPTED, { stopReason: abortedReason, stepsUsed, message: `interrupted selecting item: ${abortedReason}` });

    // Phase 3: select "Use" (default cursor) + confirm.
    out = await runPhase([...buildUseActionSequence(), "a"]);
    if (out || abortedReason) return out || makeOutcome(OUTCOME_STATUS.INTERRUPTED, { stopReason: abortedReason, stepsUsed, message: `interrupted at item Use: ${abortedReason}` });

    // Phase 4: party target selection (RELIABLE), if the item targets a Pokémon.
    if (typeof targetSlot === "number") {
        const sel = await selectSlotLive(targetSlot, { pollState, io, signal, maxSteps: Math.max(8, maxSteps - stepsUsed) });
        consume(sel.steps_used ?? 0);
        if (sel.status !== OUTCOME_STATUS.OK) {
            return { ...sel, steps_used: stepsUsed };
        }
        // Confirm the target slot (A applies the item to it).
        out = await runPhase(["a"]);
        if (out || abortedReason) return out || makeOutcome(OUTCOME_STATUS.INTERRUPTED, { stopReason: abortedReason, stepsUsed, message: `interrupted confirming target: ${abortedReason}` });
    }

    // Phase 5: advance the result dialog ("Used <item> on <mon>!" etc.) until
    // controls unlock or a choice/interrupt surfaces.
    const dlg = await advanceDialogFn({ io, pollState, signal, expectMenu: false });
    consume(dlg.pressesUsed ?? 0);
    if (dlg.stopReason && dlg.stopReason !== STOP_REASON.NONE) {
        return makeOutcome(OUTCOME_STATUS.INTERRUPTED, {
            stopReason: dlg.stopReason,
            stepsUsed,
            message: `use_item result dialog interrupted: ${dlg.stopReason}`,
        });
    }

    // Phase 6: back out to the overworld. B closes menus; press a few to tear
    // down whatever bag/party/menu layers remain. Polled; stops if an interrupt
    // (battle/hp) fires.
    abortedReason = null;
    out = await runPhase(["b", "b", "b"]);
    if (out || abortedReason) return out || makeOutcome(OUTCOME_STATUS.INTERRUPTED, { stopReason: abortedReason, stepsUsed, message: `interrupted closing menus: ${abortedReason}` });

    return makeOutcome(OUTCOME_STATUS.OK, {
        stepsUsed,
        message: `used ${found.name}${typeof targetSlot === "number" ? ` on slot ${targetSlot}` : ""}${quantity > 1 ? ` x${quantity}` : ""}`,
        stateDelta: { item: found.name, targetSlot: targetSlot ?? null, quantity },
    });
}

// =============================================================================
// LIVE ADAPTER: heal at a Pokécenter (RELIABLE — nurse at known tile + dialog)
// =============================================================================

/**
 * Heal the party at the nearest Pokécenter: route there via C2's `gotoLive`
 * (lands on the center's door-warp anchor tile), walk to the nurse-interact
 * tile (looked up by map id in POKECENTER_NURSE_INTERACT), face the nurse, talk
 * across the counter, then mash A through the heal dialog (the YES/NO "heal
 * your Pokémon?" prompt defaults to YES, so mashing A confirms and advances)
 * until the overworld controls unlock. Returns a D1 outcome envelope.
 *
 * Reliable: no bag/start-menu cursor involved. The only assumptions are (a) the
 * center's standard layout matches the table (verified for both pre-Brock
 * centers) and (b) walking up to the nurse tile lands the player facing up
 * (guaranteed by an explicit "up" press toward the counter, which is blocked
 * and so only re-orients facing). Any non-dialog interrupt en route is returned
 * verbatim from gotoLive / advanceDialog.
 *
 * @param {object} [options]
 * @param {() => Promise<object>} [options.gotoLive] override (C2 router).
 * @param {() => Promise<object>} [options.pollState]
 * @param {object} [options.io]
 * @param {number} [options.maxSteps=600] budget shared across routing + heal.
 * @param {AbortSignal} [options.signal]
 * @param {() => object} [options.advanceDialog] override (test hook).
 * @returns {Promise<object>} makeOutcome envelope.
 */
export async function healAtPokecenterLive(options = {}) {
    const {
        gotoLive,
        pollState = () => import("../gamestate/getState.js").then((m) => m.getState({ includeMap: false, includeBag: false })),
        io,
        maxSteps = 600,
        signal,
        advanceDialog,
    } = options;
    const { executeQueue } = await import("../tools/inputExecutor.js");
    const advanceDialogFn = advanceDialog || (await import("../tools/inputExecutor.js")).advanceDialog;
    const gotoLiveFn = gotoLive || (await import("./crossMapRouter.js")).gotoLive;

    let stepsUsed = 0;

    // Leg 1: route to the nearest Pokécenter. gotoLive returns an outcome; if
    // it's not OK, hand it straight back (interrupt / blocked / budget).
    const leg1 = await gotoLiveFn({ location: "nearest pokecenter" }, { maxSteps, hpThreshold: 0.2, signal });
    stepsUsed += leg1.steps_used ?? 0;
    if (leg1.status !== OUTCOME_STATUS.OK) {
        return leg1.status === OUTCOME_STATUS.INTERRUPTED || leg1.status === OUTCOME_STATUS.BUDGET_EXHAUSTED
            ? { ...leg1, steps_used: stepsUsed }
            : makeOutcome(OUTCOME_STATUS.FAILED, {
                stopReason: leg1.stop_reason ?? STOP_REASON.UNKNOWN_STATE,
                stepsUsed,
                message: `heal: could not reach pokecenter: ${leg1.message}`,
            });
    }

    // Resolve the nurse-interact tile for whichever center we landed in.
    const here = await pollState();
    const g = here?.player?.map?.bank;
    const n = here?.player?.map?.number;
    if (g == null || n == null) {
        return makeOutcome(OUTCOME_STATUS.FAILED, { stopReason: STOP_REASON.UNKNOWN_STATE, stepsUsed, message: "heal: landed but current map unreadable" });
    }
    const nurseTile = POKECENTER_NURSE_INTERACT[`${g}:${n}`];
    if (!nurseTile) {
        return makeOutcome(OUTCOME_STATUS.FAILED, {
            stopReason: STOP_REASON.PRECONDITION_FAILED,
            stepsUsed,
            message: `heal: pokecenter ${g}:${n} layout not in the nurse-tile table (unknown layout)`,
        });
    }

    // Leg 2: walk to the nurse-interact tile on this center's map. gotoLive
    // with {x,y} and no `map` targets the current map. Returns on arrival or
    // an interrupt (hand it back). Reuse the remaining budget.
    const leg2 = await gotoLiveFn({ x: nurseTile.x, y: nurseTile.y }, { maxSteps: Math.max(1, maxSteps - stepsUsed), hpThreshold: 0.2, signal });
    stepsUsed += leg2.steps_used ?? 0;
    if (leg2.status !== OUTCOME_STATUS.OK) {
        return leg2.status === OUTCOME_STATUS.INTERRUPTED || leg2.status === OUTCOME_STATUS.BUDGET_EXHAUSTED
            ? { ...leg2, steps_used: stepsUsed }
            : makeOutcome(OUTCOME_STATUS.FAILED, {
                stopReason: leg2.stop_reason ?? STOP_REASON.UNKNOWN_STATE,
                stepsUsed,
                message: `heal: could not reach nurse tile: ${leg2.message}`,
            });
    }

    // Talk to the nurse: face up (toward the counter — blocked, so only
    // re-orients) then A. The talk triggers the heal dialog (controls lock).
    if (stepsUsed >= maxSteps) {
        return makeOutcome(OUTCOME_STATUS.BUDGET_EXHAUSTED, { stopReason: STOP_REASON.BUDGET_EXHAUSTED, stepsUsed, message: "heal: budget exhausted before talking to nurse" });
    }
    const talkRes = await executeQueue(["up", "a"], { io, signal });
    stepsUsed += talkRes.stepsUsed ?? 2;
    if (talkRes.error) {
        return makeOutcome(OUTCOME_STATUS.FAILED, { stopReason: STOP_REASON.UNKNOWN_STATE, stepsUsed, message: `heal: talk press failed: ${talkRes.error}` });
    }

    // The dialog needs a few frames to engage after the talk press; wait for
    // controlsLocked before mashing (advanceDialog returns immediately on an
    // unlocked baseline, so without this it could no-op).
    const engaged = await waitForDialogEngaged(pollState, { io, signal, timeoutMs: 1500 });
    if (!engaged) {
        return makeOutcome(OUTCOME_STATUS.INTERRUPTED, {
            stopReason: STOP_REASON.UNEXPECTED_MENU,
            stepsUsed,
            message: "heal: nurse dialog did not start after talk (not facing nurse? layout changed?)",
        });
    }

    // Mash A through the heal dialog until the overworld unlocks. A on the
    // YES/NO prompt (YES default) confirms the heal; subsequent A's advance the
    // "restoring..." text until controls release. Any non-dialog interrupt
    // surfaces verbatim.
    const dlg = await advanceDialogFn({ io, pollState, signal, expectMenu: false });
    stepsUsed += dlg.pressesUsed ?? 0;
    if (dlg.stopReason && dlg.stopReason !== STOP_REASON.NONE) {
        return makeOutcome(OUTCOME_STATUS.INTERRUPTED, {
            stopReason: dlg.stopReason,
            stepsUsed,
            message: `heal dialog interrupted: ${dlg.stopReason}`,
        });
    }

    const after = await pollState();
    return makeOutcome(OUTCOME_STATUS.OK, {
        stepsUsed,
        message: "healed at pokecenter",
        stateDelta: {
            map: after?.player?.map ? { bank: after.player.map.bank, number: after.player.map.number } : null,
            leadHpFraction: after?.party?.leadHpFraction ?? null,
            lowestHpFraction: after?.party?.lowestHpFraction ?? null,
        },
    });
}

// =============================================================================
// LIVE ADAPTER: heal with bag items (composes use_item; inherits its gap)
// =============================================================================

/**
 * Apply bag items to injured party members. Simple policy, bounded by `maxSteps`
 * and the bag: for each pass, find the most-injured non-fainted member, apply
 * the best available HP item (Potion-class) to it; find any status-afflicted
 * member and apply a status healer; stop when the party is full or items run
 * out or budget is exhausted. Composes `useItemLive`, so it inherits the
 * bag-cursor gap (the pokecenter path is the reliable full-heal).
 *
 * @param {object} [options]
 * @param {() => Promise<object>} [options.pollState]
 * @param {object} [options.io]
 * @param {number} [options.maxSteps=400]
 * @param {AbortSignal} [options.signal]
 * @param {(args:object, opts:object) => Promise<object>} [options.useItemLive] override.
 * @returns {Promise<object>} makeOutcome envelope.
 */
export async function healWithItemsLive(options = {}) {
    const {
        pollState = () => import("../gamestate/getState.js").then((m) => m.getState({ includeBag: true, includeMap: false })),
        io,
        maxSteps = 400,
        signal,
        useItemLive: useItem = useItemLive,
    } = options;

    let stepsUsed = 0;
    const applied = [];
    const MAX_PASSES = 6;

    for (let pass = 0; pass < MAX_PASSES; pass++) {
        if (signal?.aborted) {
            return makeOutcome(OUTCOME_STATUS.INTERRUPTED, { stopReason: STOP_REASON.NONE, stepsUsed, message: "aborted" });
        }
        if (stepsUsed >= maxSteps) {
            return makeOutcome(OUTCOME_STATUS.BUDGET_EXHAUSTED, { stopReason: STOP_REASON.BUDGET_EXHAUSTED, stepsUsed, message: "heal-items budget exhausted" });
        }
        const st = await pollState();
        const party = Array.isArray(st?.party?.pokemon) ? st.party.pokemon : [];
        const bag = st?.bag ?? {};

        // Pick the most-injured non-fainted member (lowest hpFraction > 0).
        let target = null;
        for (const p of party) {
            if (!p || p.fainted) continue;
            const hp = typeof p.hpFraction === "number" ? p.hpFraction : 1;
            if (hp >= 1) continue;
            if (!target || hp < target.hp) target = { slot: p.slot, hp, name: p.nickname ?? p.species };
        }
        if (target) {
            const item = pickHpItem(bag);
            if (item) {
                const out = await useItem({ item, targetSlot: target.slot, quantity: 1 }, { pollState, io, signal, maxSteps: Math.max(8, maxSteps - stepsUsed) });
                stepsUsed += out.steps_used ?? 0;
                if (out.status !== OUTCOME_STATUS.OK) {
                    return out.status === OUTCOME_STATUS.INTERRUPTED || out.status === OUTCOME_STATUS.BUDGET_EXHAUSTED
                        ? { ...out, steps_used: stepsUsed }
                        : { ...out, steps_used: stepsUsed };
                }
                applied.push({ slot: target.slot, item });
                continue;
            }
        }

        // Any status-afflicted member: apply a status healer.
        let statusTarget = null;
        for (const p of party) {
            if (!p || p.fainted) continue;
            const sc = p.statusCondition;
            if (sc && sc !== "NONE") { statusTarget = { slot: p.slot, sc }; break; }
        }
        if (statusTarget) {
            const item = pickStatusItem(bag, statusTarget.sc);
            if (item) {
                const out = await useItem({ item, targetSlot: statusTarget.slot, quantity: 1 }, { pollState, io, signal, maxSteps: Math.max(8, maxSteps - stepsUsed) });
                stepsUsed += out.steps_used ?? 0;
                if (out.status !== OUTCOME_STATUS.OK) {
                    return out.status === OUTCOME_STATUS.INTERRUPTED || out.status === OUTCOME_STATUS.BUDGET_EXHAUSTED
                        ? { ...out, steps_used: stepsUsed }
                        : { ...out, steps_used: stepsUsed };
                }
                applied.push({ slot: statusTarget.slot, item });
                continue;
            }
        }

        // Fainted member: Revive if available.
        const fainted = party.find((p) => p && p.fainted);
        if (fainted) {
            const item = pickReviveItem(bag);
            if (item) {
                const out = await useItem({ item, targetSlot: fainted.slot, quantity: 1 }, { pollState, io, signal, maxSteps: Math.max(8, maxSteps - stepsUsed) });
                stepsUsed += out.steps_used ?? 0;
                if (out.status !== OUTCOME_STATUS.OK) {
                    return out.status === OUTCOME_STATUS.INTERRUPTED || out.status === OUTCOME_STATUS.BUDGET_EXHAUSTED
                        ? { ...out, steps_used: stepsUsed }
                        : { ...out, steps_used: stepsUsed };
                }
                applied.push({ slot: fainted.slot, item });
                continue;
            }
        }

        // No more work this pass (nothing injured, or no applicable items).
        break;
    }

    const st = await pollState();
    const party = Array.isArray(st?.party?.pokemon) ? st.party.pokemon : [];
    const allFull = party.length > 0 && party.every((p) => p && !p.fainted && (typeof p.hpFraction !== "number" || p.hpFraction >= 1));
    return makeOutcome(allFull ? OUTCOME_STATUS.OK : OUTCOME_STATUS.INTERRUPTED, {
        stopReason: allFull ? STOP_REASON.NONE : STOP_REASON.CHOICE_REQUIRED,
        stepsUsed,
        message: allFull
            ? "party healed to full with items"
            : `items applied (${applied.length}) but party not yet full; consider heal at a pokecenter`,
        stateDelta: { applied, lowestHpFraction: st?.party?.lowestHpFraction ?? null },
    });
}

/** Pick the weakest sufficient HP-restoring item in the bag (Potion > Super > ...). */
function pickHpItem(bag) {
    const order = ["Potion", "Super Potion", "Hyper Potion", "Max Potion", "Full Restore", "Fresh Water", "Soda Pop", "Lemonade", "Moomoo Milk", "Energy Powder", "Energy Root"];
    for (const name of order) {
        if (resolveBagItem(bag, name)) return name;
    }
    return null;
}
function pickReviveItem(bag) {
    for (const name of ["Revive", "Max Revive", "Revival Herb"]) {
        if (resolveBagItem(bag, name)) return name;
    }
    return null;
}
/** Pick a status healer matching the condition, falling back to a Full Heal. */
function pickStatusItem(bag, status) {
    const s = String(status || "").toUpperCase();
    const map = {
        POISON: ["Antidote", "Full Heal", "Heal Powder", "Pewter City Antidote"],
        BURN: ["Burn Heal", "Full Heal", "Heal Powder"],
        PARALYSIS: ["Paralyze Heal", "Parlyz Heal", "Full Heal", "Heal Powder"],
        SLEEP: ["Awakening", "Awaken", "Full Heal", "Heal Powder"],
        FREEZE: ["Ice Heal", "Full Heal", "Heal Powder"],
    };
    const list = map[s] || [];
    for (const name of list) if (resolveBagItem(bag, name)) return name;
    if (resolveBagItem(bag, "Full Heal")) return "Full Heal";
    return null;
}

// =============================================================================
// LIVE ADAPTER: heal (the `heal` tool entry — method dispatch)
// =============================================================================

/**
 * The `heal` tool. Dispatches on `method`:
 *   - "pokecenter" → healAtPokecenterLive (reliable full-heal).
 *   - "items"      → healWithItemsLive (bag items; inherits use_item's gap).
 *   - "auto"       → if the bag has sufficient HP/status items for the injured
 *                    party, healWithItemsLive; else healAtPokecenterLive.
 *
 * @param {{method?:string, max_steps?:number}} [args]
 * @param {object} [options] forwarded to the chosen adapter (plus gotoLive).
 * @returns {Promise<object>} makeOutcome envelope.
 */
export async function healLive(args = {}, options = {}) {
    const method = args.method || "auto";
    const maxSteps = typeof args.max_steps === "number" ? args.max_steps : 400;
    const opts = { ...options, maxSteps };
    // Honor injected adapters (test hook / future rewiring) so the dispatcher
    // and tests can stub these without dragging in the real gotoLive/network.
    const pc = options.healAtPokecenterLive || healAtPokecenterLive;
    const items = options.healWithItemsLive || healWithItemsLive;

    if (method === "pokecenter") return pc(opts);
    if (method === "items") return items(opts);

    // auto: items if sufficient, else pokecenter.
    try {
        const pollState = opts.pollState || (() => import("../gamestate/getState.js").then((m) => m.getState({ includeBag: true, includeMap: false })));
        const st = await pollState();
        const party = Array.isArray(st?.party?.pokemon) ? st.party.pokemon : [];
        const injured = party.filter((p) => p && (p.fainted || (typeof p.hpFraction === "number" && p.hpFraction < 1) || (p.statusCondition && p.statusCondition !== "NONE")));
        if (injured.length === 0) {
            return makeOutcome(OUTCOME_STATUS.OK, { stepsUsed: 0, message: "party already healthy; no heal needed" });
        }
        const bag = st?.bag ?? {};
        const canItems = injured.every((p) =>
            (p.fainted ? !!pickReviveItem(bag) : (typeof p.hpFraction === "number" && p.hpFraction < 1) ? !!pickHpItem(bag) : true)
            && (!p.statusCondition || p.statusCondition === "NONE" || !!pickStatusItem(bag, p.statusCondition))
        );
        if (canItems) return items(opts);
        return pc(opts);
    } catch (error) {
        return makeOutcome(OUTCOME_STATUS.FAILED, {
            stopReason: STOP_REASON.UNKNOWN_STATE,
            message: `heal auto-decide failed: ${error?.message ?? String(error)}`,
        });
    }
}

// =============================================================================
// LIVE ADAPTER: reorder party (open party menu, select, switch, confirm)
// =============================================================================

/**
 * Reorder the party: open the party menu (Start→Pokémon — gap-limited start-menu
 * cursor), select slot `fromSlot`, open its action menu and pick SWITCH, then
 * select `toSlot` (reliable party-menu nav) and confirm. The party-menu slot
 * navigation is exact; the start-menu→Pokémon entry and the SUMMARY/SWITCH
 * action-menu selection are gap-limited (no cursor reads). Returns a D1 outcome.
 *
 * @param {{fromSlot:number, toSlot:number}} args
 * @param {object} [options]
 * @returns {Promise<object>} makeOutcome envelope.
 */
export async function reorderPartyLive({ fromSlot, toSlot } = {}, options = {}) {
    const {
        pollState = () => import("../gamestate/getState.js").then((m) => m.getState({ includeMap: false, includeBag: false })),
        io,
        maxSteps = 200,
        signal,
        selectPartySlotLive: selectSlotLive = selectPartySlotLive,
    } = options;
    const { executeQueue } = await import("../tools/inputExecutor.js");

    if (typeof fromSlot !== "number" || typeof toSlot !== "number") {
        return makeOutcome(OUTCOME_STATUS.FAILED, { stopReason: STOP_REASON.INVALID_ARGS, message: "reorder requires fromSlot + toSlot" });
    }
    if (fromSlot === toSlot) {
        return makeOutcome(OUTCOME_STATUS.OK, { stepsUsed: 0, message: "reorder: from==to, no-op" });
    }

    let stepsUsed = 0;
    // Open the party menu: Start → down to Pokémon (index 1) → A. Gap: assumes
    // start-menu cursor opens at index 0 (POKéDEX).
    let res = await executeQueue(["start", "down", "a"], { io, signal });
    stepsUsed += res.stepsUsed ?? 3;
    if (res.error) return makeOutcome(OUTCOME_STATUS.FAILED, { stopReason: STOP_REASON.UNKNOWN_STATE, stepsUsed, message: `reorder open party menu failed: ${res.error}` });

    // Wait for the party menu to actually open (controls lock briefly while it
    // initializes), then select the source slot.
    const opened = await waitForDialogEngaged(pollState, { io, signal, timeoutMs: 1000 });
    if (!opened) {
        return makeOutcome(OUTCOME_STATUS.INTERRUPTED, { stopReason: STOP_REASON.UNEXPECTED_MENU, stepsUsed, message: "reorder: party menu did not open" });
    }
    // The party menu lock is a transient init lock, not dialog to mash; release
    // it by pressing A once? No — once it's open the slot id is readable. Poll
    // until partyMenuOpen is true (it may report open even while locked).
    let st = await pollState();
    if (!st?.menu?.partyMenuOpen) {
        // Try a B then re-open fallback is too fragile; surface instead.
        return makeOutcome(OUTCOME_STATUS.INTERRUPTED, { stopReason: STOP_REASON.UNEXPECTED_MENU, stepsUsed, message: "reorder: party menu open flag not set" });
    }

    const selFrom = await selectSlotLive(fromSlot, { pollState, io, signal, maxSteps: Math.max(8, maxSteps - stepsUsed) });
    stepsUsed += selFrom.steps_used ?? 0;
    if (selFrom.status !== OUTCOME_STATUS.OK) return { ...selFrom, steps_used: stepsUsed };

    // Open the action menu on the source slot. GAP: the SUMMARY/SWITCH/etc.
    // menu's cursor isn't readable; "SWITCH" is conventionally the 2nd entry.
    // Press A to open the action menu, down to SWITCH, A to enter switch mode.
    res = await executeQueue(["a", "down", "a"], { io, signal });
    stepsUsed += res.stepsUsed ?? 3;
    if (res.error) return makeOutcome(OUTCOME_STATUS.FAILED, { stopReason: STOP_REASON.UNKNOWN_STATE, stepsUsed, message: `reorder switch-menu failed: ${res.error}` });

    // Now the party menu is in "choose destination" mode; navigate to toSlot.
    const selTo = await selectSlotLive(toSlot, { pollState, io, signal, maxSteps: Math.max(8, maxSteps - stepsUsed) });
    stepsUsed += selTo.steps_used ?? 0;
    if (selTo.status !== OUTCOME_STATUS.OK) return { ...selTo, steps_used: stepsUsed };

    // Confirm the swap with A, then back out to the overworld.
    res = await executeQueue(["a", "b", "b", "b"], { io, signal });
    stepsUsed += res.stepsUsed ?? 4;
    if (res.error) return makeOutcome(OUTCOME_STATUS.FAILED, { stopReason: STOP_REASON.UNKNOWN_STATE, stepsUsed, message: `reorder confirm failed: ${res.error}` });

    return makeOutcome(OUTCOME_STATUS.OK, {
        stepsUsed,
        message: `reordered party: slot ${fromSlot} <-> slot ${toSlot}`,
        stateDelta: { fromSlot, toSlot },
    });
}

// =============================================================================
// LIVE ADAPTER: move-learn prompt (default: decline; or accept + replace slot)
// =============================================================================

/**
 * Handle a move-learn prompt that surfaced mid-level-up. By default the harness
 * DECLINES (press B → "No") — it never overwrites a move the model might want
 * without the model asking, since the move-forget cursor's start position
 * isn't readable (same gap as the battle-move cursor). When `decision` is
 * "accept" with a `replaceSlot` (0-3), it accepts and replaces that slot
 * (gap-limited cursor count).
 *
 * This is invoked from the agent loop when a level-up move-learn dialog is
 * detected (controls locked with a move-learn prompt), NOT a model tool — the
 * model has no "learn move" tool by design (D1 keeps the action space small).
 *
 * @param {{decision?:"decline"|"accept", replaceSlot?:number}} [args]
 * @param {object} [options]
 * @returns {Promise<object>} makeOutcome envelope.
 */
export async function handleMoveLearnPromptLive(args = {}, options = {}) {
    const {
        pollState = () => import("../gamestate/getState.js").then((m) => m.getState({ includeMap: false, includeBag: false })),
        io,
        signal,
        advanceDialog,
    } = options;
    const { executeQueue } = await import("../tools/inputExecutor.js");
    const advanceDialogFn = advanceDialog || (await import("../tools/inputExecutor.js")).advanceDialog;

    const decision = args.decision || "decline";
    const presses = decision === "accept" && typeof args.replaceSlot === "number"
        ? buildMoveLearnAcceptSequence(args.replaceSlot)
        : buildMoveLearnDeclineSequence();

    const res = await executeQueue(presses, { io, signal });
    const stepsUsed = res.stepsUsed ?? presses.length;
    if (res.error) {
        return makeOutcome(OUTCOME_STATUS.FAILED, { stopReason: STOP_REASON.UNKNOWN_STATE, stepsUsed, message: `move-learn press failed: ${res.error}` });
    }

    // After accept/decline there's follow-up text ("mon learned X!" or
    // "did not learn X"); mash through it until controls unlock.
    const engaged = await waitForDialogEngaged(pollState, { io, signal, timeoutMs: 1000 });
    if (engaged) {
        const dlg = await advanceDialogFn({ io, pollState, signal, expectMenu: false });
        if (dlg.stopReason && dlg.stopReason !== STOP_REASON.NONE) {
            return makeOutcome(OUTCOME_STATUS.INTERRUPTED, {
                stopReason: dlg.stopReason,
                stepsUsed: stepsUsed + (dlg.pressesUsed ?? 0),
                message: `move-learn follow-up dialog interrupted: ${dlg.stopReason}`,
            });
        }
        return makeOutcome(OUTCOME_STATUS.OK, {
            stepsUsed: stepsUsed + (dlg.pressesUsed ?? 0),
            message: decision === "accept" ? `learned move (replaced slot ${args.replaceSlot})` : "declined learning move",
        });
    }
    return makeOutcome(OUTCOME_STATUS.OK, {
        stepsUsed,
        message: decision === "accept" ? `learned move (replaced slot ${args.replaceSlot})` : "declined learning move",
    });
}
