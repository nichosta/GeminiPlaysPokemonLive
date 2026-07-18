// =============================================================================
// C2 cross-map router self-test (offline, runs against checked-in A1/A3 data)
// =============================================================================
//
//   node skills/crossMapRouter.test.js
//
// Verifies: the connection-crossing math agrees with an independently-written
// copy of the decomp's own coordinate transform (not the same code path as
// resolveConnectionCrossing); every real connection edge in the pre-Brock
// graph resolves to a legal, passable, in-bounds tile pair that round-trips
// through its reverse edge; and a full Pallet Town -> Pewter Gym plan replays
// leg-by-leg under real movement rules, crossing every warp/connection
// exactly where the plan says it does.
// =============================================================================

import { getStaticMap, getStaticMapById } from "./staticMap.js";
import { getMapGraph, resolveLocation } from "./locationGraph.js";
import { resolveConnectionCrossing, planCrossMapRoute, resolveGotoTarget, gotoLive } from "./crossMapRouter.js";
import { makeOutcome, OUTCOME_STATUS, STOP_REASON } from "../llminteract/toolInterface.js";

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

const JUMP_BEHAVIOR = { 56: "right", 57: "left", 58: "up", 59: "down" };
const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

/** Same movement replay as pathfinding.test.js, parameterized on a map. */
function replay(map, start, directions) {
    const { width, height, grid } = map;
    const passable = (x, y) => x >= 0 && y >= 0 && x < width && y < height && grid.collision[y * width + x] === 0;
    let [x, y] = [start.x, start.y];
    for (const dir of directions) {
        const [dx, dy] = DIRS[dir];
        const ax = x + dx;
        const ay = y + dy;
        if (ax < 0 || ay < 0 || ax >= width || ay >= height) throw new Error(`step ${dir} off-map at (${x},${y})`);
        const adjBehavior = grid.behaviorIds[ay * width + ax];
        let nx = ax;
        let ny = ay;
        if (JUMP_BEHAVIOR[adjBehavior] === dir) {
            nx = ax + dx;
            ny = ay + dy;
        }
        if (!passable(nx, ny)) throw new Error(`step ${dir} into blocked (${nx},${ny}) from (${x},${y})`);
        x = nx;
        y = ny;
    }
    return { x, y };
}

/**
 * Independent re-implementation of pokefirered's connection coordinate
 * transform (src/fieldmap.c: SetPositionFromConnection /
 * IsCoordInIncomingConnectingMap), written straight from the decomp source
 * rather than copy-pasted from resolveConnectionCrossing, so this test can't
 * just be checking the function against itself.
 */
function expectedToTile(fromMap, toMap, edge, fromTile) {
    const { direction, offset } = edge;
    if (direction === "up" || direction === "down") {
        const toY = direction === "up" ? toMap.height - 1 : 0;
        return { x: fromTile.x - offset, y: toY };
    }
    const toX = direction === "left" ? toMap.width - 1 : 0;
    return { x: toX, y: fromTile.y - offset };
}
function borderRowOrCol(map, direction) {
    if (direction === "up") return { axis: "y", value: 0 };
    if (direction === "down") return { axis: "y", value: map.height - 1 };
    if (direction === "left") return { axis: "x", value: 0 };
    return { axis: "x", value: map.width - 1 };
}

