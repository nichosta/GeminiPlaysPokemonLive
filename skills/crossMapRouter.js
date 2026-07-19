// =============================================================================
// CROSS-MAP ROUTER (C2)
// =============================================================================
//
// "goto Pewter City" = A3's map-hop graph search, C1's within-map A* per leg,
// and warp/connection traversal to stitch the legs together.
//
// Two layers, same split as C1 (pathfinding.js):
//   - `planCrossMapRoute` is pure: given a start (group,num,x,y) and a goal, it
//     walks A3's `mapRoute` hop list and calls C1's `findPath` once per map,
//     resolving each warp/connection crossing to concrete tiles. No RAM access,
//     fully exercised by crossMapRouter.test.js against checked-in static data.
//   - `gotoLive` is the live adapter: it re-derives one leg at a time against
//     the CURRENT map only (so B1's live NPC positions fold in fresh at every
//     map, the way findPathLive already does for a single map), executes each
//     leg's button sequence, and polls B2's `classifyInterrupt`
//     (gamestate/interruptDetector.js) after every press (battle/dialog/menu/
//     low-HP). Map changes are expected progress here (that's what a
//     warp/connection crossing IS), so no `baselineMap` is passed and warp
//     detection stays off — the loop just re-derives the next leg from
//     wherever it lands instead.
//
// Connection-edge math (`resolveConnectionCrossing`) is taken from the
// decomp's own coordinate transform (pokefirered src/fieldmap.c,
// SetPositionFromConnection / IsCoordInIncomingConnectingMap), not guessed:
// for a vertical (up/down) connection the two maps' x-coordinates relate by
// `to.x = from.x - offset`; for a horizontal (left/right) connection it's
// `to.y = from.y - offset`. Verified against the real Pallet->Pewter route's
// connection edges (offsets -12/0/12) in the test.
// =============================================================================

// Gen-3 overworld walking speed: one tile per 16 frames. A held direction
// walks continuously at exactly this rate, which is what lets gotoLive batch
// straight-line stretches into single frame-counted holds instead of
// tap-per-tile (each tap being a full HTTP round-trip + settle).
const WALK_FRAMES_PER_TILE = 16;
// Longest single held run, in tiles. Bounds how long the harness goes between
// interrupt polls (12 tiles ≈ 192 frames ≈ 3.2s) so a battle/dialog starting
// mid-run is still caught promptly.
const MAX_HOLD_TILES = 12;
// Buttons a held run can batch (plain movement only — crossing presses and
// menu buttons stay single taps).
const HOLDABLE_DIRECTIONS = new Set(["up", "down", "left", "right"]);

// Metatile behaviors (staticdata/frlg/metatile_behaviors.json ids) that make a
// tile a FUNCTIONAL warp trigger. Multi-tile door mats (gyms, gatehouses) list
// every mat tile in `map.warps`, but live-verified only the tile carrying the
// warp behavior actually fires (Pewter Gym exit: (6,14) behavior 101 works,
// (5,14)/(7,14) behavior 0 are dead; Route 2 gatehouse south door: same
// pattern at (7,10)). Tiles listed as warps WITHOUT one of these behaviors
// are dead mat-decoration and must not be targeted for a crossing.
const FUNCTIONAL_WARP_BEHAVIORS = new Set([
    96,  // MB_CAVE_DOOR
    97,  // MB_LADDER
    98, 99, 100, 101, // arrow warps (E/W/N/S) — see ARROW_WARP_PRESS
    102, // MB_FALL_WARP
    103, // MB_REGULAR_WARP
    104, // MB_LAVARIDGE_1F_WARP
    105, // MB_WARP_DOOR
    106, 107, // escalators
    108, 109, 110, 111, // stair warps
    113, // MB_UNION_ROOM_WARP
]);

// Arrow-warp mats are WALKABLE tiles that fire when the player stands ON the
// tile and presses the arrow's direction (not when walking onto them) — a
// different crossing procedure from door metatiles, which read as
// collision-blocked and fire when pressed INTO from the adjacent tile.
const ARROW_WARP_PRESS = Object.freeze({
    98: "right", // MB_EAST_ARROW_WARP
    99: "left",  // MB_WEST_ARROW_WARP
    100: "up",   // MB_NORTH_ARROW_WARP
    101: "down", // MB_SOUTH_ARROW_WARP
});

import { findPath } from "./pathfinding.js";
import { getStaticMap, getStaticMapById, componentOf, getComponentLabels } from "./staticMap.js";
import { mapRoute, resolveDestination, edgeKey } from "./locationGraph.js";
import { makeOutcome, OUTCOME_STATUS, STOP_REASON } from "../llminteract/toolInterface.js";
import { classifyInterrupt } from "../gamestate/interruptDetector.js";
import { advanceDialogLive } from "./dialogHandler.js";
import { runBattleLive } from "./battlePolicy.js";

