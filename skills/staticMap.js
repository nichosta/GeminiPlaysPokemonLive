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
