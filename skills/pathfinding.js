// =============================================================================
// WITHIN-MAP A* (C1)
// =============================================================================
//
// Grid pathfinding over the A1 static collision data for a single map. Given a
// start and goal tile it returns the button-press sequence that walks the
// player there, or reports that no path exists.
//
// Inputs (per the plan's C1 definition):
//   - Static geometry from A1: per-tile `collision` (0 = passable) plus
//     `behaviorIds` (used here only to model ledge jumps as valid one-way
//     shortcuts). Loaded via ../skills/staticMap.js, keyed by (group, num).
//   - Dynamic blockers: any tiles the caller wants treated as impassable this
//     poll. B1's live NPC positions (getCurrentMapNpcs) go here, and A2's
//     trainer sightline tiles will plug into the same `blockedTiles` set once
//     that extraction lands. The core stays agnostic about where a blocked tile
//     came from.
//
// The core (`findPath`) is pure: it takes a static-map object and plain data,
// touches no RAM, and is exercised by pathfinding.test.js against the checked-in
// static data. `findPathLive` is the thin adapter that pulls the current map +
// NPCs from the running emulator.
//
// Coordinates are map-origin tile coords (x right, y down) — the same frame the
// static grid, warps, and getCurrentMapNpcs all use. Directions are the
// lowercase button names the input executor consumes: "up"/"down"/"left"/"right".
// =============================================================================

import { getStaticMap } from "./staticMap.js";

/** Ledge (jump) metatile behavior id -> the direction you jump. */
const JUMP_BEHAVIOR = {
    56: "right", // MB_JUMP_EAST
    57: "left", // MB_JUMP_WEST
    58: "up", // MB_JUMP_NORTH
    59: "down", // MB_JUMP_SOUTH
};

/** Unit step per direction. */
const DIRS = {
    up: { dx: 0, dy: -1 },
    down: { dx: 0, dy: 1 },
    left: { dx: -1, dy: 0 },
    right: { dx: 1, dy: 0 },
};

const key = (x, y) => `${x},${y}`;

/**
 * Minimal binary min-heap keyed by a numeric priority. Maps here are tiny
 * (< 4k tiles), but a heap keeps A* honest and avoids O(n) frontier scans.
 */
class MinHeap {
    constructor() {
        this.items = [];
    }
    get size() {
        return this.items.length;
    }
    push(node, priority) {
        const items = this.items;
        items.push({ node, priority });
        let i = items.length - 1;
        while (i > 0) {
            const parent = (i - 1) >> 1;
            if (items[parent].priority <= items[i].priority) break;
            [items[parent], items[i]] = [items[i], items[parent]];
            i = parent;
        }
    }
    pop() {
        const items = this.items;
        const top = items[0];
        const last = items.pop();
        if (items.length > 0) {
            items[0] = last;
            let i = 0;
            for (;;) {
                const l = 2 * i + 1;
                const r = 2 * i + 2;
                let smallest = i;
                if (l < items.length && items[l].priority < items[smallest].priority) smallest = l;
                if (r < items.length && items[r].priority < items[smallest].priority) smallest = r;
                if (smallest === i) break;
                [items[smallest], items[i]] = [items[i], items[smallest]];
                i = smallest;
            }
        }
        return top.node;
    }
}

/**
 * Builds the passability test for a map + dynamic blocker set. A tile is
 * walkable when it is in bounds, has static collision 0, and is not one of the
 * dynamically blocked tiles (NPCs / sightlines).
 * @param {object} map Static map JSON.
 * @param {Set<string>} blocked "x,y" keys to treat as impassable.
 * @returns {(x: number, y: number) => boolean}
 */
function makePassable(map, blocked) {
    const { width, height, grid } = map;
    const collision = grid.collision;
    return (x, y) => {
        if (x < 0 || y < 0 || x >= width || y >= height) return false;
        if (collision[y * width + x] !== 0) return false;
        if (blocked.has(key(x, y))) return false;
        return true;
    };
}

/**
 * Normalizes the `blockedTiles` option into a Set of "x,y" keys. Accepts an
 * iterable of {x,y} objects or [x,y] pairs, or a pre-built Set of strings.
 * @param {Iterable<{x:number,y:number}|[number,number]>|Set<string>|undefined} tiles
 * @returns {Set<string>}
 */