// -----------------------------------------------------------------------------
// Low HP is NOT an interrupt for goto (it never was safe to block routing on
// the very condition that requires routing to a Pokécenter). classifyInterrupt
// no longer produces HP_LOW at all — see gamestate/interruptDetector.js — so
// goto classifies with the plain detector, same vocabulary as every other macro.
// -----------------------------------------------------------------------------

/**
 * Resolves the exact border-tile pair for a connection edge between two maps,
 * per the decomp's connection math (see module docstring). Multiple tiles
 * along the border can be valid (both sides in-bounds and passable); `bias`
 * (the traveller's current coordinate along the border axis) picks the
 * closest one so the approach isn't a detour.
 *
 * When `fromComponentFilter` is given (A3's per-component graph splits a
 * connection into one edge per border component), only border tiles whose
 * component label matches are considered — so on a multi-component border the
 * resolver picks a tile the traveller can actually reach instead of one in a
 * different region (which would make C1 no-path and wrongly exclude a valid
 * edge). Single-component borders (the common case) are unaffected.
 *
 * @param {object} fromMap Static map JSON for the edge's `from` side.
 * @param {object} toMap Static map JSON for the edge's `to` side.
 * @param {{direction:"up"|"down"|"left"|"right", offset:number}} edge
 * @param {number} [bias] Preferred coordinate along the border axis (x for
 *        up/down, y for left/right). Defaults to the middle of the valid range.
 * @param {{labels:number[], component:number}} [fromComponentFilter] Optional:
 *        only pick from-side border tiles whose label === `component`.
 * @returns {{found:boolean, fromTile?:{x:number,y:number}, toTile?:{x:number,y:number}, reason?:string}}
 */
export function resolveConnectionCrossing(fromMap, toMap, edge, bias, fromComponentFilter) {
    const { direction, offset } = edge;
    let vertical; // true: up/down, varying coord is x. false: left/right, varying coord is y.
    let fromFixed; // the from-map's fixed row (vertical) or column (horizontal)
    let toFixed; // the to-map's fixed row/column, mirrored across the border
    switch (direction) {
        case "up":
            vertical = true;
            fromFixed = 0;
            toFixed = toMap.height - 1;
            break;
        case "down":
            vertical = true;
            fromFixed = fromMap.height - 1;
            toFixed = 0;
            break;
        case "left":
            vertical = false;
            fromFixed = 0;
            toFixed = toMap.width - 1;
            break;
        case "right":
            vertical = false;
            fromFixed = fromMap.width - 1;
            toFixed = 0;
            break;
        default:
            return { found: false, reason: "bad-direction" };
    }

    const fromDim = vertical ? fromMap.width : fromMap.height;
    const toDim = vertical ? toMap.width : toMap.height;

    // to.coord = from.coord - offset; valid where both maps are in-bounds.
    const lo = Math.max(0, offset);
    const hi = Math.min(fromDim, offset + toDim); // exclusive
    if (lo >= hi) return { found: false, reason: "no-overlap" };

    if (bias === undefined || bias === null) bias = Math.floor((lo + hi - 1) / 2);

    const passableFrom = (v) => {
        const x = vertical ? v : fromFixed;
        const y = vertical ? fromFixed : v;
        return fromMap.grid.collision[y * fromMap.width + x] === 0;
    };
    const passableTo = (v) => {
        const toV = v - offset;
        const x = vertical ? toV : toFixed;
        const y = vertical ? toFixed : toV;
        return toMap.grid.collision[y * toMap.width + x] === 0;
    };
    // Border-tile component label (from side), or -1 when no filter is given.
    const filterLabels = fromComponentFilter ? fromComponentFilter.labels : null;
    const filterComponent = fromComponentFilter ? fromComponentFilter.component : null;
    const labelOf = (v) => {
        const x = vertical ? v : fromFixed;
        const y = vertical ? fromFixed : v;
        return filterLabels[y * fromMap.width + x];
    };

    let best = null;
    let bestDist = Infinity;
    for (let v = lo; v < hi; v++) {
        if (!passableFrom(v) || !passableTo(v)) continue;
        if (filterLabels && labelOf(v) !== filterComponent) continue;
        const dist = Math.abs(v - bias);
        if (dist < bestDist) {
            bestDist = dist;
            best = v;
        }
    }
    if (best === null) return { found: false, reason: "no-passable-crossing" };

    const fromTile = vertical ? { x: best, y: fromFixed } : { x: fromFixed, y: best };
    const toTile = vertical ? { x: best - offset, y: toFixed } : { x: toFixed, y: best - offset };
    return { found: true, fromTile, toTile };
}

