// =============================================================================
// BATTLE STATIC DATA LOADER (support for C3)
// =============================================================================
//
// Thin, cached accessor over the battle static data extracted by
// staticdata/extractBattleData.js into `staticdata/frlg/`:
//   - move_data.json    move id -> { name, type, power, accuracy, pp, category,
//                                   effect, priority, target, flags }
//   - type_chart.json   Gen-3 type-effectiveness table (atkType, defType, mult)
//
// Mirrors skills/staticMap.js: pure filesystem reads, lazy + cached, no
// emulator dependency, so the policy engine and its offline tests can resolve
// move metadata and type matchups without touching RAM.
//
// The decomp's gTypeEffectiveness table only lists NON-1.0 matchups (the engine
// treats any absent pair as ×1). `typeMultiplier(atk, def)` honors that: an
// unknown pair returns 1. A defending Pokémon with two types takes the product
// of the per-type multipliers (so e.g. Water->Bug/Steel is 1× = normal).
// =============================================================================

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const FRLG_DIR = resolve(__dirname, "..", "staticdata", "frlg");

let moveByIdCache = null;
let moveByNameCache = null;
let typeChartCache = null;
let typeMulCache = null; // "ATK|DEF" -> multiplier

function loadMoves() {
    if (moveByIdCache) return;
    moveByIdCache = JSON.parse(readFileSync(join(FRLG_DIR, "move_data.json"), "utf8"));
    moveByNameCache = new Map();
    for (const [id, mv] of Object.entries(moveByIdCache)) {
        if (mv && mv.name) moveByNameCache.set(mv.name, mv);
    }
}

function loadTypeChart() {
    if (typeChartCache) return;
    typeChartCache = JSON.parse(readFileSync(join(FRLG_DIR, "type_chart.json"), "utf8"));
    typeMulCache = new Map();
    for (const e of typeChartCache.entries) {
        typeMulCache.set(`${e.attackType}|${e.defendType}`, e.multiplier);
    }
}

/**
 * Move metadata by numeric id (1..355), or null if unknown.
 * @param {number} id
 * @returns {object|null}
 */
export function getMoveById(id) {
    loadMoves();
    return moveByIdCache[String(id)] ?? null;
}

/**
 * Move metadata by NAME (the uppercase decomp name, e.g. "EMBER", "WATER_GUN").
 * Also tolerates the case where a party snapshot carries a species/move name in
 * a different case by matching on the uppercased token.
 * @param {string} name
 * @returns {object|null}
 */
export function getMoveByName(name) {
    loadMoves();
    if (!name) return null;
    if (moveByNameCache.has(name)) return moveByNameCache.get(name);
    const up = String(name).toUpperCase();
    return moveByNameCache.get(up) ?? null;
}

/**
 * Raw type-effectiveness table (for inspection / tests).
 * @returns {object}
 */
export function getTypeChart() {
    loadTypeChart();
    return typeChartCache;
}

/**
 * Single-type damage multiplier for an attacking type against ONE defending
 * type. Unknown pairs default to 1.0 (the engine treats absent pairs as normal).
 * @param {string} atkType e.g. "FIRE"
 * @param {string} defType e.g. "GRASS"
 * @returns {number} 0 | 0.5 | 1 | 2
 */
export function typeMultiplierSingle(atkType, defType) {
    loadTypeChart();
    if (!atkType || !defType) return 1;
    return typeMulCache.get(`${atkType}|${defType}`) ?? 1;
}

/**
 * Combined damage multiplier for an attacking type against a defending Pokémon
 * whose type(s) are `defTypes` (one or two entries). Two-type defenders take the
 * product of the per-type multipliers. An empty/unknown defender type list
 * yields 1.0 (no matchup info → treat as neutral).
 * @param {string} atkType
 * @param {string[]} defTypes
 * @returns {number}
 */
export function typeMultiplier(atkType, defTypes) {
    if (!Array.isArray(defTypes) || defTypes.length === 0 || !atkType) return 1;
    let mult = 1;
    for (const dt of defTypes) {
        mult *= typeMultiplierSingle(atkType, dt);
    }
    return mult;
}