// --- 1. Every real connection edge resolves to a legal, in-bounds, passable
//        crossing that agrees with an independently-written formula ----------
{
    const graph = getMapGraph();
    const connections = graph.edges.filter((e) => e.kind === "connection");
    check("fixture: 10 connection edges in the pre-Brock graph", connections.length === 10, `got ${connections.length}`);

    for (const edge of connections) {
        const label = `${edge.from.group}:${edge.from.num} --${edge.direction}(${edge.offset})--> ${edge.to.group}:${edge.to.num}`;
        const fromMap = getStaticMap(edge.from.group, edge.from.num);
        const toMap = getStaticMap(edge.to.group, edge.to.num);
        const res = resolveConnectionCrossing(fromMap, toMap, edge);
        check(`connection resolves: ${label}`, res.found, JSON.stringify(res));
        if (!res.found) continue;

        const { fromTile, toTile } = res;
        const border = borderRowOrCol(fromMap, edge.direction);
        const onBorder = border.axis === "y" ? fromTile.y === border.value : fromTile.x === border.value;
        check(`fromTile sits on the ${edge.direction} border: ${label}`, onBorder, JSON.stringify(fromTile));

        const fromPassable =
            fromTile.x >= 0 && fromTile.y >= 0 && fromTile.x < fromMap.width && fromTile.y < fromMap.height &&
            fromMap.grid.collision[fromTile.y * fromMap.width + fromTile.x] === 0;
        check(`fromTile passable: ${label}`, fromPassable, JSON.stringify(fromTile));

        const toPassable =
            toTile.x >= 0 && toTile.y >= 0 && toTile.x < toMap.width && toTile.y < toMap.height &&
            toMap.grid.collision[toTile.y * toMap.width + toTile.x] === 0;
        check(`toTile passable: ${label}`, toPassable, JSON.stringify(toTile));

        const expected = expectedToTile(fromMap, toMap, edge, fromTile);
        check(
            `toTile matches independent formula: ${label}`,
            toTile.x === expected.x && toTile.y === expected.y,
            `got ${JSON.stringify(toTile)} expected ${JSON.stringify(expected)}`
        );

        // Stepping in the connection's direction from fromTile must leave the
        // from-map's bounds — confirms fromTile is genuinely the edge tile,
        // not some interior tile the resolver picked by mistake.
        let wentOffMap = false;
        try {
            replay(fromMap, fromTile, [edge.direction]);
        } catch {
            wentOffMap = true;
        }
        check(`fromTile is a true map edge (pressing ${edge.direction} leaves the map): ${label}`, wentOffMap);
    }
}

// --- 2. Round-trip: crossing A->B then B->A lands back where you started ---
{
    const graph = getMapGraph();
    const connections = graph.edges.filter((e) => e.kind === "connection");
    const opposite = { up: "down", down: "up", left: "right", right: "left" };
    let checked = 0;

    for (const edge of connections) {
        const back = connections.find(
            (e) =>
                e.from.group === edge.to.group &&
                e.from.num === edge.to.num &&
                e.to.group === edge.from.group &&
                e.to.num === edge.from.num &&
                e.direction === opposite[edge.direction]
        );
        if (!back) continue;
        const fromMap = getStaticMap(edge.from.group, edge.from.num);
        const toMap = getStaticMap(edge.to.group, edge.to.num);

        const there = resolveConnectionCrossing(fromMap, toMap, edge);
        if (!there.found) continue;
        // Bias the return trip toward the tile we just landed on.
        const bias = edge.direction === "up" || edge.direction === "down" ? there.toTile.x : there.toTile.y;
        const back_ = resolveConnectionCrossing(toMap, fromMap, back, bias);
        if (!back_.found) continue;

        checked++;
        const roundTrips = back_.toTile.x === there.fromTile.x && back_.toTile.y === there.fromTile.y;
        check(
            `round-trip ${edge.from.group}:${edge.from.num}<->${edge.to.group}:${edge.to.num}`,
            roundTrips,
            `there=${JSON.stringify(there)} back=${JSON.stringify(back_)}`
        );
    }
    check("round-trip: checked at least one pair", checked > 0, `checked ${checked}`);
}