/**
 * Plans ONE map leg: either the walk to a warp/connection crossing (when
 * `edge` is given) or the walk to the final goal tile (when `finalGoal` is
 * given). Shared by the pure planner and the live executor so the two never
 * disagree about how a leg is built.
 *
 * @param {{map:object, pos:{x:number,y:number}, options?:object, edge?:object, toMap?:object, finalGoal?:{x:number,y:number}}} args
 * @returns {{found:boolean, reason?:string, path?:Array, directions?:string[], cost?:number, facing?:string, crossing:object|null}}
 */
function buildMapLeg({ map, pos, options = {}, edge, toMap, finalGoal }) {
    if (finalGoal) {
        const res = findPath(map, pos, finalGoal, options);
        if (!res.found) return { found: false, reason: res.reason };
        return { ...res, crossing: null };
    }

    if (edge.kind === "warp") {
        // Behavior-aware target pick: if the edge's listed fromTile is a dead
        // mat tile (no warp behavior) but a same-destination warp tile in the
        // same cluster HAS one, retarget to the functional tile.
        const behaviorAt = (x, y) => (map.grid?.behaviorIds ? map.grid.behaviorIds[y * map.width + x] : undefined);
        let target = edge.fromTile;
        const targetBehavior = behaviorAt(target.x, target.y);
        if (
            targetBehavior !== undefined &&
            !FUNCTIONAL_WARP_BEHAVIORS.has(targetBehavior) &&
            Array.isArray(map.warps)
        ) {
            const functional = map.warps.find((w) =>
                w.dest_group === edge.to.group &&
                w.dest_num === edge.to.num &&
                Math.abs(w.x - target.x) + Math.abs(w.y - target.y) <= 2 &&
                FUNCTIONAL_WARP_BEHAVIORS.has(behaviorAt(w.x, w.y))
            );
            if (functional) target = { x: functional.x, y: functional.y };
        }

        // Arrow-warp mat: a WALKABLE tile that fires on a directional press
        // while standing ON it. Route onto the tile itself and press the
        // arrow's direction — the adjacent-tile door procedure below never
        // fires these (live-verified on the Pewter Gym exit).
        const arrowPress = ARROW_WARP_PRESS[behaviorAt(target.x, target.y)];
        if (arrowPress) {
            const res = findPath(map, pos, target, { ...options, stopAdjacent: false });
            if (!res.found) return { found: false, reason: res.reason };
            return {
                ...res,
                crossing: { kind: "warp", press: arrowPress, toGroup: edge.to.group, toNum: edge.to.num, toTile: edge.toTile },
            };
        }

        // Door metatiles read as collision-blocked (see staticdata/README.md /
        // A1's note); stand adjacent and press the facing direction to cross.
        const res = findPath(map, pos, target, { ...options, stopAdjacent: true });
        if (!res.found) return { found: false, reason: res.reason };
        // Already standing exactly on the warp tile (can happen when a prior
        // crossing attempt landed here without the warp firing, or gotoLive
        // re-derives mid-transition). findPath's plan from a start===goal
        // position is "walk away one tile, then face back" — but two live
        // reproductions this session disagreed on whether that's the right
        // move: Oak's Lab's door needed to be re-approached WITHOUT the
        // detour (the detour's direction-reversal reliably failed to
        // re-trigger it, producing an infinite oscillation), while a Route 2
        // gatehouse door needed the FULL detour (its "crossing" direction is
        // walled off when tried directly from the tile — walking away is the
        // only way to get a legal, fresh step back onto it). Neither is
        // universally correct and there's no static signal here to tell them
        // apart in advance. So: try the full detour by default (matches most
        // doors, and is what findPath naturally computes); `gotoLive`'s stall
        // guard detects when THIS specific approach isn't working and sets
        // `options.skipWarpDetour` to retry with the other one before giving
        // up entirely — see its comment for the two-strategy retry.
        const atGoal = pos.x === target.x && pos.y === target.y;
        const skipDetour = atGoal && options.skipWarpDetour;
        return {
            ...res,
            directions: skipDetour ? [] : res.directions,
            path: skipDetour ? [] : res.path,
            cost: skipDetour ? 0 : res.cost,
            crossing: { kind: "warp", press: res.facing, toGroup: edge.to.group, toNum: edge.to.num, toTile: edge.toTile },
        };
    }

    // Connection: walk onto the (passable) border tile, then one more press
    // in the connection's direction carries the player across the seam. The
    // edge is per-component (A3), so constrain the border pick to tiles in the
    // traveller's component — matters on multi-component borders (Route 22),
    // and is a no-op on the single-component borders the critical path uses.
    const bias = edge.direction === "up" || edge.direction === "down" ? pos.x : pos.y;
    const compLabels = edge.from && edge.from.component != null ? getComponentLabels(map.group, map.num) : null;
    const compFilter = compLabels ? { labels: compLabels.labels, component: edge.from.component } : null;
    const crossing = resolveConnectionCrossing(map, toMap, edge, bias, compFilter);
    if (!crossing.found) return { found: false, reason: crossing.reason };
    const res = findPath(map, pos, crossing.fromTile, { ...options, stopAdjacent: false });
    if (!res.found) return { found: false, reason: res.reason };
    return {
        ...res,
        crossing: { kind: "connection", press: edge.direction, toGroup: edge.to.group, toNum: edge.to.num, toTile: crossing.toTile },
    };
}

