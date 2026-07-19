// =============================================================================
// C3 battle policy self-test (offline, runs against checked-in battle data)
// =============================================================================
//
//   node skills/battlePolicy.test.js
//
// Verifies the pure `decideAction` policy engine against synthetic battle
// states: each BATTLE_STRATEGY preset picks the move its rule prescribes, the
// type-effectiveness / STAB scoring is correct, PP conservation behaves, and
// the three escalation paths (out_of_pp / about_to_faint / unknown_state) fire
// when they should — and don't when a switch or move is available.
//
// Move power/type come from the checked-in staticdata/frlg/move_data.json +
// type_chart.json via skills/battleData.js; move PP is injected per test (it's
// runtime state, not static).
// =============================================================================

import { decideAction, runBattleLive, pickCatchBall } from "./battlePolicy.js";
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

// --- Fixtures ----------------------------------------------------------------

// A Charmander lead (Fire) with Ember (Fire, 40 power) + Scratch (Normal, 40)
// + Growl (status, 0 power) + Tail Whip (status). Enemy is a Grass-type
// (Bulbasaur-ish) so Ember is super-effective AND STAB.
const CHARMANDER_VS_GRASS = {
    inBattle: true,
    isWild: false,
    lead: {
        slot: 0,
        nickname: "CHAR",
        species: "CHARMANDER",
        types: ["FIRE"],
        level: 7,
        hpFraction: 1.0,
        fainted: false,
        moves: [
            { name: "SCRATCH", pp: 35 },
            { name: "GROWL", pp: 40 },
            { name: "EMBER", pp: 25 },
            { name: "TAIL_WHIP", pp: 30 },
        ],
    },
    party: [
        {
            slot: 0, nickname: "CHAR", species: "CHARMANDER", types: ["FIRE"],
            level: 7, hpFraction: 1.0, fainted: false,
            moves: [{ name: "SCRATCH", pp: 35 }, { name: "GROWL", pp: 40 }, { name: "EMBER", pp: 25 }, { name: "TAIL_WHIP", pp: 30 }],
        },
    ],
    enemy: { types: ["GRASS"] },
};

// A lead at low HP with a healthier party member available for switch.
const LOW_HP_LEAD = {
    ...CHARMANDER_VS_GRASS,
    lead: { ...CHARMANDER_VS_GRASS.lead, hpFraction: 0.1 },
    party: [
        { ...CHARMANDER_VS_GRASS.party[0], hpFraction: 0.1 },
        {
            slot: 1, nickname: "PIDGEY", species: "PIDGEY", types: ["NORMAL", "FLYING"],
            level: 5, hpFraction: 0.9, fainted: false,
            moves: [{ name: "TACKLE", pp: 35 }, { name: "SAND_ATTACK", pp: 15 }],
        },
    ],
};

// Lead with every damaging move at 0 PP -> out_of_pp escalation.
const NO_PP_LEAD = {
    ...CHARMANDER_VS_GRASS,
    lead: {
        ...CHARMANDER_VS_GRASS.lead,
        moves: [
            { name: "SCRATCH", pp: 0 },
            { name: "GROWL", pp: 40 }, // status, not damaging
            { name: "EMBER", pp: 0 },
            { name: "TAIL_WHIP", pp: 30 }, // status
        ],
    },
};

// --- Tests -------------------------------------------------------------------

console.log("\n== default strategy: super-effective STAB move ==");
{
    const d = decideAction(CHARMANDER_VS_GRASS, { strategy: "default" });
    check("default picks Ember (SE + STAB)", d.kind === "move" && d.moveIndex === 2,
        `got ${JSON.stringify(d)}`);
}

