// =============================================================================
// BATTLE POLICY ENGINE (C3)
// =============================================================================
//
// Rule-based, strategy-parameterized battle decision-maker. Given a snapshot
// of the current battle state (our lead + party + the enemy's type(s) when
// known), it picks the next action: use a move, switch Pokémon, flee, or
// ESCALATE back to the model. It never improvises a state it shouldn't decide
// on its own — no usable move left -> out_of_pp, lead about to faint with no
// healthier switch -> about_to_faint, unrecognized screen -> unknown_state.
//
// This is the C3 implementation behind D1's `set_battle_strategy` tool: the
// tool only updates the standing policy (see toolInterface.js); THIS module is
// what consumes it each battle turn. The six BATTLE_STRATEGY presets drive the
// scoring here:
//   default          highest effective damage; switch on faint
//   highest_damage   maximize raw power, ignore type-switching
//   type_effective   maximize type-effective (super-effective + STAB) damage
//   conserve_pp      prefer high-PP / STAB moves, avoid burning rare PP
//   level_grind      stay on the lead for XP even at some risk
//   flee             attempt to run from wild encounters
//
// Two layers, same split as C1 (pathfinding.js) / C2 (crossMapRouter.js):
//   - `decideAction` is PURE: takes a plain battle-state object + policy,
//     touches no RAM, fully exercised by battlePolicy.test.js against the
//     checked-in move_data / type_chart.
//   - `runBattleLive` is the live adapter: polls B1's getState(), builds the
//     battle state, asks `decideAction`, executes the chosen action through
//     B3's input executor, and returns a D1 `makeOutcome(...)` envelope —
//     escalating exactly when the policy says to. See its docstring for the
//     two runtime gaps (enemy-side + battle-menu-cursor RAM reads) that are
//     not part of B1's snapshot and are deferred B-work, same way A4's note
//     defers wiring story flags into the runtime reader.
// =============================================================================

import { getMoveByName, typeMultiplier } from "./battleData.js";
import { makeOutcome, OUTCOME_STATUS, STOP_REASON } from "../llminteract/toolInterface.js";

// Default HP fraction at/below which a battler is "about to faint" and the
// engine prefers to switch (or, with no healthier switch, escalate).
const DEFAULT_HP_THRESHOLD = 0.2;

// catch_all_pokemon: enemy HP fraction at/below which the engine stops chipping
// and throws a ball (higher catch odds the lower this is). Above it, it keeps
// picking the weakest move to whittle the target down.
const DEFAULT_CATCH_HP_THRESHOLD = 0.3;

// Safety cap on ball throws in a single fight so a catch_all_pokemon flag left
// on during a trainer battle (where balls are always blocked) fails fast and
// escalates instead of burning the whole step budget throwing blocked balls.
const MAX_CATCH_ATTEMPTS = 8;

// A move counts as "damaging" when it has positive power. Status moves (power
// 0) are never picked for damage by the policy — they're left to the model via
// escalation when they're the only thing left.
const isDamaging = (mv) => mv && typeof mv.power === "number" && mv.power > 0;

/**
 * Resolves a snapshot move entry ({name, pp} from B1's party read) into a
 * decision-ready move by joining in the static power/type from battleData.
 * If the snapshot already carries power/type (tests can inject these), those
 * win — so the engine is testable without the static table loaded.
 *
 * @param {{name:string, pp:number, power?:number, type?:string}} move
 * @returns {{name:string, pp:number, power:number, type:string|null, raw:object|null}}
 */
function resolveMove(move) {
    if (!move || !move.name) return null;
    const data = getMoveByName(move.name);
    const power = typeof move.power === "number" ? move.power : data?.power ?? 0;
    const type = move.type ?? data?.type ?? null;
    return {
        name: move.name,
        pp: typeof move.pp === "number" ? move.pp : data?.pp ?? 0,
        power,
        type,
        raw: data ?? null,
    };
}

/**
 * Effective damage score for a resolved move against `enemyTypes`. Product of:
 *   base power  ×  type-effectiveness multiplier  ×  (1.5 if STAB)
 * STAB (Same-Type Attack Bonus) applies when the move's type is one of the
 * attacker's own types. Enemy types unknown (null/[]) -> multiplier 1, so
 * scoring degrades to raw power — a sane fallback for wild encounters whose
 * species isn't read at runtime (see runBattleLive's enemy-side gap note).
 *
 * @param {{power:number, type:string|null}} move
 * @param {string[]} attackerTypes
 * @param {string[]|null} enemyTypes
 * @returns {number}
 */