/**
 * Cap on how many times `planCrossMapRoute` will exclude a graph-connected but
 * unwalkable hop and re-run the BFS before giving up. The pre-Brock graph has
 * ~110 edges; this is generous headroom, not a tuned constant.
 */
const MAX_REPLAN_ATTEMPTS = 8;

/**
 * Pure cross-map route planner: composes A3's map-hop BFS with a C1 leg per
 * map. `options.blockedTiles` (live NPCs etc.) only makes sense for the map
 * the traveller is actually standing on, so it is honored on the first leg
 * only — later legs are planned blind, the same limitation `findPathLive` has
 * for a single map. `gotoLive` below re-derives each later leg live instead of
 * trusting this plan past the first map.
 *
 * The map graph is unweighted and knows nothing about what's actually walkable
 * *inside* a map. When a hop's within-map leg comes back no-path, that specific
 * edge is excluded and the BFS is re-run rather than failing the whole plan on
 * a graph-level shortest path that isn't actually walkable — this recovers
 * whenever a genuinely different map-level route exists.
 *
 * The graph has ONE NODE PER CONNECTED COMPONENT, not per map (A3 splits a
 * bisected map like Route 2 into its north and south halves). That lets the BFS
 * re-enter the SAME map at a different component: Pallet Town -> Pewter City
 * routes through Route 2's south half -> a through-gatehouse (or Viridian
 * Forest) -> Route 2's NORTH half -> Pewter, where the north half is a distinct
 * graph node from the south half the route left. Start/goal components are
 * resolved from the `from`/`to` tiles via `componentOf` and passed to `mapRoute`
 * for a precise BFS; when a component can't be resolved (e.g. a goal tile in an
 * isolated pocket), `mapRoute` falls back to multi-source/sink over that map.
 *
 * @param {{group:number,num:number,x:number,y:number}} from
 * @param {{group:number,num:number,x:number,y:number}} to
 * @param {object} [options]
 * @param {Iterable|Set} [options.blockedTiles] Dynamic blockers for the first leg only.
 * @param {boolean} [options.stopAdjacent=false] Applies to the FINAL leg only
 *        (e.g. interacting with an NPC/sign at the destination).
 * @returns {{found:boolean, legs?:Array, totalCost?:number, reason?:string}}
 */
export function planCrossMapRoute(from, to, options = {}) {
    const { stopAdjacent = false, blockedTiles } = options;

    if (!getStaticMap(from.group, from.num)) return { found: false, reason: "start-out-of-scope" };
    if (!getStaticMap(to.group, to.num)) return { found: false, reason: "goal-out-of-scope" };

    const fromPos = { group: from.group, num: from.num, component: componentOf(from.group, from.num, from.x, from.y) };
    const toPos = { group: to.group, num: to.num, component: componentOf(to.group, to.num, to.x, to.y) };

    const excludedEdges = new Set();
    let lastFailure = { found: false, reason: "no-map-route" };

    for (let attempt = 0; attempt < MAX_REPLAN_ATTEMPTS; attempt++) {
        const routeInfo = mapRoute(fromPos, toPos, excludedEdges);
        if (!routeInfo.found) return lastFailure;

        const legs = [];
        let curGroup = from.group;
        let curNum = from.num;
        let curPos = { x: from.x, y: from.y };
        let firstLeg = true;
        let unwalkableEdge = null;
        let hardFailure = null;

        for (const edge of routeInfo.hops) {
            const map = getStaticMap(curGroup, curNum);
            if (!map) {
                hardFailure = { found: false, reason: `map-out-of-scope:${curGroup}:${curNum}`, legs };
                break;
            }
            const toMap = edge.kind === "connection" ? getStaticMap(edge.to.group, edge.to.num) : null;
            const legOptions = firstLeg ? { blockedTiles } : {};

            const leg = buildMapLeg({ map, pos: curPos, edge, toMap, options: legOptions });
            if (!leg.found) {
                unwalkableEdge = edge;
                lastFailure = { found: false, reason: leg.reason, legs };
                break;
            }

            legs.push({ group: curGroup, num: curNum, ...leg });
            curGroup = edge.to.group;
            curNum = edge.to.num;
            curPos = leg.crossing.toTile;
            firstLeg = false;
        }

        if (hardFailure) return hardFailure;
        if (unwalkableEdge) {
            excludedEdges.add(edgeKey(unwalkableEdge));
            continue;
        }

        const finalMap = getStaticMap(curGroup, curNum);
        if (!finalMap) return { found: false, reason: `map-out-of-scope:${curGroup}:${curNum}`, legs };
        const finalOptions = firstLeg ? { blockedTiles, stopAdjacent } : { stopAdjacent };
        const finalLeg = buildMapLeg({ map: finalMap, pos: curPos, finalGoal: { x: to.x, y: to.y }, options: finalOptions });
        if (!finalLeg.found) return { found: false, reason: finalLeg.reason, legs };
        legs.push({ group: curGroup, num: curNum, ...finalLeg });

        const totalCost = legs.reduce((sum, leg) => sum + leg.cost + (leg.crossing ? 1 : 0), 0);
        return { found: true, legs, totalCost };
    }

    return lastFailure;
}