function toBlockedSet(tiles) {
    if (!tiles) return new Set();
    if (tiles instanceof Set) return tiles;
    const set = new Set();
    for (const t of tiles) {
        if (Array.isArray(t)) set.add(key(t[0], t[1]));
        else if (t && typeof t.x === "number" && typeof t.y === "number") set.add(key(t.x, t.y));
    }
    return set;
}

/**
 * Enumerates the reachable neighbours of (x, y): a normal step onto an adjacent
 * passable tile, or — when the adjacent tile is a ledge whose jump direction
 * matches the travel direction — the two-tile jump that lands beyond it. Each
 * neighbour is one button press.
 * @returns {Array<{x:number,y:number,dir:string}>}
 */
function neighbors(x, y, map, passable) {
    const { width, grid } = map;
    const behaviors = grid.behaviorIds;
    const out = [];
    for (const dir of ["up", "down", "left", "right"]) {
        const { dx, dy } = DIRS[dir];
        const ax = x + dx;
        const ay = y + dy;
        if (ax < 0 || ay < 0 || ax >= width || ay >= map.height) continue;

        // Ledge: stepping into a JUMP_<dir> tile in its jump direction hops over
        // it to the tile beyond. The ledge tile itself is never stood on.
        const adjBehavior = behaviors[ay * width + ax];
        if (JUMP_BEHAVIOR[adjBehavior] === dir) {
            const lx = ax + dx;
            const ly = ay + dy;
            if (passable(lx, ly)) out.push({ x: lx, y: ly, dir });
            continue;
        }

        if (passable(ax, ay)) out.push({ x: ax, y: ay, dir });
    }
    return out;
}

/**
 * A* over a single static map.
 *
 * @param {object} map Static map JSON (from getStaticMap / getStaticMapById).
 * @param {{x:number,y:number}} start Player's current tile.
 * @param {{x:number,y:number}} goal Destination tile.
 * @param {object} [options]
 * @param {Iterable<{x:number,y:number}|[number,number]>|Set<string>} [options.blockedTiles]
 *        Tiles to treat as impassable this poll (live NPCs, trainer sightlines).
 * @param {boolean} [options.stopAdjacent=false]
 *        Stop on any tile orthogonally adjacent to `goal` rather than on `goal`
 *        itself — for interacting with something you can't stand on (a warp
 *        tile on a door, an NPC, a sign). The returned `facing` is the direction
 *        to press to face the goal from the final tile.
 * @returns {{found: boolean, path?: Array<{x:number,y:number}>, directions?: string[],
 *           cost?: number, facing?: string, reason?: string}}
 *          On success: `directions` is the button sequence, `path` the tiles
 *          occupied after each press (start excluded), `cost` its length.
 */