function effectivePower(move, attackerTypes, enemyTypes) {
    if (!isDamaging(move)) return 0;
    const mult = move.type ? typeMultiplier(move.type, enemyTypes) : 1;
    const stab = move.type && attackerTypes?.includes(move.type) ? 1.5 : 1;
    return move.power * mult * stab;
}

/**
 * The set of moves the lead can actually use this turn: damaging moves with PP
 * remaining. Empty when the lead is out of damaging options (-> out_of_pp).
 * @param {Array} resolvedMoves
 * @returns {Array}
 */
function usableDamagingMoves(resolvedMoves) {
    return resolvedMoves.filter((mv) => isDamaging(mv) && mv.pp > 0);
}

/**
 * Pick the best move for a strategy from the lead's usable damaging moves.
 *
 * @param {Array} usable Resolved damaging moves with PP.
 * @param {string} strategy
 * @param {string[]} leadTypes
 * @param {string[]|null} enemyTypes
 * @returns {object} the chosen move (with its score + reason).
 */
function pickMoveByStrategy(usable, strategy, leadTypes, enemyTypes, { catchAll }) {
    let best = null;
    for (const mv of usable) {
        let score;
        let reason;
        const eff = effectivePower(mv, leadTypes, enemyTypes);
        switch (strategy) {
            case "highest_damage":
                // Maximize raw power; tie-break on effective damage so a SE hit
                // still wins a pure-power tie.
                score = mv.power * 1000 + eff;
                reason = `highest raw power (${mv.power})`;
                break;
            case "type_effective":
                score = eff;
                reason = `most effective (${eff.toFixed(1)} effective power)`;
                break;
            case "conserve_pp":
                // Prefer the move with the most PP remaining (don't burn the
                // rare move); tie-break STAB, then lower power (a cheap chip
                // is the point). Avoid exhausting a 1-PP move unless it's the
                // only option — handled by the score weighting below.
                score = mv.pp * 100 + (mv.type && leadTypes?.includes(mv.type) ? 50 : 0) - mv.power;
                reason = `conserve PP (pp ${mv.pp}, power ${mv.power})`;
                break;
            case "level_grind":
            case "default":
            default:
                // Default behavior: highest effective damage. Same as
                // type_effective's damage pick; the difference is default also
                // switches on faint (handled by the caller), level_grind does not.
                score = eff;
                reason = `best effective damage (${eff.toFixed(1)})`;
                break;
        }
        if (best === null || score > best.score) {
            best = { move: mv, score, reason };
        }
    }
    // catch_all_pokemon: while chipping a catch target down, prefer the
    // LOWEST-damage usable move so we don't accidentally KO it before it's weak
    // enough to throw a ball at. Overrides the per-strategy pick. The ball throw
    // itself happens in runBattleLive (it needs live enemy-HP + bag reads).
    if (catchAll && usable.length > 0) {
        let weakest = null;
        for (const mv of usable) {
            const eff = effectivePower(mv, leadTypes, enemyTypes);
            if (weakest === null || eff < weakest.eff) {
                weakest = { move: mv, eff, reason: "chip (catch_all_pokemon): lowest effective damage" };
            }
        }
        best = { move: weakest.move, score: weakest.eff, reason: weakest.reason };
    }
    return best;
}

/**
 * Finds the best switch candidate: a non-fainted party member (not the lead)
 * with HP above `hpThreshold`, preferring the highest-HP one. Returns null when
 * there is no healthier switch (the about_to_faint escalation case).
 *
 * @param {Array} party B1-style party members.
 * @param {number} leadSlot
 * @param {number} hpThreshold
 * @returns {object|null} {slot, member}
 */
function findHealthierSwitch(party, leadSlot, hpThreshold) {
    let best = null;
    for (const p of party) {
        if (!p || p.slot === leadSlot) continue;
        if (p.fainted) continue;
        const hp = typeof p.hpFraction === "number" ? p.hpFraction : null;
        if (hp === null || hp <= hpThreshold) continue;
        if (best === null || hp > best.hp) {
            best = { slot: p.slot, member: p, hp };
        }
    }
    return best;
}