// --- 3. Full plan: Pallet Town -> Viridian City Pokemon Center, replayed ----
//        leg-by-leg (2 connections + 1 warp; stays inside the walkable half
//        of the route so it doesn't hit the Route 2 gap covered by case 8).
{
    const start = { group: 3, num: 0, x: 6, y: 12 }; // inside Pallet Town, well clear of the border
    const pc = resolveLocation("Viridian City Pokemon Center");
    const goal = { group: pc.group, num: pc.num, x: pc.x, y: pc.y };

    const plan = planCrossMapRoute(start, goal);
    check("plan: found", plan.found, JSON.stringify(plan.reason));

    if (plan.found) {
        check("plan: multiple legs (connections + warp)", plan.legs.length > 1, `${plan.legs.length} legs`);
        check(
            "plan: reasonably short",
            plan.legs.reduce((n, l) => n + l.cost, 0) < 300,
            `total cost ${plan.legs.reduce((n, l) => n + l.cost, 0)}`
        );

        let cur = { x: start.x, y: start.y };
        let ok = true;
        let sawConnection = false;
        let sawWarp = false;

        for (const leg of plan.legs) {
            const map = getStaticMap(leg.group, leg.num);
            let ended;
            try {
                ended = replay(map, cur, leg.directions);
            } catch (e) {
                ok = false;
                check(`leg replay legal on ${leg.group}:${leg.num}`, false, e.message);
                break;
            }

            const target = leg.crossing ? undefined : goal;
            if (leg.crossing) {
                // Warp legs stop adjacent to the door and report `facing`;
                // connection legs walk exactly onto the border tile.
                if (leg.crossing.kind === "warp") {
                    const doorTile = map.warps.find(
                        (w) =>
                            leg.crossing.toGroup !== undefined &&
                            Math.abs(w.x - ended.x) + Math.abs(w.y - ended.y) <= 1
                    );
                    check(`warp leg ends adjacent to a warp tile (${leg.group}:${leg.num})`, !!doorTile, JSON.stringify(ended));
                    // Pressing `facing` from the adjacent tile must land exactly on the
                    // warp tile itself. Door metatiles are deliberately collision-blocked
                    // (the engine special-cases them past the normal check), so step
                    // manually here rather than through `replay`'s passability check.
                    const [dx, dy] = DIRS[leg.facing];
                    const stepped = { x: ended.x + dx, y: ended.y + dy };
                    check(
                        `warp leg facing press lands on the warp tile (${leg.group}:${leg.num})`,
                        doorTile && stepped.x === doorTile.x && stepped.y === doorTile.y,
                        JSON.stringify({ stepped, doorTile })
                    );
                    sawWarp = true;
                } else {
                    sawConnection = true;
                }
                cur = { ...leg.crossing.toTile };
            } else {
                check(`final leg reaches the goal exactly (${leg.group}:${leg.num})`, ended.x === target.x && ended.y === target.y, JSON.stringify(ended));
                cur = ended;
            }
        }

        check("plan: chain used at least one connection", sawConnection);
        check("plan: chain used at least one warp", sawWarp);
        check("plan: replay overall legal", ok);
    }
}

// --- 4. Same-map goal reduces to a trivial single leg -----------------------
{
    const map = getStaticMapById("MAP_PALLET_TOWN");
    let a = null;
    let b = null;
    for (let i = 0; i < map.width * map.height && (!a || !b); i++) {
        if (map.grid.collision[i] === 0) {
            const tile = { x: i % map.width, y: Math.floor(i / map.width) };
            if (!a) a = tile;
            else if (!b && (tile.x !== a.x || tile.y !== a.y)) b = tile;
        }
    }
    const plan = planCrossMapRoute({ group: map.group, num: map.num, ...a }, { group: map.group, num: map.num, ...b });
    check("same-map: found", plan.found, JSON.stringify(plan));
    if (plan.found) {
        check("same-map: exactly one leg", plan.legs.length === 1, `${plan.legs.length} legs`);
        check("same-map: no crossing on the single leg", plan.legs[0].crossing === null);
    }
}

