// =============================================================================
// STATIC MAP LOADER (support for C1)
// =============================================================================
//
// Thin, cached accessor over the A1 static map data in `staticdata/frlg/`.
// Loads per-map JSON on demand, keyed by the (group, num) pair that live RAM
// state exposes (MAP_BANK_ADDR / MAP_NUMBER_ADDR), so C1's pathfinder can look
// up geometry for whichever map the player is currently on.
//
// Pure filesystem reads — no emulator dependency — so this stays usable from
// offline tooling and tests.
// =============================================================================

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Root of the extracted FRLG static data (see staticdata/README.md). */
const FRLG_DIR = resolve(__dirname, "..", "staticdata", "frlg");

/** Loaded lazily so importing this module never touches the filesystem. */
let indexCache = null;
/** group:num -> parsed map JSON. */
const mapCache = new Map();
/** behavior id (number) -> name (e.g. 59 -> "MB_JUMP_SOUTH"). */
let behaviorCache = null;
/** Parsed components.json (per-map connected-component label grids). */
let componentsCache = null;
/** Parsed obstacles.json (per-map permanent HM-gated obstacle tiles). */
let obstaclesCache = null;

function keyOf(group, num) {
    return `${group}:${num}`;
}

/**
 * Loads and caches `frlg/index.json` (the registry of extracted maps).
 * @returns {object} The parsed index.
 */
export function getIndex() {
    if (!indexCache) {
        indexCache = JSON.parse(readFileSync(join(FRLG_DIR, "index.json"), "utf8"));
    }
    return indexCache;
}

/**
 * Loads and caches `frlg/components.json` — the per-tile connected-component
 * label grids emitted by A3 (see staticdata/extractLocations.js). One entry per
 * extracted map, keyed `"group:num"`, each carrying `{ width, height, count,
 * labels }` where `labels` is a row-major array (index = y*width + x) of
 * component index, or -1 for blocked tiles. Component indices match
 * mapGraph.json nodes' `component` field 1:1.
 *
 * @returns {Record<string, {width:number,height:number,count:number,labels:number[]}>}
 */
export function getComponents() {
    if (!componentsCache) {
        componentsCache = JSON.parse(readFileSync(join(FRLG_DIR, "components.json"), "utf8"));
    }
    return componentsCache.maps;
}

/**
 * The connected-component label grid for a map (or null if the map is outside
 * the pre-Brock extraction scope). Exposed so callers that scan many tiles —
 * e.g. C2's connection-border resolver filtering to the traveller's component —
 * can read labels directly instead of calling `componentOf` per tile.
 *
 * @param {number} group
 * @param {number} num
 * @returns {{width:number,height:number,count:number,labels:number[]}|null}
 */
export function getComponentLabels(group, num) {
    const entry = getComponents()[keyOf(group, num)];
    if (!entry) return null;
    return entry;
}

const COMP_NEIGHBORS = [
    [0, -1],
    [0, 1],
    [-1, 0],
    [1, 0],
];

/**
 * Which connected component a tile belongs to, or null if the map is out of
 * scope or the tile is genuinely isolated. Blocked tiles (door metatiles,
 * collision != 0) have no label of their own; this returns the component of a
 * passable ortho-neighbour — the region the player steps off the tile into —
 * mirroring A3's `componentOfTile` so extraction-time and runtime agree on a
 * door's component. Used by C2 to turn a live player/goal tile into the
 * `component` index the per-component graph BFS keys on.
 *
 * @param {number} group
 * @param {number} num
 * @param {number} x
 * @param {number} y
 * @returns {number|null} Component index, or null.
 */
export function componentOf(group, num, x, y) {
    const entry = getComponentLabels(group, num);
    if (!entry) return null;
    const { width, height, labels } = entry;
    if (x < 0 || y < 0 || x >= width || y >= height) return null;
    const direct = labels[y * width + x];
    if (direct !== -1) return direct;
    for (const [dx, dy] of COMP_NEIGHBORS) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const ni = ny * width + nx;
        if (labels[ni] !== -1) return labels[ni];
    }
    return null;
}

/**
 * Loads and caches `frlg/obstacles.json` — the permanent, HM-gated field
 * obstacles (cut trees, Strength boulders) as object-event tile positions, one
 * entry per map keyed `"group:num"` (see staticdata/extractObstacles.js). These
 * are NOT in A1's collision grid (they're object events, not terrain), so the
 * pathfinder must fold them into its blocked set from here or it will plan
 * routes physically requiring an HM the pre-Brock player doesn't have.
 *
 * @returns {Record<string, Array<{x:number,y:number,kind:string,requires:string}>>}
 */
export function getObstacles() {
    if (!obstaclesCache) {
        obstaclesCache = JSON.parse(readFileSync(join(FRLG_DIR, "obstacles.json"), "utf8"));
    }
    return obstaclesCache.maps;
}

/**
 * The permanent-obstacle tiles for a map (empty array if none / out of scope).
 * Pre-Brock the player has no HM, so every listed tile is impassable; a future
 * HM-aware caller can filter by each tile's `requires` field.
 *
 * @param {number} group
 * @param {number} num
 * @returns {Array<{x:number,y:number,kind:string,requires:string}>}
 */
export function getObstacleTiles(group, num) {
    return getObstacles()[keyOf(group, num)] || [];
}

/**
 * Loads and caches the behavior id -> name table.
 * @returns {Record<string, string>}
 */
export function getBehaviorTable() {
    if (!behaviorCache) {
        behaviorCache = JSON.parse(readFileSync(join(FRLG_DIR, "metatile_behaviors.json"), "utf8"));
    }
    return behaviorCache;
}

/**
 * Returns the static map data for the given (group, num), or null if that map
 * is not in the pre-Brock extraction scope. Result is cached.
 *
 * @param {number} group  Map bank (RAM MAP_BANK_ADDR).
 * @param {number} num    Map number (RAM MAP_NUMBER_ADDR).
 * @returns {object|null} Per-map JSON (see staticdata/README.md schema).
 */
export function getStaticMap(group, num) {
    const key = keyOf(group, num);
    if (mapCache.has(key)) return mapCache.get(key);

    const entry = getIndex().maps.find((m) => m.group === group && m.num === num);
    if (!entry) {
        mapCache.set(key, null);
        return null;
    }

    const map = JSON.parse(readFileSync(join(FRLG_DIR, entry.file), "utf8"));
    // Attach permanent HM-gated obstacles (cut trees / boulders) so findPath can
    // treat them as blocked without a separate lookup at every call site. They
    // live outside A1's collision grid (object events), so they must be folded
    // in here or routes get planned straight through them.
    map.obstacles = getObstacleTiles(group, num);
    mapCache.set(key, map);
    return map;
}

/**
 * Looks up a static map by its `MAP_*` id string (e.g. "MAP_ROUTE1").
 * @param {string} id
 * @returns {object|null}
 */
export function getStaticMapById(id) {
    const entry = getIndex().maps.find((m) => m.id === id);
    if (!entry) return null;
    return getStaticMap(entry.group, entry.num);
}
