// =============================================================================
// EXTRACT BATTLE STATIC DATA (feeds C3 — battle policy engine)
// =============================================================================
//
// Two offline tables the C3 battle policy needs to make rule-based decisions
// without runtime RAM reads of move/type metadata:
//
//   - frlg/move_data.json   — per-move id -> { name, type, power, accuracy, pp,
//                             effect, category, priority, flags, target }.
//   - frlg/type_chart.json  — Gen-3 type-effectiveness triplets
//                             (attackType, defendType, multiplier in {0,0.5,1,2})
//                             plus the type id<->name table.
//
// Both are parsed straight from the pret/pokefirered decomp's own sources, not
// hand-transcribed:
//   - move fields        src/data/battle_moves.h          (gBattleMoves[])
//   - move id<->name     include/constants/moves.h
//   - type id<->name     include/constants/pokemon.h      (TYPE_NONE .. TYPE_DARK)
//   - effect id<->name   include/constants/battle_move_effects.h
//   - move flags         include/constants/pokemon.h      (FLAG_*)
//   - move target        include/battle.h                 (MOVE_TARGET_*)
//   - type chart         src/battle_main.c                (gTypeEffectiveness[336])
//
// `category` ("physical"|"special"|"status") is derived, not read: Gen-3 has no
// per-move category field — damage category is determined by the move's TYPE
// (Normal/Fighting/Flying/Poison/Ground/Rock/Bug/Ghost/Steel = physical;
// Fire/Water/Grass/Electric/Psychic/Ice/Dragon/Dark = special). "status" is any
// move with power 0 whose effect is not a damaging one (status/heal/etc.).
//
// Usage (mirrors extractMapData.js):
//   node staticdata/extractBattleData.js
//   POKEFIRERED_PATH=/path node staticdata/extractBattleData.js
//   node staticdata/extractBattleData.js --decomp /path --out staticdata/frlg
//
// Output is tracked in the repo (same convention as A1's map data — small,
// authoritative, regenerable if the decomp moves).
// =============================================================================

import fs from "fs";
import path from "path";
import os from "os";

// --- CLI / paths ------------------------------------------------------------

function parseArgs(argv) {
    const args = { decomp: null, out: null };
    for (let i = 2; i < argv.length; i++) {
        if (argv[i] === "--decomp") args.decomp = argv[++i];
        else if (argv[i] === "--out") args.out = argv[++i];
    }
    return args;
}

function expandHome(p) {
    if (!p) return p;
    if (p === "~") return os.homedir();
    if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
    return p;
}

const cli = parseArgs(process.argv);
const DECOMP = path.resolve(
    expandHome(cli.decomp || process.env.POKEFIRERED_PATH || path.join(os.homedir(), "Desktop", "pokefirered"))
);
const OUT_DIR = path.resolve(
    expandHome(cli.out || path.join(path.dirname(new URL(import.meta.url).pathname), "frlg"))
);

if (!fs.existsSync(path.join(DECOMP, "src", "data", "battle_moves.h"))) {
    console.error(`pokefirered decomp not found at: ${DECOMP}`);
    console.error("Pass --decomp <path> or set POKEFIRERED_PATH. Clone with:");
    console.error("  git clone --depth 1 https://github.com/pret/pokefirered.git");
    process.exit(1);
}

const read = (rel) => fs.readFileSync(path.join(DECOMP, rel), "utf8");

// --- #define table parser ---------------------------------------------------
// Builds a name -> numeric value map from a header file. Evaluates trivial
// `+ - * /` expressions over already-defined names and parenthesised bit
// shifts (`(1 << 5)`) so FLAG_* / TYPE_* resolve to plain integers the same way
// extractMilestones.js resolves flag bit-offsets.

function parseDefines(src, known = new Map()) {
    const out = new Map(known);
    // `[ \t]+` (not `\s+`) between name and value: `\s` would eat the newline
    // and let the value capture run onto the next line.
    const defineRe = /^#\s*define\s+([A-Z0-9_]+)[ \t]+(.+?)[ \t]*(?:\/\*.*?\*\/)?[ \t]*$/gm;
    let m;
    while ((m = defineRe.exec(src)) !== null) {
        const name = m[1];
        if (out.has(name)) continue; // first definition wins (matches C semantics for guards)
        const val = evalExpr(m[2].trim(), out);
        if (val !== null) out.set(name, val);
    }
    return out;
}

/**
 * Evaluates a restricted integer expression over an already-built name table.
 * Supports: integers, `(1 << N)` shifts, and `+ - * /` over names/ints. Returns
 * null on anything it can't resolve (left as a string elsewhere).
 */