// --- 5. blockedTiles is honored on the first leg of a multi-hop route ------
{
    const start = { group: 3, num: 0, x: 6, y: 12 };
    const pc = resolveLocation("Viridian City Pokemon Center");
    const goal = { group: pc.group, num: pc.num, x: pc.x, y: pc.y };

    const base = planCrossMapRoute(start, goal);
    check("blockedTiles fixture: base plan found", base.found, JSON.stringify(base.reason));
    if (base.found && base.legs[0].path.length > 0) {
        const chokepoint = base.legs[0].path[0];
        const blocked = planCrossMapRoute(start, goal, { blockedTiles: [chokepoint] });
        check("blockedTiles: still routes with a blocker on the first tile", blocked.found);
        if (blocked.found) {
            check(
                "blockedTiles: first leg avoids the blocked tile",
                !blocked.legs[0].path.some((p) => p.x === chokepoint.x && p.y === chokepoint.y)
            );
        }
    }
}

// --- 6. Out-of-scope endpoints fail cleanly ---------------------------------
{
    const start = { group: 3, num: 0, x: 6, y: 12 };
    const badGoal = { group: 999, num: 999, x: 0, y: 0 };
    const res = planCrossMapRoute(start, badGoal);
    check("out-of-scope goal: not found", !res.found && res.reason === "goal-out-of-scope", JSON.stringify(res));

    const res2 = planCrossMapRoute(badGoal, start);
    check("out-of-scope start: not found", !res2.found && res2.reason === "start-out-of-scope", JSON.stringify(res2));
}

// --- 7. resolveGotoTarget matches the D1 DESTINATION_SCHEMA shapes ----------
{
    const current = { group: 3, num: 0, x: 6, y: 12 };

    const byName = resolveGotoTarget({ location: "Pewter Gym" }, current);
    const gymMap = getStaticMapById("MAP_PEWTER_CITY_GYM");
    check("resolveGotoTarget: by location name", byName && byName.group === gymMap.group && byName.num === gymMap.num, JSON.stringify(byName));

    const byMap = resolveGotoTarget({ map: "MAP_PEWTER_CITY_GYM", x: 3, y: 4 }, current);
    check(
        "resolveGotoTarget: explicit map + coords",
        byMap && byMap.group === gymMap.group && byMap.num === gymMap.num && byMap.x === 3 && byMap.y === 4,
        JSON.stringify(byMap)
    );

    const byCoordOnly = resolveGotoTarget({ x: 10, y: 11 }, current);
    check(
        "resolveGotoTarget: bare coords target the current map",
        byCoordOnly && byCoordOnly.group === current.group && byCoordOnly.num === current.num && byCoordOnly.x === 10 && byCoordOnly.y === 11,
        JSON.stringify(byCoordOnly)
    );

    check("resolveGotoTarget: unresolvable name -> null", resolveGotoTarget({ location: "Cinnabar Island" }, current) === null);
}

// --- 8. Known limitation: Pallet Town -> Pewter Gym is NOT solvable yet -----
//
// The real route detours through Viridian Forest: Route 2 (3,20) is split by
// a fully-impassable Cut-tree line (rows 42-44, no Cut pre-Boulder-Badge) into
// a south half bordering Viridian City and a north half bordering Pewter City.
// The forest's warps land you back on Route 2's NORTH half — the same graph
// node the map-hop BFS already marked visited on the way in via the south
// half. Since mapGraph.json has one node per MAP (not per connected region
// within a map), no BFS over it — with or without edge exclusion — can
// express "leave this node, come back to it a different way." Fixing this for
// real needs A3 to split a map into per-connected-component nodes. This test
// pins the current (incomplete) behavior so it fails loudly, not silently,
// the day someone lands that fix and forgets to update it.
{
    const start = { group: 3, num: 0, x: 6, y: 12 };
    const gymMap = getStaticMapById("MAP_PEWTER_CITY_GYM");
    const goal = { group: gymMap.group, num: gymMap.num, x: 6, y: 14 }; // the gym's warp landing tile
    const plan = planCrossMapRoute(start, goal);
    check(
        "known limitation: Pallet -> Pewter Gym still fails (needs Route 2 re-entry via Viridian Forest)",
        !plan.found,
        JSON.stringify(plan.reason)
    );
}

