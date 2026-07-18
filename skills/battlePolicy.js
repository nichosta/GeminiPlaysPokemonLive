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
function pickMoveByStrategy(usable, strategy, leadTypes, enemyTypes, { catchWild, isWild }) {
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
    // catch_wild: when weakening-and-catching wild encounters, prefer the
    // LOWEST-damage usable move so we don't accidentally KO. Overrides the
    // per-strategy pick (the ball throw itself is the use_item tool's job,
    // not this engine's).
    if (catchWild && isWild && usable.length > 0) {
        let weakest = null;
        for (const mv of usable) {
            const eff = effectivePower(mv, leadTypes, enemyTypes);
            if (weakest === null || eff < weakest.eff) {
                weakest = { move: mv, eff, reason: "chip (catch_wild): lowest effective damage" };
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
 * @param {{strategy:string, lead?:string, catchWild?:boolean}} policy
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
        catchWild: !!policy.catchWild,
        isWild,
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
 * Default fight-menu navigation. From the main battle menu (Fight/Bag/Pokemon/Run),
 * press Fight, then move the cursor down to slot `moveIndex` (0-based from the
 * top), then confirm with A.
 *
 * KNOWN GAP: this assumes the move-select cursor opens on slot 0. Gen-3
 * remembers the last-used move's position, so without a battle-menu-cursor RAM
 * read (not part of B1's snapshot) the down-press count can be off by the
 * distance from that remembered slot to 0. The harness degrades safely: a
 * wrong selection still picks SOME move (never a dead press), and B2's
 * interrupt detector surfaces any resulting dialog/menu/battle state next poll.
 * Making this cursor-accurate is downstream B-work (see plan.md C3 note).
 */
function defaultSelectMoveSequence(moveIndex) {
    const seq = ["a"]; // open the FIGHT menu (A on the Fight button)
    for (let i = 0; i < moveIndex; i++) seq.push("down");
    seq.push("a"); // confirm the selected move
    return seq;
}

/**
 * Default Run-menu navigation: from the main battle menu, cursor to Run and A.
 * (Cursor starts on FIGHT, so: right, right, down-ish — but the exact path
 * depends on menu layout. This presses the conventional sequence; same
 * cursor-accuracy caveat as defaultSelectMoveSequence.)
 */
function defaultFleeSequence() {
    return ["right", "down", "a"];
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
 * @param {{strategy:string, lead?:string, catchWild?:boolean}} policy
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
        pollState = () => import("../gamestate/getState.js").then((m) => m.getState({ includeMap: false, includeBag: false })),
        selectMoveSequence = defaultSelectMoveSequence,
        fleeSequence = defaultFleeSequence,
        io,
        signal,
    } = options;

    const { executeQueue } = await import("../tools/inputExecutor.js");
    const { classifyInterrupt } = await import("../gamestate/interruptDetector.js");

    let stepsUsed = 0;
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
    if ((policy.strategy ?? "default") === "flee") {
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
        // the model verbatim, same vocabulary as C2's gotoLive. BATTLE_STARTED
        // and HP_LOW are NOT interrupts here: battle.active is the expected
        // steady state (we just confirmed it above), and low HP is the policy
        // engine's own switch-on-faint trigger, decided below — not a hard stop.
        const interrupt = classifyInterrupt(state, { hpThreshold, baselineMap: null });
        if (
            interrupt &&
            interrupt !== STOP_REASON.BATTLE_STARTED &&
            interrupt !== STOP_REASON.HP_LOW
        ) {
            return makeOutcome(OUTCOME_STATUS.INTERRUPTED, {
                stopReason: interrupt,
                stepsUsed,
                message: `interrupted mid-battle: ${interrupt}`,
                stateDelta: { leadHpFraction: state?.party?.leadHpFraction ?? null },
            });
        }

        const party = state?.party?.pokemon ?? [];
        const lead = party[0] ?? null;
        const battleState = {
            inBattle: true,
            isWild: false, // unknown from B1's snapshot; flee strategy escalates safely below
            lead,
            party,
            enemy: null, // enemy-side RAM read is deferred B-work (see docstring)
        };

        const decision = decideAction(battleState, policy, { hpThreshold });

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
            const res = await executeQueue(fleeSequence(), { io, signal });
            stepsUsed += res.stepsUsed;
            if (res.error) {
                return makeOutcome(OUTCOME_STATUS.FAILED, { stopReason: STOP_REASON.UNKNOWN_STATE, stepsUsed, message: `flee sequence failed: ${res.error}` });
            }
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
        const res = await executeQueue(seq, { io, signal });
        stepsUsed += res.stepsUsed;
        if (res.error) {
            return makeOutcome(OUTCOME_STATUS.FAILED, { stopReason: STOP_REASON.UNKNOWN_STATE, stepsUsed, message: `move sequence failed: ${res.error}` });
        }
        // Loop: re-poll, let the turn resolve, and decide the next turn (or
        // detect battle-end / an interrupt) at the top of the loop.
    }
}