/**
 * The lead preference from the policy (`lead` arg of set_battle_strategy): if
 * set and a non-fainted party member whose nickname/species matches it has more
 * HP than the current lead, switch to it. This is independent of the faint
 * path — it honors the model's "keep this lead active when possible" intent.
 *
 * @param {Array} party
 * @param {number} leadSlot
 * @param {string|null} leadPref
 * @returns {object|null} {slot, member}
 */
function findPreferredLead(party, leadSlot, leadPref) {
    if (!leadPref) return null;
    const want = leadPref.toUpperCase();
    for (const p of party) {
        if (!p || p.slot === leadSlot || p.fainted) continue;
        const nick = String(p.nickname ?? "").toUpperCase();
        const species = String(p.species ?? "").toUpperCase();
        if (nick === want || species === want) return { slot: p.slot, member: p };
    }
    return null;
}

/**
 * PURE battle-policy decision. Given the current battle state and the standing
 * policy, returns the action the harness should take this turn, OR an escalation
 * directive handing control back to the model.
 *
 * @param {object} battleState
 * @param {boolean} battleState.inBattle True when a battle is active.
 * @param {boolean} [battleState.isWild] Wild encounter (flee-able) vs trainer.
 * @param {object} battleState.lead The active battler (B1 party[0] shape).
 * @param {Array} [battleState.party] Full party, for switch decisions.
 * @param {{types:string[], level?:number}|null} [battleState.enemy] Opponent.
 * @param {{strategy:string, lead?:string, catchAll?:boolean}} policy
 * @param {object} [options]
 * @param {number} [options.hpThreshold=0.2]
 * @returns {{kind:"move", moveIndex:number, reason:string}
 *          | {kind:"switch", slot:number, reason:string}
 *          | {kind:"flee", reason:string}
 *          | {kind:"escalate", stopReason:string, reason:string}}
 */
export function decideAction(battleState, policy = {}, options = {}) {
    const { hpThreshold = DEFAULT_HP_THRESHOLD } = options;
    const strategy = policy.strategy ?? "default";
    const isWild = !!battleState.isWild;

    if (!battleState || !battleState.inBattle) {
        return { kind: "escalate", stopReason: STOP_REASON.UNKNOWN_STATE, reason: "not in battle" };
    }
    const lead = battleState.lead;
    if (!lead) {
        return { kind: "escalate", stopReason: STOP_REASON.UNKNOWN_STATE, reason: "lead unreadable" };
    }

    const party = Array.isArray(battleState.party) ? battleState.party : [lead];
    const leadSlot = typeof lead.slot === "number" ? lead.slot : 0;
    const leadTypes = Array.isArray(lead.types) ? lead.types : [];
    const enemyTypes = battleState.enemy ? battleState.enemy.types : null;

    // Flee policy: only wild battles are flee-able. Trainers can't be run from,
    // so `flee` against a trainer falls back to `default` damage selection.
    if (strategy === "flee") {
        if (isWild) {
            return { kind: "flee", reason: "flee wild encounter" };
        }
        return decideAction(
            { ...battleState },
            { ...policy, strategy: "default" },
            options
        );
    }

    // Switch on faint: lead about to drop and a healthier party member exists.
    // level_grind explicitly opts out — the model asked to stay in for XP.
    const leadHp = typeof lead.hpFraction === "number" ? lead.hpFraction : 1;
    const allowSwitch = strategy !== "level_grind";
    if (allowSwitch && leadHp <= hpThreshold && !lead.fainted) {
        const sw = findHealthierSwitch(party, leadSlot, hpThreshold);
        if (sw) {
            return { kind: "switch", slot: sw.slot, reason: `lead low (${(leadHp * 100).toFixed(0)}% HP); switch to healthier slot ${sw.slot}` };
        }
        // Low HP and nothing healthier to switch to -> let the model decide.
        return { kind: "escalate", stopReason: STOP_REASON.ABOUT_TO_FAINT, reason: `lead at ${(leadHp * 100).toFixed(0)}% HP with no healthier switch` };
    }

    // Honor an explicit lead preference (set_battle_strategy's `lead` arg):
    // switch to the requested battler when it's available and not fainted.
    if (allowSwitch && policy.lead) {
        const pref = findPreferredLead(party, leadSlot, policy.lead);
        if (pref) {
            return { kind: "switch", slot: pref.slot, reason: `switch to requested lead (${policy.lead})` };
        }
    }

    // Resolve the lead's moves and pick per strategy.
    const rawMoves = Array.isArray(lead.moves) ? lead.moves : [];
    const resolved = rawMoves.map(resolveMove).filter(Boolean);
    const usable = usableDamagingMoves(resolved);

    if (usable.length === 0) {
        return { kind: "escalate", stopReason: STOP_REASON.OUT_OF_PP, reason: "no damaging move with PP remaining" };
    }

    const pick = pickMoveByStrategy(usable, strategy, leadTypes, enemyTypes, {
        catchAll: !!policy.catchAll,
    });
    // moveIndex = position in the ORIGINAL lead.moves array (the fight-menu slot
    // order matches the party move list), not the filtered usable list.
    const moveIndex = rawMoves.findIndex((m) => m && m.name === pick.move.name);
    return { kind: "move", moveIndex, reason: `${pick.move.name}: ${pick.reason}` };
}