export function findPath(map, start, goal, options = {}) {
    if (!map || !map.grid) return { found: false, reason: "no-map" };
    const { stopAdjacent = false } = options;
    const callerBlocked = toBlockedSet(options.blockedTiles);
    // Fold in the map's permanent HM-gated obstacles (cut trees / Strength
    // boulders). These are object events, not collision-grid terrain, so the
    // static grid — and A3's component graph built from it — treats their tiles
    // as passable; without this a route gets planned straight through a cut tree
    // it can't actually pass (see staticMap.getObstacleTiles / extractObstacles).
    // Copy so a caller-owned Set is never mutated.
    let blocked = callerBlocked;
    if (Array.isArray(map.obstacles) && map.obstacles.length > 0) {
        blocked = new Set(callerBlocked);
        for (const o of map.obstacles) blocked.add(key(o.x, o.y));
    }
    const passable = makePassable(map, blocked);

    // A dynamically-blocked start (e.g. an NPC read onto the player's own tile)
    // must not strand the search — the player is definitionally standing there.
    const startBlocked = new Set(blocked);
    startBlocked.delete(key(start.x, start.y));
    const passableFromStart = makePassable(map, startBlocked);

    const isGoal = stopAdjacent
        ? (x, y) => Math.abs(x - goal.x) + Math.abs(y - goal.y) === 1
        : (x, y) => x === goal.x && y === goal.y;

    // Admissible heuristic: Manhattan distance to the goal (0 once adjacent when
    // stopAdjacent, so we clamp those to 0).
    const heuristic = stopAdjacent
        ? (x, y) => Math.max(0, Math.abs(x - goal.x) + Math.abs(y - goal.y) - 1)
        : (x, y) => Math.abs(x - goal.x) + Math.abs(y - goal.y);

    if (!stopAdjacent && !passable(goal.x, goal.y)) {
        return { found: false, reason: "goal-blocked" };
    }
    if (isGoal(start.x, start.y)) {
        return { found: true, path: [], directions: [], cost: 0, ...(stopAdjacent ? { facing: faceDir(start, goal) } : {}) };
    }

    const startKey = key(start.x, start.y);
    const gScore = new Map([[startKey, 0]]);
    const cameFrom = new Map(); // node key -> { prevKey, dir, x, y }
    const open = new MinHeap();
    open.push({ x: start.x, y: start.y }, heuristic(start.x, start.y));

    while (open.size > 0) {
        const cur = open.pop();
        const curKey = key(cur.x, cur.y);
        const curG = gScore.get(curKey);

        if (isGoal(cur.x, cur.y)) {
            return reconstruct(cameFrom, curKey, cur, curG, stopAdjacent ? faceDir(cur, goal) : undefined);
        }

        // Only the very first expansion may leave a blocked start tile.
        const step = curKey === startKey ? passableFromStart : passable;
        for (const nb of neighbors(cur.x, cur.y, map, step)) {
            const nbKey = key(nb.x, nb.y);
            const tentative = curG + 1;
            if (tentative < (gScore.get(nbKey) ?? Infinity)) {
                gScore.set(nbKey, tentative);
                cameFrom.set(nbKey, { prevKey: curKey, dir: nb.dir, x: nb.x, y: nb.y });
                open.push({ x: nb.x, y: nb.y }, tentative + heuristic(nb.x, nb.y));
            }
        }
    }

    return { found: false, reason: "no-path" };
}

/** Direction to press to face `goal` from an orthogonally-adjacent tile. */
function faceDir(from, goal) {
    if (goal.x > from.x) return "right";
    if (goal.x < from.x) return "left";
    if (goal.y > from.y) return "down";
    return "up";
}

/** Walks the cameFrom chain back to start, producing tiles + directions. */
function reconstruct(cameFrom, endKey, endNode, cost, facing) {
    const path = [];
    const directions = [];
    let k = endKey;
    while (cameFrom.has(k)) {
        const step = cameFrom.get(k);
        path.push({ x: step.x, y: step.y });
        directions.push(step.dir);
        k = step.prevKey;
    }
    path.reverse();
    directions.reverse();
    return {
        found: true,
        path,
        directions,
        cost,
        ...(facing !== undefined ? { facing } : {}),
    };
}

/**
 * Live adapter: reads the current map + player position + on-screen NPCs from
 * the running emulator, then routes to `goal` on that map. NPC tiles are folded
 * into `blockedTiles` on top of anything the caller passes.
 *
 * @param {{x:number,y:number}} goal Destination tile on the current map.
 * @param {object} [options] Same as findPath, plus the caller's extra blockers.
 * @returns {Promise<object>} findPath result, or {found:false, reason} if the
 *          current map is outside the static-data scope or state is unreadable.
 */
export async function findPathLive(goal, options = {}) {
    const [{ getCurrentMapBank, getCurrentMapNumber, getPlayerPosition }, { getBlockingMapNpcs }] =
        await Promise.all([
            import("../gamestate/overworld/playerData.js"),
            import("../gamestate/overworld/mapEvents.js"),
        ]);

    const [group, num, pos] = await Promise.all([
        getCurrentMapBank(),
        getCurrentMapNumber(),
        getPlayerPosition(),
    ]);

    const map = getStaticMap(group, num);
    if (!map) return { found: false, reason: "map-out-of-scope" };

    const npcs = await getBlockingMapNpcs();
    const blocked = toBlockedSet(options.blockedTiles);
    for (const npc of npcs) blocked.add(key(npc.x, npc.y));

    return findPath(map, { x: pos[0], y: pos[1] }, goal, { ...options, blockedTiles: blocked });
}