function evalExpr(expr, names) {
    // `(1 << N)` and bare parenthesised shifts.
    const shift = expr.match(/^\(\s*1\s*<<\s*(\d+)\s*\)$/);
    if (shift) return 1 << Number(shift[1]);

    // A bare integer — checked BEFORE the name branch since `[A-Z0-9_]+` also
    // matches all-digit tokens.
    if (/^-?\d+$/.test(expr)) return Number(expr);

    // A single already-defined name.
    if (/^[A-Z0-9_]+$/.test(expr)) {
        return names.has(expr) ? names.get(expr) : null;
    }

    // `A + B`, `A | B`, `A - B`, etc. — tokenize and fold left-to-right over
    // the C operators that appear in these headers. Parenthesised shifts and
    // single names are resolved first, so a composite like
    // `FLAG_MAKES_CONTACT | FLAG_PROTECT_AFFECTED` resolves to a bitwise OR.
    const tokens = expr.match(/([A-Z0-9_]+|\(1\s*<<\s*\d+\s*\)|\d+|<<|>>|\||\&|\+|\-|\*|\/)/g);
    if (!tokens) return null;
    let total = null;
    let op = null;
    for (const tok of tokens) {
        let val;
        const s = tok.match(/^\(1\s*<<\s*(\d+)\s*\)$/);
        if (s) val = 1 << Number(s[1]);
        else if (/^[A-Z0-9_]+$/.test(tok)) val = names.get(tok);
        else if (/^-?\d+$/.test(tok)) val = Number(tok);
        else { op = tok; continue; } // operator

        if (val === undefined) return null;
        if (total === null) {
            total = val;
        } else if (op) {
            total = applyOp(total, op, val);
            op = null;
        } else {
            return null;
        }
    }
    return total;
}

function applyOp(a, op, b) {
    switch (op) {
        case "+": return a + b;
        case "-": return a - b;
        case "*": return a * b;
        case "/": return Math.trunc(a / b);
        case "<<": return a << b;
        case ">>": return a >> b;
        case "|": return a | b;
        case "&": return a & b;
        default: return null;
    }
}

// --- Load the name/id tables ------------------------------------------------

const movesSrc = read("include/constants/moves.h");
const pokemonSrc = read("include/constants/pokemon.h");
const effectsSrc = read("include/constants/battle_move_effects.h");
const battleSrc = read("include/battle.h");

// MOVE_NAME -> id (and the reverse).
const MOVE_IDS = parseDefines(movesSrc);
const MOVE_BY_ID = new Map(); // id -> name
for (const [name, id] of MOVE_IDS) {
    if (typeof id !== "number" || !Number.isFinite(id)) continue;
    if (name === "MOVES_COUNT") continue;
    if (!MOVE_BY_ID.has(id)) MOVE_BY_ID.set(id, name);
}

// TYPE_NAME -> id.
const TYPE_IDS = parseDefines(pokemonSrc, new Map([["TYPE_NONE", 255]]));
const TYPE_BY_ID = new Map(); // id -> name (e.g. 0 -> "NORMAL")
for (const [name, id] of TYPE_IDS) {
    if (!name.startsWith("TYPE_") || name === "TYPE_FORESIGHT" || name === "TYPE_ENDTABLE") continue;
    const short = name.slice("TYPE_".length);
    if (!TYPE_BY_ID.has(id)) TYPE_BY_ID.set(id, short);
}

// EFFECT_NAME -> id.
const EFFECT_IDS = parseDefines(effectsSrc);
const EFFECT_BY_ID = new Map();
for (const [name, id] of EFFECT_IDS) {
    if (!name.startsWith("EFFECT_")) continue;
    if (!EFFECT_BY_ID.has(id)) EFFECT_BY_ID.set(id, name.slice("EFFECT_".length));
}

// FLAG_NAME -> bitmask (FLAG_* in pokemon.h) and MOVE_TARGET_* in battle.h.
const FLAG_IDS = parseDefines(pokemonSrc);
const FLAG_BY_BIT = new Map(); // bit value -> name
for (const [name, bit] of FLAG_IDS) {
    if (!name.startsWith("FLAG_")) continue;
    if (typeof bit !== "number" || !Number.isFinite(bit) || bit <= 0) continue;
    if (!FLAG_BY_BIT.has(bit)) FLAG_BY_BIT.set(bit, name.slice("FLAG_".length));
}
const TARGET_IDS = parseDefines(battleSrc);
const TARGET_BY_ID = new Map();
for (const [name, id] of TARGET_IDS) {
    if (!name.startsWith("MOVE_TARGET_")) continue;
    if (typeof id !== "number" || !Number.isFinite(id)) continue;
    if (!TARGET_BY_ID.has(id)) TARGET_BY_ID.set(id, name.slice("MOVE_TARGET_".length));
}