// =============================================================================
// LIVE ADAPTER
// =============================================================================

/**
 * Default fight-menu navigation, cursor-position-agnostic. Both Gen-3 battle
 * menus are 2x2 grids that REMEMBER their last cursor position (and the model
 * may have parked the cursor anywhere before handing the battle over — live
 * failure: cursor left on BAG made every blind "a" open the bag forever). So
 * never assume a cursor position:
 *   1. b,b     — back out of any submenu (bag/party/move-info) to the main
 *                menu; harmless no-ops when already there (B also advances
 *                battle text, which is equally fine).
 *   2. left,up — force the main-menu cursor to FIGHT (top-left); edge presses
 *                are no-ops, so this lands on FIGHT from any start.
 *   3. a       — open the move grid.
 *   4. up,left — force the move cursor to slot 0 (top-left), same trick.
 *   5. right / down per the 2x2 layout (0 1 / 2 3), then a to confirm.
 */
function defaultSelectMoveSequence(moveIndex) {
    const seq = ["b", "b", "left", "up", "a", "up", "left"];
    if (moveIndex % 2 === 1) seq.push("right");
    if (moveIndex >= 2) seq.push("down");
    seq.push("a"); // confirm the selected move
    return seq;
}

/**
 * Default Run-menu navigation, cursor-position-agnostic (same normalization
 * as defaultSelectMoveSequence): back out, force cursor to FIGHT (top-left),
 * then RUN is bottom-right of the 2x2 main menu.
 */
function defaultFleeSequence() {
    return ["b", "b", "left", "up", "right", "down", "a"];
}

// Preference order for which ball to spend when catch_all_pokemon is set: throw
// the most basic ball we have first and save the good ones. Any ball not listed
// here still gets used (as a last resort, first-in-pocket) — see pickCatchBall.
const BALL_PREFERENCE = [
    "POKE_BALL", "PREMIER_BALL", "GREAT_BALL", "NEST_BALL", "NET_BALL",
    "DIVE_BALL", "TIMER_BALL", "REPEAT_BALL", "ULTRA_BALL", "LUXURY_BALL",
];

