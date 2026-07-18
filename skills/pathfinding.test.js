// =============================================================================
// C1 pathfinding self-test (offline, runs against checked-in A1 static data)
// =============================================================================
//
//   node skills/pathfinding.test.js
//
// Verifies findPath produces *legal* button sequences: every emitted direction
// is re-simulated against the same collision/ledge rules and must land on the
// tile the planner claimed, ending at (or adjacent to) the goal.
// =============================================================================

import { getStaticMap, getStaticMapById } from "./staticMap.js";
import { findPath } from "./pathfinding.js";

const JUMP_BEHAVIOR = { 56: "right", 57: "left", 58: "up", 59: "down" };
const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

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

/**
 * Replays `directions` from `start` under real movement rules and returns the
 * final tile, or throws on the first illegal step. `blocked` is a Set of "x,y".
 */
function replay(map, start, directions, blocked = new Set()) {
    const { width, height, grid } = map;
    const passable = (x, y) =>
        x >= 0 && y >= 0 && x < width && y < height && grid.collision[y * width + x] === 0 && !blocked.has(`${x},${y}`);

    let [x, y] = [start.x, start.y];
    const tiles = [];
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
        tiles.push({ x, y });
    }
    return { x, y, tiles };
}

function firstPassable(map, from = 0) {
    const { width, height, grid } = map;
    for (let i = from; i < width * height; i++) {
        if (grid.collision[i] === 0) return { x: i % width, y: Math.floor(i / width) };
    }
    return null;
}
function lastPassable(map) {
    const { width, height, grid } = map;
    for (let i = width * height - 1; i >= 0; i--) {
        if (grid.collision[i] === 0) return { x: i % width, y: Math.floor(i / width) };
    }
    return null;
}

// --- 1. Basic connectivity + legality on Pallet Town ------------------------
{
    const map = getStaticMapById("MAP_PALLET_TOWN");
    const start = firstPassable(map);
    const goal = lastPassable(map);
    const res = findPath(map, start, goal);
    check("pallet: path found", res.found, JSON.stringify(res));
    if (res.found) {
        check("pallet: directions == cost", res.directions.length === res.cost);
        check("pallet: path length == directions", res.path.length === res.directions.length);
        let ended;
        try {
            ended = replay(map, start, res.directions);
            check("pallet: replay legal + reaches goal", ended.x === goal.x && ended.y === goal.y, JSON.stringify(ended));
            const matchesPath = res.path.every((p, i) => p.x === ended.tiles[i].x && p.y === ended.tiles[i].y);
            check("pallet: reported path matches replay", matchesPath);
        } catch (e) {
            check("pallet: replay legal", false, e.message);
        }
    }
}

// --- 2. Dynamic blocker forces a detour (longer, still legal) ---------------
{
    const map = getStaticMapById("MAP_PALLET_TOWN");
    const start = firstPassable(map);
    const goal = lastPassable(map);
    const base = findPath(map, start, goal);
    // Block the first tile the unobstructed path steps onto.
    const chokepoint = base.path[0];
    const res = findPath(map, start, goal, { blockedTiles: [chokepoint] });
    check("blocker: still routes", res.found);
    if (res.found) {
        check("blocker: avoids blocked tile", !res.path.some((p) => p.x === chokepoint.x && p.y === chokepoint.y));
        try {
            const ended = replay(map, start, res.directions, new Set([`${chokepoint.x},${chokepoint.y}`]));
            check("blocker: replay legal + reaches goal", ended.x === goal.x && ended.y === goal.y);
        } catch (e) {
            check("blocker: replay legal", false, e.message);
        }
    }
}

// --- 3. Blocked start tile does not strand the search -----------------------
{
    const map = getStaticMapById("MAP_PALLET_TOWN");
    const start = firstPassable(map);
    const goal = lastPassable(map);
    // An NPC read onto the player's own tile must be ignored for the start.
    const res = findPath(map, start, goal, { blockedTiles: [start] });
    check("blocked-start: still routes", res.found);
}

// --- 4. stopAdjacent reaches a warp tile you can't stand on -----------------
{
    const map = getStaticMapById("MAP_PALLET_TOWN");
    const start = firstPassable(map);
    // Oak's lab warp at (16,13): interact from an adjacent tile.
    const warp = map.warps[0];
    const res = findPath(map, start, { x: warp.x, y: warp.y }, { stopAdjacent: true });
    check("stopAdjacent: path found", res.found, JSON.stringify(res));
    if (res.found && res.path.length > 0) {
        const final = res.path[res.path.length - 1];
        const adjacent = Math.abs(final.x - warp.x) + Math.abs(final.y - warp.y) === 1;
        check("stopAdjacent: ends next to warp", adjacent, JSON.stringify(final));
        check("stopAdjacent: reports facing", typeof res.facing === "string");
    }
}

// --- 5. No path when the goal is walled off (isolated blocked tile) ---------
{
    const map = getStaticMapById("MAP_PALLET_TOWN");
    const start = firstPassable(map);
    // Any collision-1 tile is unreachable as an exact goal.
    const { width, height, grid } = map;
    let walled = null;
    for (let i = 0; i < width * height && !walled; i++) {
        if (grid.collision[i] !== 0) walled = { x: i % width, y: Math.floor(i / width) };
    }
    const res = findPath(map, start, walled);
    check("no-path: reports not found for blocked goal", !res.found && res.reason === "goal-blocked");
}

// --- 6. Ledge jump is used as a legal one-way shortcut (Route 1, southbound) -
{
    const map = getStaticMapById("MAP_ROUTE1");
    const { width, height, grid } = map;
    // Find a JUMP_SOUTH ledge with a passable tile above (approach) and below
    // (landing), then route from just-above to just-below: the only legal way
    // down is the jump.
    let scenario = null;
    for (let y = 1; y < height - 1 && !scenario; y++) {
        for (let x = 0; x < width; x++) {
            if (grid.behaviorIds[y * width + x] !== 59) continue;
            const above = grid.collision[(y - 1) * width + x] === 0;
            const below = grid.collision[(y + 1) * width + x] === 0;
            if (above && below) {
                scenario = { start: { x, y: y - 1 }, goal: { x, y: y + 1 }, ledge: { x, y } };
                break;
            }
        }
    }
    check("ledge: found a test ledge on Route 1", scenario !== null);
    if (scenario) {
        const res = findPath(map, scenario.start, scenario.goal);
        check("ledge: routes over the ledge", res.found);
        if (res.found) {
            const usedJump = res.directions.length === 1 && res.directions[0] === "down" && res.path.length === 1;
            check("ledge: single down-press jump landing past the ledge", usedJump, JSON.stringify(res));
            try {
                const ended = replay(map, scenario.start, res.directions);
                check("ledge: replay legal + lands past ledge", ended.x === scenario.goal.x && ended.y === scenario.goal.y);
            } catch (e) {
                check("ledge: replay legal", false, e.message);
            }
        }
    }
}

// --- 7. Every in-scope map loads and self-routes at least trivially ---------
{
    const { getIndex } = await import("./staticMap.js");
    const idx = getIndex();
    let loadedAll = true;
    for (const entry of idx.maps) {
        const map = getStaticMap(entry.group, entry.num);
        if (!map || !map.grid || map.grid.collision.length !== map.width * map.height) {
            loadedAll = false;
            console.error(`    map ${entry.id} failed to load/validate`);
        }
    }
    check("all 30 maps load with well-formed grids", loadedAll);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