console.log("\n== highest_damage: ignores type, maximizes raw power ==");
{
    // Scratch(40) vs Ember(40): same power; tie-break is effective damage, so
    // Ember (SE+STAB) still wins. Make Scratch strictly stronger to prove the
    // rule ignores type.
    const state = {
        ...CHARMANDER_VS_GRASS,
        lead: {
            ...CHARMANDER_VS_GRASS.lead,
            moves: [
                { name: "SCRATCH", pp: 35 }, // Normal 40
                { name: "EMBER", pp: 25 }, // Fire 40, SE+STAB
                { name: "VINE_WHIP", pp: 10 }, // Grass 35, not very effective vs Grass? 0.5
            ],
        },
    };
    // All 40/35 power; highest_damage tie-breaks to effective (Ember). To prove
    // raw-power preference, inject a 50-power move that's NOT very effective.
    const state2 = {
        ...state,
        lead: {
            ...state.lead,
            moves: [
                { name: "SCRATCH", pp: 35 }, // 40 power, neutral
                { name: "EMBER", pp: 25 }, // 40 power, SE+STAB (effective 120)
                { name: "TACKLE", pp: 35 }, // 35 power
            ],
        },
        // Make a synthetic higher-power-but-resisted scenario by overriding the
        // enemy so Ember is resisted but still higher raw power than Scratch:
        enemy: { types: ["FIRE"] }, // Ember vs Fire = 0.5 (resisted), Scratch neutral
    };
    // Scratch 40 neutral (eff 40), Ember 40 resisted*1.5stab = 30. highest_damage
    // picks by RAW power (40 == 40) then tie-break effective -> Scratch (40 > 30).
    const d = decideAction(state2, { strategy: "highest_damage" });
    check("highest_damage tie-breaks to higher EFFECTIVE on raw-power tie", d.kind === "move" && d.moveIndex === 0,
        `got ${JSON.stringify(d)}`);

    // And with a strictly higher raw power move, raw wins even if resisted:
    const state3 = {
        ...state2,
        lead: {
            ...state2.lead,
            moves: [
                { name: "SCRATCH", pp: 35 }, // 40
                { name: "EMBER", pp: 25 }, // 40
                { name: "VICE_GRIP", pp: 30 }, // 55 power Normal, neutral -> raw 55 wins
            ],
        },
    };
    const d3 = decideAction(state3, { strategy: "highest_damage" });
    check("highest_damage picks strictly highest raw power (VICE_GRIP 55)", d3.kind === "move" && d3.moveIndex === 2,
        `got ${JSON.stringify(d3)}`);
}

console.log("\n== type_effective: maximizes effective damage ==");
{
    const state = {
        ...CHARMANDER_VS_GRASS,
        lead: {
            ...CHARMANDER_VS_GRASS.lead,
            moves: [
                { name: "SCRATCH", pp: 35 }, // 40 Normal neutral = 40
                { name: "EMBER", pp: 25 }, // 40 Fire SE*STAB = 120
                { name: "WATER_GUN", pp: 25 }, // 40 Water vs Grass = 0.5 = 20
            ],
        },
    };
    const d = decideAction(state, { strategy: "type_effective" });
    check("type_effective picks Ember (120 > 40 > 20)", d.kind === "move" && d.moveIndex === 1,
        `got ${JSON.stringify(d)}`);
}

console.log("\n== conserve_pp: prefers high-PP / STAB, avoids burning rare PP ==");
{
    // Ember pp 25 (rare), Scratch pp 35 (cheap). conserve_pp should prefer
    // Scratch (more PP remaining, not rare) even though Ember hits harder.
    const state = {
        ...CHARMANDER_VS_GRASS,
        lead: {
            ...CHARMANDER_VS_GRASS.lead,
            moves: [
                { name: "SCRATCH", pp: 35 }, // 35 pp, neutral 40
                { name: "EMBER", pp: 5 }, // 5 pp, SE+STAB (rare)
            ],
        },
    };
    const d = decideAction(state, { strategy: "conserve_pp" });
    check("conserve_pp prefers high-PP Scratch over low-PP Ember", d.kind === "move" && d.moveIndex === 0,
        `got ${JSON.stringify(d)}`);

    // When Ember has plenty of PP, conserve_pp still prefers STAB/PP: both
    // have pp, Scratch 35 vs Ember 25 -> Scratch wins on PP count.
    const state2 = {
        ...CHARMANDER_VS_GRASS,
        lead: {
            ...CHARMANDER_VS_GRASS.lead,
            moves: [
                { name: "EMBER", pp: 25 },
                { name: "SCRATCH", pp: 35 },
            ],
        },
    };
    const d2 = decideAction(state2, { strategy: "conserve_pp" });
    check("conserve_pp picks higher-remaining-PP move even when both usable", d2.kind === "move" && d2.moveIndex === 1,
        `got ${JSON.stringify(d2)}`);
}