// --- Gen-3 damage category (derived from type, not a per-move field) --------
// Physical types per the engine's `IS_SPECIAL_TYPE` inverse; everything else
// with power > 0 is physical. "???" (MYSTERY) treated as special.
const SPECIAL_TYPES = new Set(["FIRE", "WATER", "GRASS", "ELECTRIC", "PSYCHIC", "ICE", "DRAGON", "DARK"]);

/**
 * @param {{type:string, power:number, effect?:string}} move
 * @returns {"physical"|"special"|"status"}
 */
function categoryOf(move) {
    if (!move.power || move.power <= 0) return "status";
    return SPECIAL_TYPES.has(move.type) ? "special" : "physical";
}

// --- Parse gBattleMoves[] --------------------------------------------------

const battleMovesSrc = read("src/data/battle_moves.h");

/**
 * Parse a `#define`-less struct-designated-initializer block, e.g.
 *   [MOVE_POUND] = { .effect = EFFECT_HIT, .power = 40, .type = TYPE_NORMAL,
 *                    .accuracy = 100, .pp = 35, ... .flags = FLAG_A | FLAG_B, },
 * into a plain object keyed by the designator name.
 */
function parseBattleMoves(src) {
    const moves = [];
    // Each entry: `[MOVE_NAME] = { ... },`. Capture the move id name + body.
    const entryRe = /\[([A-Z0-9_]+)\]\s*=\s*\{([\s\S]*?)\},/g;
    let m;
    while ((m = entryRe.exec(src)) !== null) {
        const moveName = m[1];
        const body = m[2];
        if (!MOVE_IDS.has(moveName)) continue;
        const id = MOVE_IDS.get(moveName);
        if (typeof id !== "number" || !Number.isFinite(id)) continue;

        const field = (name) => {
            const r = new RegExp(`\\.${name}\\s*=\\s*([^,\\n]+)`, "m");
            const fm = body.match(r);
            return fm ? fm[1].trim().replace(/\s+$/, "") : null;
        };

        const effect = resolveName(field("effect"), EFFECT_IDS);
        const type = resolveName(field("type"), TYPE_IDS);
        const power = numOr(field("power"), 0);
        const accuracy = numOr(field("accuracy"), 0);
        const pp = numOr(field("pp"), 0);
        const priority = numOr(field("priority"), 0);
        const target = resolveName(field("target"), TARGET_IDS);

        // .flags is a `|`-separated list of FLAG_* names (or `0`).
        const flagsExpr = field("flags");
        const flags = flagsExpr ? evalExpr(flagsExpr, FLAG_IDS) : 0;
        const flagNames = flagsToNames(flags);

        const move = {
            id,
            name: moveName,
            effect: effect ?? null,
            type: type ?? null,
            power,
            accuracy,
            pp,
            priority,
            target: target ?? null,
            flags: flagNames,
        };
        move.category = categoryOf(move);
        moves.push(move);
    }
    // Sort by id so the output is stable and human-scannable.
    moves.sort((a, b) => a.id - b.id);
    return moves;
}