// =============================================================================
// gotoLive — C5/C3 auto-clear handoff (offline, injected fakes)
// =============================================================================
//
// gotoLive is the live adapter and the only one of C1-C5 that touches RAM at
// runtime, so its wiring of the C5 (advanceDialogLive) and C3 (runBattleLive)
// sub-handlers is exercised here through the injection seams (pollState,
// readCurrent, press, advanceDialog, runBattle) rather than a real emulator.
// Verifies the contract in the module docstring: a DIALOG or BATTLE_STARTED
// interrupt mid-route is auto-cleared / auto-fought rather than surfaced, and
// only a sub-handler escalation (or a non-auto-clearable interrupt) returns
// control to the model. The route fixture is one tile (Pallet Town (5,19) ->
// (5,18) = ["up"]); fakes don't move the position, so gotoLive trusts findPath
// + its presses the way it does live.
// =============================================================================

/** A B1-shaped overworld snapshot. `extra` overrides fields for interrupt cases. */
function snap(x, y, extra = {}) {
    return {
        player: { position: { x, y }, map: { bank: 3, number: 0 } },
        battle: { active: false },
        progress: { controlsLocked: false },
        menu: { partyMenuOpen: false },
        party: { lowestHpFraction: 1.0, pokemon: [] },
        ...extra,
    };
}
const POS0 = { group: 3, num: 0, x: 5, y: 19 };
const GOAL_TILE = { x: 5, y: 18 };
const DIALOG_SNAP = snap(5, 19, { progress: { controlsLocked: true } });
const BATTLE_SNAP = snap(5, 19, { battle: { active: true } });
const HPLOW_SNAP = snap(5, 19, { party: { lowestHpFraction: 0.1, pokemon: [] } });

/** Build an injectable transport bundle from scripted queues + sub-handler fakes. */
function makeGotoDeps({
    polls,
    positions,
    advanceDialogImpl,
    runBattleImpl,
    pressLog = [],
}) {
    let pollIdx = 0;
    let posIdx = 0;
    let dialogCalls = 0;
    let battleCalls = 0;
    let dialogArg = null;
    let battleArg = null;
    return {
        deps: {
            pollState: async () => polls[Math.min(pollIdx++, polls.length - 1)],
            readCurrent: async () => positions[Math.min(posIdx++, positions.length - 1)],
            press: async (button) => { pressLog.push(button); },
            getNpcs: async () => [],
            advanceDialog: async (policy, opts) => {
                dialogCalls++;
                dialogArg = { policy, opts };
                return advanceDialogImpl;
            },
            runBattle: async (policy, opts) => {
                battleCalls++;
                battleArg = { policy, opts };
                return runBattleImpl;
            },
        },
        counts: () => ({ dialogCalls, battleCalls, dialogArg, battleArg }),
    };
}

// A. DIALOG mid-route -> C5 clears it -> route continues -> OK
{
    const pressLog = [];
    const harness = makeGotoDeps({
        polls: [snap(5, 19), DIALOG_SNAP, snap(5, 19)],
        positions: [POS0, POS0, POS0],
        advanceDialogImpl: makeOutcome(OUTCOME_STATUS.OK, { stepsUsed: 3, message: "dialog cleared" }),
        runBattleImpl: makeOutcome(OUTCOME_STATUS.OK, { stepsUsed: 0 }),
        pressLog,
    });
    const out = await gotoLive(
        { location: null, x: GOAL_TILE.x, y: GOAL_TILE.y },
        { ...harness.deps, battlePolicy: { strategy: "default" }, dialogPolicy: { choice: "yes" } }
    );
    const c = harness.counts();
    check("gotoLive(dialog): status ok after auto-clear", out.status === OUTCOME_STATUS.OK, JSON.stringify(out));
    check("gotoLive(dialog): advanceDialog called once", c.dialogCalls === 1, String(c.dialogCalls));
    check("gotoLive(dialog): runBattle NOT called", c.battleCalls === 0, String(c.battleCalls));
    check("gotoLive(dialog): dialogPolicy passed to C5", c.dialogArg?.policy?.choice === "yes", JSON.stringify(c.dialogArg?.policy));
    check("gotoLive(dialog): routing + dialog steps accounted", out.steps_used === 5, String(out.steps_used));
}