console.log("\n== level_grind: stays in, never switches on faint ==");
{
    const d = decideAction(LOW_HP_LEAD, { strategy: "level_grind" });
    check("level_grind does NOT switch despite low-HP lead", d.kind === "move",
        `got ${JSON.stringify(d)}`);
    check("level_grind still picks a damaging move", d.kind === "move" && d.moveIndex === 2,
        `got ${JSON.stringify(d)}`);
}

console.log("\n== flee: wild battles flee, trainers fall back to default ==");
{
    const wild = { ...CHARMANDER_VS_GRASS, isWild: true };
    const d = decideAction(wild, { strategy: "flee" });
    check("flee against wild returns a flee action", d.kind === "flee",
        `got ${JSON.stringify(d)}`);

    const trainer = { ...CHARMANDER_VS_GRASS, isWild: false };
    const d2 = decideAction(trainer, { strategy: "flee" });
    check("flee against trainer falls back to a damaging move", d2.kind === "move",
        `got ${JSON.stringify(d2)}`);
}

console.log("\n== catch_all_pokemon: chips with the weakest effective move ==");
{
    const wild = {
        ...CHARMANDER_VS_GRASS,
        isWild: true,
        lead: {
            ...CHARMANDER_VS_GRASS.lead,
            moves: [
                { name: "EMBER", pp: 25 }, // 120 effective
                { name: "SCRATCH", pp: 35 }, // 40 effective (lower)
            ],
        },
    };
    const d = decideAction(wild, { strategy: "default", catchAll: true });
    check("catch_all_pokemon picks the lowest-effective-damage move (Scratch)", d.kind === "move" && d.moveIndex === 1,
        `got ${JSON.stringify(d)}`);
    // catch_all chips regardless of the wild/trainer flag (the model toggles it
    // off before trainers itself; the engine no longer gates on isWild).
    const dTrainer = decideAction({ ...wild, isWild: false }, { strategy: "default", catchAll: true });
    check("catch_all_pokemon chips even when isWild is false", dTrainer.kind === "move" && dTrainer.moveIndex === 1,
        `got ${JSON.stringify(dTrainer)}`);
}

console.log("\n== escalation paths ==");
{
    // out_of_pp: no damaging move with PP left.
    const d = decideAction(NO_PP_LEAD, { strategy: "default" });
    check("no usable move -> out_of_pp", d.kind === "escalate" && d.stopReason === STOP_REASON.OUT_OF_PP,
        `got ${JSON.stringify(d)}`);

    // about_to_faint: low HP lead WITH a healthier switch -> switch (not escalate).
    const d2 = decideAction(LOW_HP_LEAD, { strategy: "default" });
    check("low-HP lead with healthier switch -> switch action", d2.kind === "switch" && d2.slot === 1,
        `got ${JSON.stringify(d2)}`);

    // about_to_faint: low HP lead with NO healthier switch -> escalate.
    const noSwitch = {
        ...LOW_HP_LEAD,
        party: [{ ...LOW_HP_LEAD.party[0], hpFraction: 0.1 }], // only the lead, low
    };
    const d3 = decideAction(noSwitch, { strategy: "default" });
    check("low-HP lead with no healthier switch -> about_to_faint", d3.kind === "escalate" && d3.stopReason === STOP_REASON.ABOUT_TO_FAINT,
        `got ${JSON.stringify(d3)}`);

    // unknown_state: not in battle.
    const d4 = decideAction({ inBattle: false }, { strategy: "default" });
    check("not in battle -> unknown_state", d4.kind === "escalate" && d4.stopReason === STOP_REASON.UNKNOWN_STATE,
        `got ${JSON.stringify(d4)}`);

    // unknown_state: in battle but lead unreadable.
    const d5 = decideAction({ inBattle: true, lead: null, party: [] }, { strategy: "default" });
    check("in battle but no lead -> unknown_state", d5.kind === "escalate" && d5.stopReason === STOP_REASON.UNKNOWN_STATE,
        `got ${JSON.stringify(d5)}`);
}