/**
 * Resolves a `goto`-shaped destination (D1's DESTINATION_SCHEMA: either
 * `{location}` or `{map?, x, y}`) against the live starting position.
 * @param {{location?:string, map?:string, x?:number, y?:number}} destination
 * @param {{group:number,num:number,x?:number,y?:number}} current
 * @returns {{group:number,num:number,x:number,y:number}|null}
 */
export function resolveGotoTarget(destination, current) {
    if (destination && typeof destination.location === "string") {
        const loc = resolveDestination(destination.location, current);
        return loc ? { group: loc.group, num: loc.num, x: loc.x, y: loc.y } : null;
    }
    if (destination && typeof destination.x === "number" && typeof destination.y === "number") {
        if (destination.map) {
            const map = getStaticMapById(destination.map);
            if (!map) return null;
            return { group: map.group, num: map.num, x: destination.x, y: destination.y };
        }
        return { group: current.group, num: current.num, x: destination.x, y: destination.y };
    }
    return null;
}

/**
 * Live cross-map "goto": resolves `destination` once against the current
 * position, then repeatedly builds and executes ONE map leg at a time (via
 * `buildMapLeg`, re-fetching live NPCs fresh for whichever map the player is
 * currently on) until the goal map is reached, an interrupt fires, or the
 * step budget runs out. Returns a D1 outcome envelope so this backs the `goto`
 * tool directly.
 *
 * AUTO-CLEARED INTERRUPTS (C5 / C3 wiring): the harness owns dialog and
 * battles — they are not model tools (see docs/tool-interface.md, "What is
 * intentionally NOT a tool"). So when B2 surfaces a `dialog` or
 * `battle_started` interrupt mid-route, gotoLive does NOT hand it to the
 * model. Instead it auto-clears dialog via C5's `advanceDialogLive` and
 * auto-fights the battle via C3's `runBattleLive` (consuming the standing
 * `battlePolicy` set by `set_battle_strategy`), then re-derives the next leg
 * from wherever the player landed — the same way a warp re-derives. Only when
 * a sub-handler ESCALATES (choice_required / out_of_pp / about_to_faint /
 * unknown_state / budget_exhausted) does control return to the model, in the
 * shared STOP_REASON vocabulary. Other interrupts (warp_completed /
 * unexpected_menu / unknown_state) surface verbatim as before. Low HP is not an
 * interrupt (see gamestate/interruptDetector.js); the state prompt surfaces it.
 *
 * Routing presses (`stepsUsed`) and sub-handler presses (`extraSteps`) are
 * accounted separately: a battle legitimately consumes many turns and must
 * NOT eat the routing `max_steps` budget, but the total harness effort is
 * still reported in the returned envelope's `steps_used` for D3 tracing /
 * D4 benchmark accounting.
 *
 * @param {{location?:string, map?:string, x?:number, y?:number}} destination
 * @param {object} [options]
 * @param {number} [options.maxSteps=400]
 * @param {boolean} [options.stopAdjacent=false] Stop next to the destination
 *        tile instead of on it (e.g. to interact with something there).
 * @param {Iterable<{x:number,y:number}>} [options.avoidTiles] Extra static blockers.
 * @param {object} [options.battlePolicy] Standing policy for C3's runBattleLive
 *        (passed in by the dispatcher from `set_battle_strategy`). Defaults to
 *        the D1 default strategy.
 * @param {object} [options.dialogPolicy] Standing policy for C5's
 *        advanceDialogLive (`{choice}`; default `{choice:"ask"}`).
 * @param {object} [options.io] Injectable transport forwarded to the sub-handlers.
 * @param {AbortSignal} [options.signal]
 * @param {() => Promise<object>} [options.pollState] Snapshot source override
 *        (test hook; defaults to B1's fast poll).
 * @param {() => Promise<{group,num,x,y}>} [options.readCurrent] Position reader
 *        override (test hook; defaults to the live playerData/mapEvents readers).
 * @param {(button:string) => Promise} [options.press] Single-button press
 *        override (test hook; defaults to buttonPress.pressButtons).
 * @param {(button:string, count:number) => Promise} [options.moveRun] Held-run
 *        override (test hook). Default: a live frame-counted HOLD of
 *        count×16 frames (one walking tile = 16 frames), which is how
 *        straight-line stretches move continuously instead of tap-per-tile.
 *        When `press` is injected without `moveRun`, batching is disabled so
 *        offline tests keep seeing every per-tile press.
 * @param {function} [options.advanceDialog] Override for C5's advanceDialogLive
 *        (test hook).
 * @param {function} [options.runBattle] Override for C3's runBattleLive
 *        (test hook).
 * @param {() => Promise<Array<{x:number,y:number}>>} [options.getNpcs] Override
 *        for the live NPC reader (test hook; defaults to getBlockingMapNpcs,
 *        which excludes non-blocking object events like visible field items).
 * @returns {Promise<object>} A `makeOutcome(...)` envelope (see toolInterface.js).
 */