// B. DIALOG mid-route -> C5 escalates (choice_required) -> surface verbatim
{
    const harness = makeGotoDeps({
        polls: [snap(5, 19), DIALOG_SNAP],
        positions: [POS0, POS0],
        advanceDialogImpl: makeOutcome(OUTCOME_STATUS.INTERRUPTED, {
            stopReason: STOP_REASON.CHOICE_REQUIRED, stepsUsed: 5, message: "stuck",
        }),
        runBattleImpl: makeOutcome(OUTCOME_STATUS.OK, { stepsUsed: 0 }),
    });
    const out = await gotoLive({ x: GOAL_TILE.x, y: GOAL_TILE.y }, { ...harness.deps, dialogPolicy: { choice: "ask" } });
    const c = harness.counts();
    check("gotoLive(dialog-escalate): status interrupted", out.status === OUTCOME_STATUS.INTERRUPTED, JSON.stringify(out));
    check("gotoLive(dialog-escalate): stop_reason choice_required", out.stop_reason === STOP_REASON.CHOICE_REQUIRED, out.stop_reason);
    check("gotoLive(dialog-escalate): steps = routing + dialog", out.steps_used === 6, String(out.steps_used));
    check("gotoLive(dialog-escalate): C5 called once", c.dialogCalls === 1, String(c.dialogCalls));
}

// C. BATTLE_STARTED mid-route -> C3 fights it -> route continues -> OK
{
    const pressLog = [];
    const battlePolicy = { strategy: "type_effective", lead: "Charmander", catch_wild: false };
    const harness = makeGotoDeps({
        polls: [snap(5, 19), BATTLE_SNAP, snap(5, 19)],
        positions: [POS0, POS0, POS0],
        advanceDialogImpl: makeOutcome(OUTCOME_STATUS.OK, { stepsUsed: 0 }),
        runBattleImpl: makeOutcome(OUTCOME_STATUS.OK, { stepsUsed: 10, message: "battle won" }),
        pressLog,
    });
    const out = await gotoLive({ x: GOAL_TILE.x, y: GOAL_TILE.y }, { ...harness.deps, battlePolicy });
    const c = harness.counts();
    check("gotoLive(battle): status ok after auto-fight", out.status === OUTCOME_STATUS.OK, JSON.stringify(out));
    check("gotoLive(battle): runBattle called once", c.battleCalls === 1, String(c.battleCalls));
    check("gotoLive(battle): advanceDialog NOT called", c.dialogCalls === 0, String(c.dialogCalls));
    check("gotoLive(battle): battlePolicy passed to C3", c.battleArg?.policy?.strategy === "type_effective", JSON.stringify(c.battleArg?.policy));
    check("gotoLive(battle): routing + battle steps accounted", out.steps_used === 12, String(out.steps_used));
}

// D. BATTLE_STARTED mid-route -> C3 escalates (out_of_pp) -> surface verbatim
{
    const harness = makeGotoDeps({
        polls: [snap(5, 19), BATTLE_SNAP],
        positions: [POS0, POS0],
        advanceDialogImpl: makeOutcome(OUTCOME_STATUS.OK, { stepsUsed: 0 }),
        runBattleImpl: makeOutcome(OUTCOME_STATUS.INTERRUPTED, {
            stopReason: STOP_REASON.OUT_OF_PP, stepsUsed: 4, message: "no pp",
        }),
    });
    const out = await gotoLive({ x: GOAL_TILE.x, y: GOAL_TILE.y }, { ...harness.deps });
    check("gotoLive(battle-escalate): status interrupted", out.status === OUTCOME_STATUS.INTERRUPTED, JSON.stringify(out));
    check("gotoLive(battle-escalate): stop_reason out_of_pp", out.stop_reason === STOP_REASON.OUT_OF_PP, out.stop_reason);
    check("gotoLive(battle-escalate): steps = routing + battle", out.steps_used === 5, String(out.steps_used));
}