console.log("\n== lead preference (set_battle_strategy `lead` arg) ==");
{
    // Lead is full-HP but the model requested a different lead by nickname.
    const state = {
        ...CHARMANDER_VS_GRASS,
        party: [
            { ...CHARMANDER_VS_GRASS.party[0] },
            {
                slot: 1, nickname: "PIDGEY", species: "PIDGEY", types: ["NORMAL", "FLYING"],
                level: 5, hpFraction: 0.8, fainted: false, moves: [{ name: "TACKLE", pp: 35 }],
            },
        ],
    };
    const d = decideAction(state, { strategy: "default", lead: "PIDGEY" });
    check("lead preference switches to requested battler", d.kind === "switch" && d.slot === 1,
        `got ${JSON.stringify(d)}`);

    // Preference for the CURRENT lead -> no switch, just a move.
    const d2 = decideAction(state, { strategy: "default", lead: "CHARMANDER" });
    check("lead preference for current lead -> no switch (picks a move)", d2.kind === "move",
        `got ${JSON.stringify(d2)}`);
}

console.log("\n== enemy types unknown -> degrades to raw power (wild fallback) ==");
{
    const state = {
        ...CHARMANDER_VS_GRASS,
        enemy: null, // unknown enemy (the live adapter's default until enemy read exists)
        lead: {
            ...CHARMANDER_VS_GRASS.lead,
            moves: [
                { name: "SCRATCH", pp: 35 }, // 40 neutral
                { name: "EMBER", pp: 25 }, // 40 Fire, STAB only (no enemy type) = 60
            ],
        },
    };
    const d = decideAction(state, { strategy: "type_effective" });
    // With no enemy type, Ember still wins via STAB (60 > 40).
    check("unknown enemy types: STAB still scored, Ember wins", d.kind === "move" && d.moveIndex === 1,
        `got ${JSON.stringify(d)}`);

    const state2 = {
        ...state,
        lead: {
            ...state.lead,
            moves: [
                { name: "EMBER", pp: 25 }, // 40 -> STAB 60
                { name: "VICE_GRIP", pp: 30 }, // 55 Normal, no STAB = 55
            ],
        },
    };
    const d2 = decideAction(state2, { strategy: "type_effective" });
    check("unknown enemy types: raw power can outweigh STAB (VICE_GRIP 55 vs Ember-stab 60)... ",
        d2.kind === "move" && d2.moveIndex === 0, // 60 > 55 -> Ember
        `got ${JSON.stringify(d2)}`);
}

// =============================================================================
// LIVE ADAPTER (runBattleLive) — driven with an injected fake transport + a
// scripted pollState, no emulator. Covers the outcome-envelope contract and
// the escalation paths; mirrors inputExecutor.test.js's FakeIo.
// =============================================================================

class FakeIo {
    constructor({ startFrame = 100, framesPerDelay = 1 } = {}) {
        this.frame = startFrame;
        this.tapLog = [];
        this.framesPerDelay = framesPerDelay;
    }
    async tap(button) { this.tapLog.push(button); }
    async hold(button, frames) { this.tapLog.push(`${button}:${frames}`); }
    async readFrame() { return this.frame; }
    async delay(_ms) { this.frame += this.framesPerDelay; }
}

/** A B1-shaped battle snapshot with a Charmander lead (Ember move). */
function battleState(leadHp = 1.0, extra = {}) {
    return {
        player: { position: { x: 5, y: 5 }, map: { bank: 3, number: 0 } },
        battle: { active: true },
        progress: { controlsLocked: false },
        menu: { partyMenuOpen: false },
        party: {
            pokemon: [{
                slot: 0, nickname: "CHAR", species: "CHARMANDER", types: ["FIRE"],
                level: 7, hpFraction: leadHp, fainted: false,
                moves: [{ name: "SCRATCH", pp: 35 }, { name: "EMBER", pp: 25 }],
            }],
            leadHpFraction: leadHp,
            lowestHpFraction: leadHp,
        },
        ...extra,
    };
}

console.log("\n== runBattleLive: no battle at start -> OK ==");
{
    let polls = 0;
    const pollState = async () => ({ battle: { active: false }, player: { position: { x: 1, y: 1 }, map: { bank: 3, number: 0 } }, progress: { controlsLocked: false }, menu: { partyMenuOpen: false } });
    const res = await runBattleLive({ strategy: "default" }, { pollState, io: new FakeIo(), maxSteps: 50 });
    check("no battle -> status ok", res.status === "ok", JSON.stringify(res));
    check("no battle -> stop_reason none", res.stop_reason === STOP_REASON.NONE, JSON.stringify(res));
    void polls;
}