/** Resolves a designator value like `EFFECT_HIT` to its short string name, falling back to the raw token. */
function resolveName(token, table) {
    if (!token) return null;
    const cleaned = token.replace(/\/\*.*?\*\//g, "").trim();
    if (/^-?\d+$/.test(cleaned)) {
        // raw numeric id
        const n = Number(cleaned);
        for (const [name, id] of table) if (id === n) return shortName(name, table);
        return String(n);
    }
    if (table.has(cleaned)) return shortName(cleaned, table);
    return cleaned;
}

function shortName(name, table) {
    // TYPE_NORMAL -> NORMAL; EFFECT_HIT -> HIT; MOVE_TARGET_SELECTED -> SELECTED.
    if (table === TYPE_IDS) return name.startsWith("TYPE_") ? name.slice(5) : name;
    if (table === EFFECT_IDS) return name.startsWith("EFFECT_") ? name.slice(7) : name;
    if (table === TARGET_IDS) return name.startsWith("MOVE_TARGET_") ? name.slice(12) : name;
    return name;
}

function numOr(token, fallback) {
    if (!token) return fallback;
    const cleaned = token.replace(/\/\*.*?\*\//g, "").trim();
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : fallback;
}

function flagsToNames(bitmask) {
    if (!bitmask || typeof bitmask !== "number" || bitmask === 0) return [];
    const out = [];
    for (const [bit, name] of FLAG_BY_BIT) {
        if (bit & bitmask) out.push(name);
    }
    return out;
}

// --- Parse gTypeEffectiveness[] (336-byte triplet table) --------------------

const battleMainSrc = read("src/battle_main.c");

/**
 * Extracts the gTypeEffectiveness array body and turns each
 * (attackType, defendType, rawMultiplier) triplet into a normalized entry
 * (multiplier in {0, 0.5, 1, 2}) using the engine's own TYPE_MUL_* constants:
 * 0 -> no effect, 5 -> 0.5, 10 -> 1.0, 20 -> 2.0. The table is terminated by
 * TYPE_ENDTABLE (0xFF).
 */
function parseTypeChart(src) {
    const start = src.indexOf("gTypeEffectiveness[336]");
    if (start < 0) throw new Error("could not locate gTypeEffectiveness");
    const braceOpen = src.indexOf("{", start);
    const braceClose = src.indexOf("};", braceOpen);
    const body = src.slice(braceOpen + 1, braceClose);

    const triplets = [];
    const entryRe = /([A-Z0-9_]+)\s*,\s*([A-Z0-9_]+)\s*,\s*([A-Z0-9_]+)/g;
    let m;
    while ((m = entryRe.exec(body)) !== null) {
        const atk = m[1];
        const def = m[2];
        const mul = m[3];
        if (atk === "TYPE_ENDTABLE" || def === "TYPE_ENDTABLE") break;
        const atkId = TYPE_IDS.get(atk);
        const defId = TYPE_IDS.get(def);
        if (atkId === undefined || defId === undefined) continue;
        const norm = normalizeMul(mul);
        if (norm === null) continue;
        triplets.push({
            attackType: shortName(atk, TYPE_IDS),
            defendType: shortName(def, TYPE_IDS),
            multiplier: norm,
        });
    }
    return triplets;
}

// Maps the engine's own TYPE_MUL_* constant NAMES (defined in battle_main.h,
// not pokemon.h, so they aren't in TYPE_IDS) to a normalized multiplier. Also
// accepts raw numeric ids per the engine's fixed-point encoding.
function normalizeMul(token) {
    switch (token) {
        case "TYPE_MUL_NO_EFFECT": return 0;
        case "TYPE_MUL_NOT_EFFECTIVE": return 0.5;
        case "TYPE_MUL_NORMAL": return 1;
        case "TYPE_MUL_SUPER_EFFECTIVE": return 2;
        default:
            if (/^-?\d+$/.test(token)) {
                const n = Number(token);
                switch (n) {
                    case 0: return 0;
                    case 5: return 0.5;
                    case 10: return 1;
                    case 20: return 2;
                    default: return null;
                }
            }
            return null;
    }
}

// --- Build + write ---------------------------------------------------------

console.log(`Reading decomp from: ${DECOMP}`);

const moves = parseBattleMoves(battleMovesSrc);
const typeEntries = parseTypeChart(battleMainSrc);

// Compact move lookup keyed by numeric id for the policy engine to load fast.
const moveData = {};
for (const mv of moves) {
    // Strip the `MOVE_` prefix so names match the runtime move names B1 emits
    // (constant/moves_map.js keys moveId -> "SCRATCH", not "MOVE_SCRATCH").
    const shortName = mv.name.startsWith("MOVE_") ? mv.name.slice(5) : mv.name;
    moveData[mv.id] = {
        name: shortName,
        type: mv.type,
        power: mv.power,
        accuracy: mv.accuracy,
        pp: mv.pp,
        category: mv.category,
        effect: mv.effect,
        priority: mv.priority,
        target: mv.target,
        flags: mv.flags,
    };
}

const typeChart = {
    types: [...TYPE_BY_ID.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([id, name]) => ({ id, name })),
    // Multiplier constants documented inline so a reader doesn't need the decomp.
    multiplierEncoding: {
        0: "no_effect",
        0.5: "not_very_effective",
        1: "normal",
        2: "super_effective",
    },
    entries: typeEntries,
};

fs.writeFileSync(path.join(OUT_DIR, "move_data.json"), JSON.stringify(moveData, null, 2) + "\n");
fs.writeFileSync(path.join(OUT_DIR, "type_chart.json"), JSON.stringify(typeChart, null, 2) + "\n");

console.log(`\nExtracted ${moves.length} moves to ${path.relative(process.cwd(), path.join(OUT_DIR, "move_data.json"))}`);
console.log(`Extracted ${typeEntries.length} type-effectiveness triplets to ${path.relative(process.cwd(), path.join(OUT_DIR, "type_chart.json"))}`);

// Sanity echoes against the moves the pre-Brock starter/rivals actually use,
// so a broken parse is obvious from the log.
const sanityMoves = ["MOVE_SCRATCH", "MOVE_GROWL", "MOVE_TACKLE", "MOVE_EMBER", "MOVE_WATER_GUN", "MOVE_VINE_WHIP", "MOVE_POUND"];
for (const name of sanityMoves) {
    const id = MOVE_IDS.get(name);
    const found = moveData[id];
    console.log(`  ${name.padEnd(18)} id=${id} type=${found?.type} power=${found?.power} pp=${found?.pp} cat=${found?.category}`);
}