export async function gotoLive(destination, options = {}) {
    const {
        maxSteps = 400,
        stopAdjacent = false,
        avoidTiles,
        battlePolicy = { strategy: "default", lead: null, catch_all_pokemon: false },
        dialogPolicy = { choice: "ask" },
        io,
        signal,
        pollState: pollStateOpt,
        readCurrent: readCurrentOpt,
        press: pressOpt,
        moveRun: moveRunOpt,
        advanceDialog,
        runBattle,
        getNpcs: getNpcsOpt,
    } = options;

    const [{ getCurrentMapBank, getCurrentMapNumber, getPlayerPosition }, { getBlockingMapNpcs }, { getState }, { pressButtons }] =
        await Promise.all([
            import("../gamestate/overworld/playerData.js"),
            import("../gamestate/overworld/mapEvents.js"),
            import("../gamestate/getState.js"),
            import("../tools/buttonPress.js"),
        ]);

    const readCurrent = readCurrentOpt ?? (async () => {
        const [group, num, pos] = await Promise.all([getCurrentMapBank(), getCurrentMapNumber(), getPlayerPosition()]);
        return { group, num, x: pos[0], y: pos[1] };
    });
    const getNpcs = getNpcsOpt ?? getBlockingMapNpcs;
    const poll = pollStateOpt ?? (() => getState({ includeMap: false, includeBag: false }));
    const press = pressOpt ?? pressButtons;
    // Held-run mover: one HOLD of count×16 frames walks `count` tiles in a
    // straight line (Gen-3 walking is 16 frames/tile; the emulator counts the
    // hold's frames itself, so this is frame-accurate, not wall-clock). Only
    // enabled by default on the LIVE press path — an injected per-press fake
    // (tests) wouldn't see the hold, so batching turns off unless the test
    // injects its own moveRun.
    const moveRun = moveRunOpt ?? (pressOpt ? null : async (button, count) => {
        const { executeQueue } = await import("../tools/inputExecutor.js");
        await executeQueue([{ button, frames: count * WALK_FRAMES_PER_TILE }], { io, signal });
    });
    // C5/C3 sub-handlers (defaults to the imported live adapters; overridable
    // for offline testing of the handoff itself).
    const dialog = advanceDialog ?? advanceDialogLive;
    const battle = runBattle ?? runBattleLive;

    // Routing presses (tile moves). Sub-handler presses (dialog/battle) are
    // accounted separately so a battle doesn't eat the routing budget, but
    // the total harness effort is still reported for D3 tracing / D4.
    let stepsUsed = 0;
    let extraSteps = 0;

    // C5/C3 auto-clear. Given a DIALOG or BATTLE_STARTED interrupt, drive the
    // matching sub-handler against the shared fast poll, fold its step count
    // into `extraSteps`, and return its outcome envelope (caller surfaces it
    // unless it's OK, in which case the caller re-derives the leg). For any
    // other interrupt, return null so the caller surfaces it verbatim with
    // position context (the original goto behavior).
    const autoClearInterrupt = async (interrupt) => {
        let sub;
        if (interrupt === STOP_REASON.DIALOG) {
            sub = await dialog(dialogPolicy, { maxSteps: 60, pollState: poll, io, signal });
            extraSteps += sub.steps_used || 0;
            // Trainer battles start via NPC dialog: the dialog sub-handler
            // escalates battle_started (it can't fight), so chain into the
            // battle engine instead of surfacing a battle the harness owns.
            // Wild encounters hit the BATTLE_STARTED branch below directly.
            if (sub.stop_reason === STOP_REASON.BATTLE_STARTED) {
                sub = await battle(battlePolicy, { maxSteps: 200, pollState: poll, io, signal });
                extraSteps += sub.steps_used || 0;
            }
            return sub;
        } else if (interrupt === STOP_REASON.BATTLE_STARTED) {
            sub = await battle(battlePolicy, { maxSteps: 200, pollState: poll, io, signal });
            extraSteps += sub.steps_used || 0;
            return sub;
        }
        return null;
    };

    const startState = await poll();
    const startInterrupt = classifyInterrupt(startState, {});
    if (startInterrupt) {
        const sub = await autoClearInterrupt(startInterrupt);
        if (sub === null) {
            return makeOutcome(OUTCOME_STATUS.INTERRUPTED, { stopReason: startInterrupt, stepsUsed: stepsUsed + extraSteps, message: "interrupted before goto started" });
        }
        if (sub.status !== OUTCOME_STATUS.OK) {
            return { ...sub, steps_used: stepsUsed + extraSteps };
        }
        // Cleared before goto started (e.g. an entry dialog or a battle the
        // route was called inside); fall through and route normally.
    }

    const current0 = await readCurrent();
    const target = resolveGotoTarget(destination, current0);
    if (!target) {
        return makeOutcome(OUTCOME_STATUS.FAILED, { stopReason: STOP_REASON.INVALID_ARGS, message: "could not resolve destination" });
    }
    if (!getStaticMap(target.group, target.num)) {
        return makeOutcome(OUTCOME_STATUS.FAILED, { stopReason: STOP_REASON.PRECONDITION_FAILED, message: "destination map out of static-data scope" });
    }
    // Goal component is fixed for the whole goto; resolve once. The current
    // component is re-resolved each iteration (the player moves map-to-map, and
    // re-entry into a different component of the SAME map is exactly the Route 2
    // detour case a precise from-component enables).
    const targetComp = componentOf(target.group, target.num, target.x, target.y);

    // Stall guard: a warp crossing can legitimately need re-deriving, but
    // findPath's default plan (walk-away-then-back) isn't universally the
    // right one — see buildMapLeg's warp-branch comment, two live doors this
    // session needed opposite handling. So: try the default plan; if landing
    // back on the exact same tile shows it made no progress, retry ONCE with
    // `skipWarpDetour` (the other strategy) instead of repeating the same
    // doomed one; if THAT also makes no progress, both strategies are
    // exhausted — bail out BLOCKED instead of silently burning the rest of
    // the step budget on a stall the model can't see happening.
    //
    // `stallAttempts` counts strategies already tried-and-failed at
    // `stallKey`; it only advances off a warp-crossing leg specifically
    // (`lastLegWasWarp`), so an unrelated repeat position (e.g. several
    // iterations spent inside one long dialog, which legitimately doesn't
    // move the player either) never trips it.
    let stallKey = null;
    let stallAttempts = 0;
    let lastLegWasWarp = false;
    const MAX_WARP_STRATEGIES = 2;

    for (;;) {
        const current = await readCurrent();
        if (current.group == null || current.num == null || current.x == null || current.y == null) {
            return makeOutcome(OUTCOME_STATUS.FAILED, { stopReason: STOP_REASON.UNKNOWN_STATE, stepsUsed: stepsUsed + extraSteps, message: "could not read current position" });
        }
        const posKey = `${current.group}:${current.num}@${current.x},${current.y}`;

        if (lastLegWasWarp && posKey === stallKey) {
            stallAttempts++;
            if (stallAttempts >= MAX_WARP_STRATEGIES) {
                return makeOutcome(OUTCOME_STATUS.FAILED, {
                    stopReason: STOP_REASON.BLOCKED,
                    stepsUsed: stepsUsed + extraSteps,
                    message: `stalled crossing a warp at ${posKey}: no progress after ${stallAttempts} strategies`,
                });
            }
        } else if (posKey !== stallKey) {
            stallKey = posKey;
            stallAttempts = 0;
        }

        const map = getStaticMap(current.group, current.num);
        if (!map) {
            return makeOutcome(OUTCOME_STATUS.FAILED, {
                stopReason: STOP_REASON.UNKNOWN_STATE,
                stepsUsed: stepsUsed + extraSteps,
                message: `current map ${current.group}:${current.num} out of static-data scope`,
            });
        }

        const npcs = await getNpcs();
        const blocked = new Set(npcs.map((n) => `${n.x},${n.y}`));
        if (avoidTiles) for (const t of avoidTiles) blocked.add(`${t.x},${t.y}`);

        const sameMap = current.group === target.group && current.num === target.num;
        let leg;
        if (sameMap) {
            leg = buildMapLeg({
                map,
                pos: { x: current.x, y: current.y },
                finalGoal: { x: target.x, y: target.y },
                options: { blockedTiles: blocked, stopAdjacent },
            });
        } else {
            // Same graph-connectivity-vs-walkability gap as planCrossMapRoute:
            // if the next hop the BFS suggests turns out to be blocked inside
            // this map (an HM-gated obstacle, e.g. Route 2's Cut-tree split),
            // exclude it and ask for an alternate route rather than giving up.
            // Routing from the traveller's precise component (not multi-source)
            // is what lets this re-plan find the Route 2 forest/gatehouse detour
            // instead of a dead-end direct edge into the unreachable half.
            const excludedEdges = new Set();
            let lastReason = "no map route to destination";
            for (let attempt = 0; attempt < MAX_REPLAN_ATTEMPTS; attempt++) {
                const routeInfo = mapRoute(
                    { group: current.group, num: current.num, component: componentOf(current.group, current.num, current.x, current.y) },
                    { group: target.group, num: target.num, component: targetComp },
                    excludedEdges
                );
                if (!routeInfo.found || routeInfo.hops.length === 0) {
                    leg = null;
                    break;
                }
                const edge = routeInfo.hops[0];
                const toMap = edge.kind === "connection" ? getStaticMap(edge.to.group, edge.to.num) : null;
                const skipWarpDetour = stallAttempts >= 1;
                const candidate = buildMapLeg({ map, pos: { x: current.x, y: current.y }, edge, toMap, options: { blockedTiles: blocked, skipWarpDetour } });
                if (candidate.found) {
                    leg = candidate;
                    break;
                }
                excludedEdges.add(edgeKey(edge));
                lastReason = candidate.reason;
                leg = null;
            }
            if (!leg) {
                return makeOutcome(OUTCOME_STATUS.FAILED, { stopReason: STOP_REASON.BLOCKED, stepsUsed: stepsUsed + extraSteps, message: `blocked on ${current.group}:${current.num}: ${lastReason}` });
            }
        }

        if (!leg.found) {
            return makeOutcome(OUTCOME_STATUS.FAILED, {
                stopReason: STOP_REASON.BLOCKED,
                stepsUsed: stepsUsed + extraSteps,
                message: `blocked on ${current.group}:${current.num}: ${leg.reason}`,
            });
        }

        lastLegWasWarp = leg.crossing?.kind === "warp";

        const presses = leg.crossing ? [...leg.directions, leg.crossing.press] : leg.directions;
        const crossingIndex = leg.crossing ? presses.length - 1 : -1;
        let legDone = true; // false once an auto-cleared interrupt breaks the press loop
        for (let pi = 0; pi < presses.length; ) {
            if (stepsUsed >= maxSteps) {
                return makeOutcome(OUTCOME_STATUS.BUDGET_EXHAUSTED, { stopReason: STOP_REASON.BUDGET_EXHAUSTED, stepsUsed: stepsUsed + extraSteps, message: "max_steps exhausted mid-route" });
            }
            const button = presses[pi];

            // Batch a straight run of identical movement presses into ONE held
            // input. The crossing press always stays a single tap (warp
            // triggers care about the discrete step onto the tile — see the
            // stall-guard notes above).
            let run = 1;
            if (moveRun && HOLDABLE_DIRECTIONS.has(button) && pi !== crossingIndex) {
                while (
                    pi + run < presses.length &&
                    presses[pi + run] === button &&
                    pi + run !== crossingIndex &&
                    run < MAX_HOLD_TILES &&
                    stepsUsed + run < maxSteps
                ) run++;
            }

            if (run > 1) {
                await moveRun(button, run);
                stepsUsed += run;
            } else {
                await press(button);
                stepsUsed++;
            }
            pi += run;

            const state = await poll();
            const interrupt = classifyInterrupt(state, {});
            if (interrupt) {
                const sub = await autoClearInterrupt(interrupt);
                if (sub === null) {
                    // Not auto-clearable (warp/hp/menu/unknown): surface verbatim.
                    return makeOutcome(OUTCOME_STATUS.INTERRUPTED, {
                        stopReason: interrupt,
                        stepsUsed: stepsUsed + extraSteps,
                        message: "interrupted mid-route",
                        stateDelta: { map: { group: current.group, num: current.num }, position: state.player?.position },
                    });
                }
                if (sub.status !== OUTCOME_STATUS.OK) {
                    // C5/C3 escalated (choice_required / out_of_pp / ...): surface it.
                    return { ...sub, steps_used: stepsUsed + extraSteps };
                }
                // Auto-cleared dialog/battle: re-derive the next leg from
                // wherever the player landed (a cutscene/battle may have moved
                // them), the same way a warp re-derives.
                legDone = false;
                break;
            }

            if (run > 1) {
                // A held run can under-shoot its tile count (an initial facing
                // turn eats ~8 frames, an NPC or ledge can absorb the rest), so
                // never trust the remainder of the plan from a possibly-off
                // tile — re-derive the leg from live position instead.
                legDone = false;
                break;
            }
        }

        if (legDone && !leg.crossing) {
            return makeOutcome(OUTCOME_STATUS.OK, {
                stepsUsed: stepsUsed + extraSteps,
                message: `reached destination (${target.group}:${target.num} @ ${target.x},${target.y})`,
            });
        }
        // Either a crossing leg completed (map changed) or an auto-cleared
        // interrupt broke the press loop: loop back and re-derive the next
        // leg from wherever we actually landed rather than trusting the pure
        // plan past this point.
    }
}