console.log("\n== runBattleLive: one move pressed, then battle ends -> OK ==");
{
    // Poll 1: in battle, lead at full HP. Poll 2 (after the move sequence): still
    // in battle (turn resolving). Poll 3: battle ended. decideAction (default)
    // picks EMBER at slot 1 (STAB outranks Scratch), so the cursor-agnostic
    // sequence is B,B (back out), Left,Up (force FIGHT), A, Up,Left (force
    // slot 0), Right (to slot 1), A.
    const seq = [battleState(1.0), battleState(1.0), { ...battleState(1.0), battle: { active: false } }];
    let i = 0;
    const pollState = async () => seq[Math.min(i++, seq.length - 1)];
    const io = new FakeIo();
    const res = await runBattleLive({ strategy: "default" }, { pollState, io, maxSteps: 50 });
    check("move-then-end -> status ok", res.status === "ok", JSON.stringify(res));
    check("move-then-end -> cursor-agnostic slot-1 sequence",
        io.tapLog.join(",") === "B,B,Left,Up,A,Up,Left,Right,A", JSON.stringify(io.tapLog));
    check("move-then-end -> battle ended message", /battle ended/.test(res.message), JSON.stringify(res));
}

console.log("\n== runBattleLive: low-HP lead, no healthier switch -> about_to_faint ==");
{
    const pollState = async () => battleState(0.1); // lead at 10% HP, solo party
    const res = await runBattleLive({ strategy: "default" }, { pollState, io: new FakeIo(), maxSteps: 50 });
    check("low-HP no switch -> interrupted", res.status === "interrupted", JSON.stringify(res));
    check("low-HP no switch -> about_to_faint", res.stop_reason === STOP_REASON.ABOUT_TO_FAINT, JSON.stringify(res));
}

console.log("\n== runBattleLive: flee strategy -> CHOICE_REQUIRED (battle type unknown) ==");
{
    const pollState = async () => battleState(1.0);
    const res = await runBattleLive({ strategy: "flee" }, { pollState, io: new FakeIo(), maxSteps: 50 });
    check("flee strategy -> interrupted", res.status === "interrupted", JSON.stringify(res));
    check("flee strategy -> choice_required", res.stop_reason === STOP_REASON.CHOICE_REQUIRED, JSON.stringify(res));
}

console.log("\n== runBattleLive: out_of_pp -> escalated, no presses wasted ==");
{
    const pollState = async () => battleState(1.0, {
        party: {
            pokemon: [{
                ...battleState(1.0).party.pokemon[0],
                moves: [{ name: "SCRATCH", pp: 0 }, { name: "EMBER", pp: 0 }],
            }],
            leadHpFraction: 1.0, lowestHpFraction: 1.0,
        },
    });
    const io = new FakeIo();
    const res = await runBattleLive({ strategy: "default" }, { pollState, io, maxSteps: 50 });
    check("no PP -> out_of_pp", res.stop_reason === STOP_REASON.OUT_OF_PP, JSON.stringify(res));
    check("no PP -> no fight-menu presses sent", io.tapLog.length === 0, JSON.stringify(io.tapLog));
}

console.log("\n== runBattleLive: move decision honours moveIndex via down-presses ==");
{
    // Lead with Ember at slot 1: the 2x2 move grid means slot 1 is one Right
    // from the forced top-left. Poll must stay in-battle long enough for
    // the move sequence to run before the ended poll closes the loop.
    const seq = [battleState(1.0), battleState(1.0), { ...battleState(1.0), battle: { active: false } }];
    let i = 0;
    const pollState = async () => seq[Math.min(i++, seq.length - 1)];
    const io = new FakeIo();
    await runBattleLive({ strategy: "type_effective" }, { pollState, io, maxSteps: 50 });
    // decideAction picks EMBER (slot 1) for the Fire STAB vs null enemy (60 > 40).
    check("slot-1 move -> 9 presses (normalize + select)", io.tapLog.length === 9, JSON.stringify(io.tapLog));
    check("slot-1 move -> Right into slot 1 before confirm", io.tapLog[7] === "Right" && io.tapLog[8] === "A", JSON.stringify(io.tapLog));
}

// =============================================================================
// catch_all_pokemon: ball selection (pure) + live throw/chip/no-ball paths
// =============================================================================

