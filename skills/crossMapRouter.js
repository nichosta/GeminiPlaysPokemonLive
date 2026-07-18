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

import { findPath } from "./pathfinding.js";
import { getStaticMap, getStaticMapById } from "./staticMap.js";
import { mapRoute, resolveDestination, edgeKey } from "./locationGraph.js";
import { makeOutcome, OUTCOME_STATUS, STOP_REASON } from "../llminteract/toolInterface.js";
import { classifyInterrupt } from "../gamestate/interruptDetector.js";
import { advanceDialogLive } from "./dialogHandler.js";
import { runBattleLive } from "./battlePolicy.js";

/**
 * Resolves the exact border-tile pair for a connection edge between two maps,
 * per the decomp's connection math (see module docstring). Multiple tiles
 * along the border can be valid (both sides in-bounds and passable); `bias`
 * (the traveller's current coordinate along the border axis) picks the
 * closest one so the approach isn't a detour.
 *
 * @param {object} fromMap Static map JSON for the edge's `from` side.
 * @param {object} toMap Static map JSON for the edge's `to` side.
 * @param {{direction:"up"|"down"|"left"|"right", offset:number}} edge
 * @param {number} [bias] Preferred coordinate along the border axis (x for
 *        up/down, y for left/right). Defaults to the middle of the valid range.
 * @returns {{found:boolean, fromTile?:{x:number,y:number}, toTile?:{x:number,y:number}, reason?:string}}
 */
export function resolveConnectionCrossing(fromMap, toMap, edge, bias) {
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

    let best = null;
    let bestDist = Infinity;
    for (let v = lo; v < hi; v++) {
        if (!passableFrom(v) || !passableTo(v)) continue;
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
        // Door metatiles read as collision-blocked (see staticdata/README.md /
        // A1's note); stand adjacent and press the facing direction to cross.
        const res = findPath(map, pos, edge.fromTile, { ...options, stopAdjacent: true });
        if (!res.found) return { found: false, reason: res.reason };
        return {
            ...res,
            crossing: { kind: "warp", press: res.facing, toGroup: edge.to.group, toNum: edge.to.num, toTile: edge.toTile },
        };
    }

    // Connection: walk onto the (passable) border tile, then one more press
    // in the connection's direction carries the player across the seam.
    const bias = edge.direction === "up" || edge.direction === "down" ? pos.x : pos.y;
    const crossing = resolveConnectionCrossing(map, toMap, edge, bias);
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
 * KNOWN GAP: it can NOT recover when the fix requires re-entering the SAME map
 * at a different position, because the graph has one node per map, not one per
 * connected region within a map. Route 2 is the pre-Brock example: its direct
 * connection to Pewter City is real graph data, but rows 42-44 are a fully
 * impassable Cut-tree line (no Cut pre-Boulder-Badge) splitting the map into a
 * south half (bordering Viridian City) and a north half (bordering Pewter).
 * The intended route detours through Viridian Forest's warps, which land back
 * on Route 2's NORTH half — i.e. the same graph node BFS already marked
 * visited on the way in via its south half. Excluding the bad edge just finds
 * a route into the forest with nowhere onward, since the only edge out of the
 * forest re-enters an already-visited node. Fixing this for real needs A3 to
 * split a map into per-connected-component graph nodes (accounting for
 * one-way ledges); out of scope here. See crossMapRouter.test.js's
 * "known limitation" case and plan.md.
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

    const excludedEdges = new Set();
    let lastFailure = { found: false, reason: "no-map-route" };

    for (let attempt = 0; attempt < MAX_REPLAN_ATTEMPTS; attempt++) {
        const routeInfo = mapRoute(from.group, from.num, to.group, to.num, excludedEdges);
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
 * hp_low / unexpected_menu / unknown_state) surface verbatim as before.
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
 * @param {number} [options.hpThreshold=0.2] Fraction at/below which HP_LOW fires.
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
 * @param {function} [options.advanceDialog] Override for C5's advanceDialogLive
 *        (test hook).
 * @param {function} [options.runBattle] Override for C3's runBattleLive
 *        (test hook).
 * @param {() => Promise<Array<{x:number,y:number}>>} [options.getNpcs] Override
 *        for the live NPC reader (test hook; defaults to getCurrentMapNpcs).
 * @returns {Promise<object>} A `makeOutcome(...)` envelope (see toolInterface.js).
 */
export async function gotoLive(destination, options = {}) {
    const {
        maxSteps = 400,
        hpThreshold = 0.2,
        stopAdjacent = false,
        avoidTiles,
        battlePolicy = { strategy: "default", lead: null, catch_wild: false },
        dialogPolicy = { choice: "ask" },
        io,
        signal,
        pollState: pollStateOpt,
        readCurrent: readCurrentOpt,
        press: pressOpt,
        advanceDialog,
        runBattle,
        getNpcs: getNpcsOpt,
    } = options;

    const [{ getCurrentMapBank, getCurrentMapNumber, getPlayerPosition }, { getCurrentMapNpcs }, { getState }, { pressButtons }] =
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
    const getNpcs = getNpcsOpt ?? getCurrentMapNpcs;
    const poll = pollStateOpt ?? (() => getState({ includeMap: false, includeBag: false }));
    const press = pressOpt ?? pressButtons;
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
            sub = await dialog(dialogPolicy, { maxSteps: 60, hpThreshold, pollState: poll, io, signal });
        } else if (interrupt === STOP_REASON.BATTLE_STARTED) {
            sub = await battle(battlePolicy, { maxSteps: 200, hpThreshold, pollState: poll, io, signal });
        } else {
            return null;
        }
        extraSteps += sub.steps_used || 0;
        return sub;
    };

    const startState = await poll();
    const startInterrupt = classifyInterrupt(startState, { hpThreshold });
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

    for (;;) {
        const current = await readCurrent();
        if (current.group == null || current.num == null || current.x == null || current.y == null) {
            return makeOutcome(OUTCOME_STATUS.FAILED, { stopReason: STOP_REASON.UNKNOWN_STATE, stepsUsed: stepsUsed + extraSteps, message: "could not read current position" });
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
            const excludedEdges = new Set();
            let lastReason = "no map route to destination";
            for (let attempt = 0; attempt < MAX_REPLAN_ATTEMPTS; attempt++) {
                const routeInfo = mapRoute(current.group, current.num, target.group, target.num, excludedEdges);
                if (!routeInfo.found || routeInfo.hops.length === 0) {
                    leg = null;
                    break;
                }
                const edge = routeInfo.hops[0];
                const toMap = edge.kind === "connection" ? getStaticMap(edge.to.group, edge.to.num) : null;
                const candidate = buildMapLeg({ map, pos: { x: current.x, y: current.y }, edge, toMap, options: { blockedTiles: blocked } });
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

        const presses = leg.crossing ? [...leg.directions, leg.crossing.press] : leg.directions;
        let legDone = true; // false once an auto-cleared interrupt breaks the press loop
        for (const button of presses) {
            if (stepsUsed >= maxSteps) {
                return makeOutcome(OUTCOME_STATUS.BUDGET_EXHAUSTED, { stopReason: STOP_REASON.BUDGET_EXHAUSTED, stepsUsed: stepsUsed + extraSteps, message: "max_steps exhausted mid-route" });
            }
            await press(button);
            stepsUsed++;

            const state = await poll();
            const interrupt = classifyInterrupt(state, { hpThreshold });
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