/** Normalize an item/pocket name for matching (mirror menuMacros' rule). */
function normalizeCatchName(s) {
    return String(s || "").toLowerCase().replace(/['’]/g, "").replace(/[\s_]+/g, "");
}

/**
 * Pick a Poké Ball to throw from a B1 bag snapshot. Looks in the Pokéballs
 * pocket, prefers the most basic ball available (BALL_PREFERENCE), and otherwise
 * takes the first ball present. `itemIndex` is the ball's 0-based position in
 * the pocket's display list (what the throw sequence navigates to).
 *
 * @param {object} bag getBagContents() result (pocketName -> [{name,quantity}]).
 * @returns {{pocketIndex:number, itemIndex:number, name:string}|null} null when
 *          the bag holds no balls at all.
 */
export function pickCatchBall(bag) {
    if (!bag || typeof bag !== "object") return null;
    let items = null;
    for (const [pocketName, list] of Object.entries(bag)) {
        const n = normalizeCatchName(pocketName);
        if ((n === "pokeballs" || n === "pokeball") && Array.isArray(list)) { items = list; break; }
    }
    if (!items || items.length === 0) return null;
    const present = (it) => it && (typeof it.quantity !== "number" || it.quantity > 0);
    // Prefer the most basic ball in the pocket, in BALL_PREFERENCE order.
    for (const want of BALL_PREFERENCE) {
        const w = normalizeCatchName(want);
        const idx = items.findIndex((it) => present(it) && normalizeCatchName(it.name) === w);
        if (idx >= 0) return { pocketIndex: 2, itemIndex: idx, name: items[idx].name };
    }
    // Any other ball: first one present in the pocket.
    const idx = items.findIndex(present);
    if (idx < 0) return null;
    return { pocketIndex: 2, itemIndex: idx, name: items[idx].name };
}

/**
 * Default in-battle ball-throw navigation, cursor/pocket-agnostic (same
 * normalization idea as defaultSelectMoveSequence). From the battle main menu:
 * back out of any submenu, force the cursor to FIGHT then Right to BAG and open
 * it; clamp the bag to its leftmost pocket (ITEMS) and advance Right to the
 * Pokéballs pocket; clamp the item cursor to the top and Down to the ball; A to
 * throw. FRLG bag pockets and item lists don't wrap, so the extra Left/Up
 * presses land at the start regardless of the remembered cursor position.
 *
 * Live-verified: Right advances battle-bag pockets the same way it does the
 * field bag (menuMacros.buildBagNavigationSequence). The pocket-switch slide
 * animation DOES need more settle than a plain cursor move though — see
 * BAG_POCKET_SETTLE_FRAMES in runBattleLive, the caller of this sequence.
 *
 * Live-verified: A on a ball does NOT throw it directly — it opens a small
 * "POKé BALL is selected." USE/CANCEL submenu (USE pre-highlighted), so a
 * second A is required to actually confirm the throw.
 *
 * @param {number} pocketIndex Pokéballs pocket index (2 in FRLG).
 * @param {number} itemIndex 0-based ball slot within the pocket.
 * @returns {string[]}
 */
function defaultThrowBallSequence(pocketIndex, itemIndex) {
    const seq = ["b", "b", "left", "up", "right", "a"]; // battle menu -> BAG -> open
    for (let i = 0; i < 5; i++) seq.push("left");        // clamp to leftmost pocket
    for (let i = 0; i < (pocketIndex || 0); i++) seq.push("right"); // -> Pokéballs
    for (let i = 0; i < 8; i++) seq.push("up");          // clamp to top of the list
    for (let i = 0; i < (itemIndex || 0); i++) seq.push("down");    // -> the ball
    seq.push("a");                                        // select the ball -> USE/CANCEL submenu
    seq.push("a");                                        // confirm USE -> throw
    return seq;
}

/**
 * Live battle driver: while a battle is active, polls B1's snapshot, asks the
 * pure `decideAction` for the next action, executes it through B3's input
 * executor, and returns a D1 `makeOutcome(...)` envelope — escalating to the
 * model exactly when the policy says out_of_pp / about_to_faint / unknown_state.
 *
 * Two runtime gaps vs. a fully-equipped battle engine, both deferred B-work:
 *   1. ENEMY-SIDE data (opponent species/types/HP) is not in B1's snapshot, so
 *      `enemy` is passed as null and the policy falls back to raw-power /
 *      highest-damage scoring (its documented behavior when enemy types are
 *      unknown). Wiring an opponent-struct RAM read is the B-work that makes
 *      type_effective scoring live.
 *   2. BATTLE-MENU CURSOR position is not in B1's snapshot; move selection
 *      assumes the cursor opens on slot 0 (see defaultSelectMoveSequence). A
 *      cursor read makes it exact; until then, a wrong count still selects a
 *      valid move and B2 surfaces any odd state next poll.
 *
 * `switch` actions (low-HP lead, or honoring set_battle_strategy's `lead` arg)
 * are deferred to C4's party-menu macros — they need the party menu, which is
 * C4's domain. Until C4 lands, a `switch` decision is surfaced to the model as
 * a CHOICE_REQUIRED interrupt rather than executed here.
 *
 * @param {{strategy:string, lead?:string, catchAll?:boolean}} policy
 * @param {object} [options]
 * @param {number} [options.maxSteps=200] Step budget (one step ≈ one menu press).
 * @param {number} [options.hpThreshold=0.2]
 * @param {() => Promise<object>} [options.pollState] Snapshot source.
 * @param {(moveIndex:number)=>string[]} [options.selectMoveSequence]
 *        Override the fight-menu navigation sequence (test hook / future
 *        cursor-aware implementation).
 * @param {() => string[]} [options.fleeSequence] Override Run-menu navigation.
 * @param {object} [options.io] Injectable transport forwarded to executeQueue.
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<object>} A `makeOutcome(...)` envelope.
 */
export async function runBattleLive(policy = {}, options = {}) {
    const {
        maxSteps = 200,
        hpThreshold = DEFAULT_HP_THRESHOLD,
        catchHpThreshold = DEFAULT_CATCH_HP_THRESHOLD,
        pollState = () => import("../gamestate/getState.js").then((m) => m.getState({ includeMap: false, includeBag: false })),
        selectMoveSequence = defaultSelectMoveSequence,
        fleeSequence = defaultFleeSequence,
        throwBallSequence = defaultThrowBallSequence,
        io,
        signal,
    } = options;

    const { executeQueue, awaitFrames, defaultIo } = await import("../tools/inputExecutor.js");
    const { classifyInterrupt } = await import("../gamestate/interruptDetector.js");
    const frameIo = io ?? defaultIo;
    // Enemy-side read (gEnemyParty lead): closes the "enemy: null" gap so the
    // type-effectiveness scoring is live. Injectable for tests; falls back to
    // null ("enemy unknown") on any read failure.
    const readEnemy = options.readEnemy
        ?? (await import("../gamestate/pokemonData.js")).getEnemyLeadSummary;
    // Bag read (only used when catch_all_pokemon fires, to locate a ball).
    const readBag = options.readBag
        ?? (await import("../gamestate/bagData.js")).getBagContents;

    // Frames to let a battle turn play out (move animations, damage text,
    // the enemy's move) after we've selected our move, before re-polling and
    // deciding again. Without this the loop re-fires its 9-press sequence
    // every ~600ms straight into the turn animation — the presses get eaten
    // advancing text and the step budget burns ~14 presses/sec while exactly
    // one real turn happens (live-observed: 207 steps, one PP used).
    const TURN_SETTLE_FRAMES = 240; // ~4s of game time at 60fps

    // Frames between the taps of one menu sequence. The executor's 1-frame
    // default is too hot for the battle menus: navigation lands but the final
    // A confirm is dropped, deterministically (live-verified: the same
    // 9-press sequence never fired a move at 1-frame settle, fired every
    // time at 10). ~167ms/press keeps a full sequence under 2s.
    const MENU_TAP_SETTLE_FRAMES = 10;

    // Frames between taps when the sequence switches BAG POCKETS (the ball
    // throw's Left/Right presses). The pocket-switch slide animation blocks
    // input longer than a plain menu-cursor move: live-verified two Rights
    // back-to-back at 10 (and even 20) frames of settle only registered ONE
    // pocket change — the bag stayed on ITEMS/landed one pocket short instead
    // of reaching POKÉ BALLS — while 30 registered both reliably.
    const BAG_POCKET_SETTLE_FRAMES = 30;

    // Normalize the standing policy shape. The D1 tool arg + the dispatcher
    // store `catch_all_pokemon` (snake), while `decideAction` reads `catchAll`
    // (camel). Accept both so the dispatcher's `getBattlePolicy()` flows in
    // unchanged and direct callers (tests, runBattleLive's own docstring
    // examples) keep using camelCase.
    const pol = {
        strategy: policy?.strategy,
        lead: policy?.lead ?? null,
        catchAll: !!(policy?.catchAll ?? policy?.catch_all_pokemon),
    };

    let stepsUsed = 0;
    let catchAttempts = 0;
    const startState = await pollState();
    if (!startState?.battle?.active) {
        // Not in a battle — nothing for the engine to drive.
        return makeOutcome(OUTCOME_STATUS.OK, { stepsUsed, message: "no active battle" });
    }

    // The `flee` strategy needs to know the battle is wild (trainers can't be
    // run from). B1's snapshot doesn't carry battle type, so we can't confirm a
    // wild encounter to flee safely — surface it to the model rather than
    // silently fighting or wasting presses on a Run that may be disabled. The
    // pure engine's flee path is exercised by tests; live-driving it needs the
    // enemy-side RAM read (deferred B-work, see module docstring).
    if ((pol.strategy ?? "default") === "flee") {
        return makeOutcome(OUTCOME_STATUS.INTERRUPTED, {
            stopReason: STOP_REASON.CHOICE_REQUIRED,
            stepsUsed,
            message: "flee strategy set but battle type (wild vs trainer) not readable from B1 snapshot; surfacing to model",
        });
    }

    for (;;) {
        if (signal?.aborted) {
            return makeOutcome(OUTCOME_STATUS.INTERRUPTED, { stopReason: STOP_REASON.NONE, stepsUsed, message: "aborted" });
        }
        if (stepsUsed >= maxSteps) {
            return makeOutcome(OUTCOME_STATUS.BUDGET_EXHAUSTED, {
                stopReason: STOP_REASON.BUDGET_EXHAUSTED,
                stepsUsed,
                message: "battle step budget exhausted",
            });
        }

        const state = await pollState();

        // Battle ended -> clean completion.
        if (!state?.battle?.active) {
            return makeOutcome(OUTCOME_STATUS.OK, {
                stepsUsed,
                message: "battle ended",
                stateDelta: { leadHpFraction: state?.party?.leadHpFraction ?? null },
            });
        }

        // A non-battle interrupt surfaced mid-fight (dialog/menu) — hand it to
        // the model verbatim, same vocabulary as C2's gotoLive. BATTLE_STARTED is
        // NOT an interrupt here: battle.active is the expected steady state (we
        // just confirmed it above), and low HP is the policy engine's own
        // switch-on-faint trigger, decided below — not a hard stop.
        const interrupt = classifyInterrupt(state, { baselineMap: null });
        if (interrupt && interrupt !== STOP_REASON.BATTLE_STARTED) {
            return makeOutcome(OUTCOME_STATUS.INTERRUPTED, {
                stopReason: interrupt,
                stepsUsed,
                message: `interrupted mid-battle: ${interrupt}`,
                stateDelta: { leadHpFraction: state?.party?.leadHpFraction ?? null },
            });
        }

        const party = state?.party?.pokemon ?? [];
        const lead = party[0] ?? null;
        let enemy = null;
        let enemyHpFraction = null;
        try {
            const e = await readEnemy();
            // A 0-HP enemy lead is a stale read (previous battle's KO'd mon
            // lingers in RAM between fights) — treat as unknown.
            if (e && e.currentHP > 0) {
                enemy = { types: e.types, level: e.level, species: e.species };
                if (typeof e.maxHP === "number" && e.maxHP > 0) enemyHpFraction = e.currentHP / e.maxHP;
            }
        } catch { /* enemy unknown; scoring degrades to raw power */ }
        const battleState = {
            inBattle: true,
            isWild: false, // unknown from B1's snapshot; flee strategy escalates safely below
            lead,
            party,
            enemy,
        };

        // catch_all_pokemon: once the target is chipped low enough, throw a ball
        // instead of attacking. The model sets this policy when it wants to fill
        // out its team (e.g. grinding back and forth through grass); it's the
        // model's responsibility to turn it OFF before a trainer/gym battle,
        // where a thrown ball is always blocked and wasted. We can't read wild-
        // vs-trainer from B1's snapshot, so we trust the flag and cap throws
        // (MAX_CATCH_ATTEMPTS) so a mis-set catch in a trainer fight fails fast.
        if (pol.catchAll && enemyHpFraction !== null && enemyHpFraction <= catchHpThreshold) {
            if (catchAttempts >= MAX_CATCH_ATTEMPTS) {
                return makeOutcome(OUTCOME_STATUS.INTERRUPTED, {
                    stopReason: STOP_REASON.CHOICE_REQUIRED,
                    stepsUsed,
                    message: `catch_all_pokemon: threw ${catchAttempts} balls without catching — it may keep breaking free, or this is a trainer battle (you can't catch those). Decide manually, or turn catch_all_pokemon off.`,
                    stateDelta: { leadHpFraction: lead?.hpFraction ?? null },
                });
            }
            const bag = await Promise.resolve().then(readBag).catch(() => null);
            const ball = pickCatchBall(bag);
            if (!ball) {
                return makeOutcome(OUTCOME_STATUS.INTERRUPTED, {
                    stopReason: STOP_REASON.CHOICE_REQUIRED,
                    stepsUsed,
                    message: "catch_all_pokemon is set but there are no Poké Balls in the bag — buy some, or turn catch_all_pokemon off.",
                });
            }
            const res = await executeQueue(throwBallSequence(ball.pocketIndex, ball.itemIndex), { io, signal, tapSettleFrames: BAG_POCKET_SETTLE_FRAMES });
            stepsUsed += res.stepsUsed;
            catchAttempts += 1;
            if (res.error) {
                return makeOutcome(OUTCOME_STATUS.FAILED, { stopReason: STOP_REASON.UNKNOWN_STATE, stepsUsed, message: `ball-throw sequence failed: ${res.error}` });
            }
            // Let the throw animation + break-out / catch text resolve before
            // re-polling (battle ends here on a successful catch).
            await awaitFrames(frameIo, TURN_SETTLE_FRAMES);
            continue;
        }

        const decision = decideAction(battleState, pol, { hpThreshold });

        if (decision.kind === "escalate") {
            return makeOutcome(OUTCOME_STATUS.INTERRUPTED, {
                stopReason: decision.stopReason,
                stepsUsed,
                message: decision.reason,
                stateDelta: { leadHpFraction: lead?.hpFraction ?? null },
            });
        }

        if (decision.kind === "flee") {
            if (!battleState.isWild) {
                // Can't actually flee a trainer; surface to the model.
                return makeOutcome(OUTCOME_STATUS.INTERRUPTED, {
                    stopReason: STOP_REASON.CHOICE_REQUIRED,
                    stepsUsed,
                    message: "flee requested but battle type unknown; surfacing to model",
                });
            }
            const res = await executeQueue(fleeSequence(), { io, signal, tapSettleFrames: MENU_TAP_SETTLE_FRAMES });
            stepsUsed += res.stepsUsed;
            if (res.error) {
                return makeOutcome(OUTCOME_STATUS.FAILED, { stopReason: STOP_REASON.UNKNOWN_STATE, stepsUsed, message: `flee sequence failed: ${res.error}` });
            }
            await awaitFrames(frameIo, TURN_SETTLE_FRAMES);
            continue;
        }

        if (decision.kind === "switch") {
            // Party-menu navigation is C4's domain. Until C4 lands, surface the
            // recommended switch to the model as a choice rather than improvising
            // the party menu here.
            return makeOutcome(OUTCOME_STATUS.INTERRUPTED, {
                stopReason: STOP_REASON.CHOICE_REQUIRED,
                stepsUsed,
                message: `policy recommends switch to slot ${decision.slot} (${decision.reason}); party-menu macro pending (C4)`,
                stateDelta: { recommendedSwitchSlot: decision.slot },
            });
        }

        // decision.kind === "move": navigate the fight menu to the chosen slot.
        if (decision.moveIndex < 0) {
            return makeOutcome(OUTCOME_STATUS.FAILED, {
                stopReason: STOP_REASON.UNKNOWN_STATE,
                stepsUsed,
                message: "policy returned a move not in the lead's move list",
            });
        }
        const seq = selectMoveSequence(decision.moveIndex);
        const res = await executeQueue(seq, { io, signal, tapSettleFrames: MENU_TAP_SETTLE_FRAMES });
        stepsUsed += res.stepsUsed;
        if (res.error) {
            return makeOutcome(OUTCOME_STATUS.FAILED, { stopReason: STOP_REASON.UNKNOWN_STATE, stepsUsed, message: `move sequence failed: ${res.error}` });
        }
        // Let the selected turn actually play out before re-deciding.
        await awaitFrames(frameIo, TURN_SETTLE_FRAMES);
        // Loop: re-poll, let the turn resolve, and decide the next turn (or
        // detect battle-end / an interrupt) at the top of the loop.
    }
}