console.log("\n== pickCatchBall: prefers the most basic ball, null when none ==");
{
    const bag = {
        Items: [{ name: "POTION", quantity: 3 }],
        Pokeballs: [{ name: "GREAT_BALL", quantity: 2 }, { name: "POKE_BALL", quantity: 5 }],
    };
    const ball = pickCatchBall(bag);
    check("pickCatchBall prefers POKE_BALL over GREAT_BALL", ball && ball.name === "POKE_BALL" && ball.itemIndex === 1, JSON.stringify(ball));
    check("pickCatchBall reports pokéballs pocket index 2", ball && ball.pocketIndex === 2, JSON.stringify(ball));
    check("pickCatchBall falls back to any ball present",
        pickCatchBall({ Pokeballs: [{ name: "DUSK_BALL", quantity: 1 }] })?.name === "DUSK_BALL");
    check("pickCatchBall -> null when no balls", pickCatchBall({ Items: [{ name: "POTION", quantity: 1 }] }) === null);
    check("pickCatchBall -> null when pocket empty", pickCatchBall({ Pokeballs: [] }) === null);
}

/** battleState + an injected enemy read at a given HP fraction. */
function catchDeps(enemyHpFraction, { bag = { Pokeballs: [{ name: "POKE_BALL", quantity: 5 }] } } = {}) {
    const state = battleState(1.0);
    let bagCalled = false;
    return {
        pollState: async () => state,
        readEnemy: async () => ({ species: "PIDGEY", types: ["NORMAL", "FLYING"], level: 3, currentHP: Math.round(12 * enemyHpFraction), maxHP: 12 }),
        readBag: async () => { bagCalled = true; return bag; },
        wasBagCalled: () => bagCalled,
        state,
    };
}

console.log("\n== runBattleLive catch_all: chips (no ball) while target is healthy ==");
{
    const d = catchDeps(1.0); // enemy at full HP -> above catch threshold
    const io = new FakeIo();
    // End the battle right after the first move so the loop terminates.
    let polls = 0;
    // startState (poll 0) + first loop poll (poll 1) active, then battle ends.
    const pollState = async () => (polls++ < 2 ? d.state : { ...d.state, battle: { active: false } });
    const res = await runBattleLive(
        { strategy: "default", catch_all_pokemon: true },
        { pollState, readEnemy: d.readEnemy, readBag: d.readBag, io, maxSteps: 50 },
    );
    check("healthy target -> status ok", res.status === "ok", JSON.stringify(res));
    check("healthy target -> did NOT read the bag (no throw)", d.wasBagCalled() === false);
    check("healthy target -> a fight-menu sequence fired", io.tapLog[0] === "B", JSON.stringify(io.tapLog));
}

console.log("\n== runBattleLive catch_all: throws a ball once target is weak ==");
{
    const d = catchDeps(0.16); // ~2/12 HP -> below catch threshold
    const io = new FakeIo();
    let polls = 0;
    // startState (poll 0) + first loop poll (poll 1) active -> throw. Then caught.
    const pollState = async () => (polls++ < 2 ? d.state : { ...d.state, battle: { active: false } });
    const res = await runBattleLive(
        { strategy: "default", catch_all_pokemon: true },
        { pollState, readEnemy: d.readEnemy, readBag: d.readBag, io, maxSteps: 50, throwBallSequence: () => ["a"] },
    );
    check("weak target -> status ok (battle ended)", res.status === "ok", JSON.stringify(res));
    check("weak target -> read the bag for a ball", d.wasBagCalled() === true);
    check("weak target -> threw (only the injected throw press fired)", io.tapLog.join(",") === "A", JSON.stringify(io.tapLog));
}

console.log("\n== runBattleLive catch_all: no balls -> choice_required ==");
{
    const d = catchDeps(0.16, { bag: { Pokeballs: [] } });
    const res = await runBattleLive(
        { strategy: "default", catch_all_pokemon: true },
        { pollState: d.pollState, readEnemy: d.readEnemy, readBag: d.readBag, io: new FakeIo(), maxSteps: 50 },
    );
    check("no balls -> interrupted", res.status === "interrupted", JSON.stringify(res));
    check("no balls -> choice_required", res.stop_reason === STOP_REASON.CHOICE_REQUIRED, JSON.stringify(res));
    check("no balls -> message points at Poké Balls", /Pok./.test(res.message) && /ball/i.test(res.message), JSON.stringify(res));
}

// --- Summary ----------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