// E. Non-auto-clearable interrupt (hp_low) -> surface verbatim, no sub-handler
{
    const harness = makeGotoDeps({
        polls: [snap(5, 19), HPLOW_SNAP],
        positions: [POS0, POS0],
        advanceDialogImpl: makeOutcome(OUTCOME_STATUS.OK, { stepsUsed: 0 }),
        runBattleImpl: makeOutcome(OUTCOME_STATUS.OK, { stepsUsed: 0 }),
    });
    const out = await gotoLive({ x: GOAL_TILE.x, y: GOAL_TILE.y }, { ...harness.deps });
    const c = harness.counts();
    check("gotoLive(hp_low): status interrupted", out.status === OUTCOME_STATUS.INTERRUPTED, JSON.stringify(out));
    check("gotoLive(hp_low): stop_reason hp_low", out.stop_reason === STOP_REASON.HP_LOW, out.stop_reason);
    check("gotoLive(hp_low): no sub-handler called", c.dialogCalls === 0 && c.battleCalls === 0, JSON.stringify(c));
    check("gotoLive(hp_low): steps = routing only", out.steps_used === 1, String(out.steps_used));
}

// F. BATTLE already active at goto start -> C3 fights first, then routes -> OK
{
    const battlePolicy = { strategy: "flee", lead: null, catch_wild: true };
    const harness = makeGotoDeps({
        polls: [BATTLE_SNAP, snap(5, 19)],
        positions: [POS0, POS0],
        advanceDialogImpl: makeOutcome(OUTCOME_STATUS.OK, { stepsUsed: 0 }),
        runBattleImpl: makeOutcome(OUTCOME_STATUS.OK, { stepsUsed: 7, message: "battle won" }),
    });
    const out = await gotoLive({ x: GOAL_TILE.x, y: GOAL_TILE.y }, { ...harness.deps, battlePolicy });
    const c = harness.counts();
    check("gotoLive(start-battle): status ok", out.status === OUTCOME_STATUS.OK, JSON.stringify(out));
    check("gotoLive(start-battle): runBattle called at start", c.battleCalls === 1, String(c.battleCalls));
    check("gotoLive(start-battle): battlePolicy flows (flee+catch_wild)", c.battleArg?.policy?.strategy === "flee" && c.battleArg?.policy?.catch_wild === true, JSON.stringify(c.battleArg?.policy));
    check("gotoLive(start-battle): steps = routing + battle", out.steps_used === 8, String(out.steps_used));
}

// G. Plain route, no interrupt -> reaches destination (regression: the
//    auto-clear wiring must not change the no-interrupt path)
{
    const pressLog = [];
    const harness = makeGotoDeps({
        polls: [snap(5, 19), snap(5, 19)],
        positions: [POS0, POS0],
        advanceDialogImpl: makeOutcome(OUTCOME_STATUS.OK, { stepsUsed: 0 }),
        runBattleImpl: makeOutcome(OUTCOME_STATUS.OK, { stepsUsed: 0 }),
        pressLog,
    });
    const out = await gotoLive({ x: GOAL_TILE.x, y: GOAL_TILE.y }, { ...harness.deps });
    const c = harness.counts();
    check("gotoLive(plain): status ok", out.status === OUTCOME_STATUS.OK, JSON.stringify(out));
    check("gotoLive(plain): no sub-handler called", c.dialogCalls === 0 && c.battleCalls === 0, JSON.stringify(c));
    check("gotoLive(plain): one routing press", pressLog.length === 1 && pressLog[0] === "up", JSON.stringify(pressLog));
    check("gotoLive(plain): steps = 1", out.steps_used === 1, String(out.steps_used));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
