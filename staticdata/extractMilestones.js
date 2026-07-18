// Workstream A4 — Milestone / quest graph.
//
// Encodes the pre-Brock story sequence (Pallet Town through the Pewter City
// gym / Boulder Badge) as an ordered list of milestones, each tagged with the
// RAM flag(s) that mark it complete — the reward signals E4 (SFT+RL) and the
// checkpoint anchors D4 (savestate checkpoints at each milestone) consume.
//
// This is the only A-workstream task that touches the *story* layer rather
// than map geometry. Flag values are resolved authoritatively from the
// decomp's own `include/constants/flags.h` (evaluating the `SYS_FLAGS + 0x20`
// / `FLAG_0x4FF + 1` / `FLAG_HIDDEN_ITEMS_START + N` style expressions, not
// hard-coding them) and `include/constants/opponents.h` for trainer ids, so
// the trainer-defeat flag = `TRAINER_FLAGS_START + trainerId` math is the
// decomp's own (`src/fieldmap.c` FlagSet for trainers), not guessed.
//
// Emits:
//   staticdata/frlg/milestones.json — { source, flagBase, milestones[] }
//     where each milestone carries `completion.flags[]` (symbolic name +
//     numeric bit-offset) and `completion.mode` ("all" | "any"). Starter-
//     dependent battles (the rival fights) carry the three variant trainer-
//     defeat flags under mode "any" — only the one matching the chosen
//     starter is ever set, but the milestone is complete if *any* is.
//
// Usage:
//   node staticdata/extractMilestones.js
//   POKEFIRERED_PATH=/path/to/pokefirered node staticdata/extractMilestones.js
//   node staticdata/extractMilestones.js --decomp /path/to/pokefirered --out staticdata/frlg
// =============================================================================

import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// --- CLI ---------------------------------------------------------------------

function parseArgs(argv) {
    const args = { decomp: null, out: null };
    for (let i = 2; i < argv.length; i++) {
        if (argv[i] === "--decomp") args.decomp = argv[++i];
        else if (argv[i] === "--out") args.out = argv[++i];
    }
    return args;
}

function expandHome(p) {
    if (p.startsWith("~")) return path.join(os.homedir(), p.slice(1));
    return p;
}

const cli = parseArgs(process.argv);
const DECOMP = path.resolve(
    expandHome(cli.decomp || process.env.POKEFIRERED_PATH || path.join(os.homedir(), "Desktop/pokefirered"))
);
const OUT_DIR = path.resolve(__dirname, cli.out || "frlg");

if (!fs.existsSync(path.join(DECOMP, "include/constants/flags.h"))) {
    console.error(`pokefirered decomp not found at: ${DECOMP}`);
    console.error("Pass --decomp <path> or set POKEFIRERED_PATH. Clone with:");
    console.error("  git clone --depth 1 https://github.com/pret/pokefirered.git ~/Desktop/pokefirered");
    process.exit(1);
}

// --- flag #define expression evaluator ---------------------------------------
//
// flags.h uses real expressions, not just literals:
//   #define FLAG_BADGE01_GET  (SYS_FLAGS + 0x20)
//   #define TRAINER_FLAGS_START (FLAG_0x4FF + 1)
//   #define FLAG_HIDDEN_ITEM_VIRIDIAN_FOREST_POTION (FLAG_HIDDEN_ITEMS_START + 0)
// Resolve them generically with a tiny + - integer evaluator over already-
// defined names, so a future flag renumbering in the decomp flows through
// without an edit here. Same authoritative-decode philosophy as A1/A2.

function readDefines(filePath) {
    const src = fs.readFileSync(filePath, "utf8");
    const defines = new Map(); // name -> raw expression string (unparsed)
    // `#define NAME <rest-of-line>`. Strip trailing comments (both `// ...` and
    // `/* ... */`). Continuation lines (backslash) aren't used for these
    // flag headers.
    const re = /^\s*#\s*define\s+([A-Za-z_][A-Za-z0-9_]*)\s+(.+?)\s*(?:\/\/.*|\/\*.*)?$/gm;
    for (let m; (m = re.exec(src)); ) {
        const name = m[1];
        if (defines.has(name)) continue; // first definition wins
        defines.set(name, m[2].trim());
    }
    return defines;
}

/** Tokenize an integer expression into names / numbers / operators / parens. */
function tokenize(expr) {
    const tokens = [];
    let i = 0;
    while (i < expr.length) {
        const c = expr[i];
        if (c === " " || c === "\t") { i++; continue; }
        if (c === "(" || c === ")") { tokens.push({ t: c }); i++; continue; }
        if (c === "+" || c === "-") { tokens.push({ t: c }); i++; continue; }
        if (c === "*" || c === "/") { tokens.push({ t: c }); i++; continue; }
        if (c === "0" && (expr[i + 1] === "x" || expr[i + 1] === "X")) {
            let j = i + 2;
            while (j < expr.length && /[0-9a-fA-F]/.test(expr[j])) j++;
            tokens.push({ n: parseInt(expr.slice(i, j), 16) });
            i = j;
            continue;
        }
        if (/[0-9]/.test(c)) {
            let j = i;
            while (j < expr.length && /[0-9]/.test(expr[j])) j++;
            tokens.push({ n: parseInt(expr.slice(i, j), 10) });
            i = j;
            continue;
        }
        if (/[A-Za-z_]/.test(c)) {
            let j = i;
            while (j < expr.length && /[A-Za-z0-9_]/.test(expr[j])) j++;
            tokens.push({ id: expr.slice(i, j) });
            i = j;
            continue;
        }
        // Unknown char — give up on this expression.
        throw new Error(`bad char ${c} in expr: ${expr}`);
    }
    return tokens;
}

function buildFlagResolver(defines) {
    const resolved = new Map(); // name -> number
    const stack = new Set();

    function resolveName(name) {
        if (resolved.has(name)) return resolved.get(name);
        const expr = defines.get(name);
        if (expr === undefined) return undefined; // external/unknown symbol
        if (stack.has(name)) throw new Error(`cyclic flag define: ${name}`);
        stack.add(name);
        const v = evalExpr(expr);
        stack.delete(name);
        resolved.set(name, v);
        return v;
    }

    function evalExpr(expr) {
        const tokens = tokenize(expr);
        let pos = 0;
        function peek() { return tokens[pos]; }
        function parsePrimary() {
            const tk = peek();
            if (!tk) throw new Error(`unexpected end in ${expr}`);
            if (tk.t === "(") {
                pos++;
                const v = parseAdd();
                if (peek()?.t !== ")") throw new Error(`missing ) in ${expr}`);
                pos++;
                return v;
            }
            if (tk.n !== undefined) { pos++; return tk.n; }
            if (tk.id !== undefined) {
                pos++;
                const v = resolveName(tk.id);
                if (v === undefined) throw new Error(`unknown symbol ${tk.id} in ${expr}`);
                return v;
            }
            throw new Error(`bad token in ${expr}`);
        }
        function parseMul() {
            let v = parsePrimary();
            while (peek() && (peek().t === "*" || peek().t === "/")) {
                const op = peek().t; pos++;
                const r = parsePrimary();
                v = op === "*" ? v * r : Math.floor(v / r);
            }
            return v;
        }
        function parseAdd() {
            let v = parseMul();
            while (peek() && (peek().t === "+" || peek().t === "-")) {
                const op = peek().t; pos++;
                const r = parseMul();
                v = op === "+" ? v + r : v - r;
            }
            return v;
        }
        return parseAdd();
    }

    return (name) => resolveName(name);
}

const flagDefines = readDefines(path.join(DECOMP, "include/constants/flags.h"));
// flags.h expressions reference symbols defined in opponents.h (e.g. SYS_FLAGS
// -> TRAINER_FLAGS_END -> MAX_TRAINERS_COUNT), so merge opponents.h's numeric
// defines in as a fallback layer (flags.h wins on collision).
const opponentDefines = readDefines(path.join(DECOMP, "include/constants/opponents.h"));
for (const [k, v] of opponentDefines) {
    if (!flagDefines.has(k)) flagDefines.set(k, v);
}
const resolveFlag = buildFlagResolver(flagDefines);

// Trainer ids from opponents.h (simple `#define TRAINER_X <int>` — reuse A2's
// parseDefines shape, but here we only need a name->int map and don't care to
// gate by prefix since opponents.h also has TRAINER_CLASS_* etc.).
function parseTrainerIds(filePath) {
    const src = fs.readFileSync(filePath, "utf8");
    const byName = new Map();
    const re = /#define\s+(TRAINER_[A-Za-z0-9_]+)\s+(0x[0-9A-Fa-f]+|\d+)\b/g;
    for (let m; (m = re.exec(src)); ) {
        if (!byName.has(m[1])) byName.set(m[1], parseInt(m[2], m[2].startsWith("0x") ? 16 : 10));
    }
    return byName;
}
const trainerIds = parseTrainerIds(path.join(DECOMP, "include/constants/opponents.h"));

/** The bit-offset of a trainer's defeat flag: TRAINER_FLAGS_START + trainerId. */
function trainerDefeatFlag(trainerName) {
    const id = trainerIds.get(trainerName);
    if (id === undefined) throw new Error(`unknown trainer: ${trainerName}`);
    const start = resolveFlag("TRAINER_FLAGS_START");
    if (start === undefined) throw new Error("could not resolve TRAINER_FLAGS_START");
    return { flag: `FLAG_DEFEATED_${trainerName}`, value: start + id, trainerId: id, trainer: trainerName };
}

function flagRef(flagName) {
    const value = resolveFlag(flagName);
    if (value === undefined) throw new Error(`unknown flag: ${flagName}`);
    return { flag: flagName, value };
}

// --- the curated pre-Brock milestone sequence --------------------------------
//
// Hand-curated from a read of the relevant scripts (PalletTown_ProfessorOaksLab,
// ViridianCity_Mart, Route22, PewterCity_Gym) — each milestone cites the flag
// the script itself `setflag`s at that beat, and starter-dependent battles list
// all three variant trainer-defeat flags (mode "any"). `requires` ties them
// into the story DAG; `optional` flags beats the pre-Brock sequence can skip
// (the Route 22 rival is a side fight, not on the critical path to Brock).

const TRAINER_FLAGS_START = resolveFlag("TRAINER_FLAGS_START");

const milestones = [
    {
        id: "chose_starter",
        order: 1,
        name: "Chose Starter Pokémon",
        kind: "story",
        map: "MAP_PALLET_TOWN_PROFESSOR_OAKS_LAB",
        description:
            "Player picks one of the three starter Poké Balls on Oak's table and receives the " +
            "monster. FLAG_SYS_POKEMON_GET is set in PalletTown_ProfessorOaksLab_EventScript_ChooseStarter; " +
            "FLAG_PALLET_LADY_NOT_BLOCKING_SIGN is set in the same scene so the player can leave town.",
        completion: {
            mode: "all",
            flags: [flagRef("FLAG_SYS_POKEMON_GET")],
            sideFlags: [flagRef("FLAG_PALLET_LADY_NOT_BLOCKING_SIGN")],
        },
        requires: [],
        optional: false,
        reward: "First party member; enables field battles and the Pallet Town exit.",
    },
    {
        id: "beat_rival_oaks_lab",
        order: 2,
        name: "Defeated Rival in Oak's Lab",
        kind: "battle",
        map: "MAP_PALLET_TOWN_PROFESSOR_OAKS_LAB",
        description:
            "Immediately after choosing a starter, the rival challenges the player to a first battle " +
            "in the lab. FLAG_BEAT_RIVAL_IN_OAKS_LAB is set after the trainerbattle resolves. The rival's " +
            "party depends on the chosen starter, so the trainer-defeat flag is one of three variants.",
        completion: {
            mode: "any",
            flags: [
                flagRef("FLAG_BEAT_RIVAL_IN_OAKS_LAB"),
                trainerDefeatFlag("TRAINER_RIVAL_OAKS_LAB_SQUIRTLE"),
                trainerDefeatFlag("TRAINER_RIVAL_OAKS_LAB_BULBASAUR"),
                trainerDefeatFlag("TRAINER_RIVAL_OAKS_LAB_CHARMANDER"),
            ],
        },
        requires: ["chose_starter"],
        optional: false,
        reward: "Story gate cleared to leave the lab.",
    },
    {
        id: "got_oaks_parcel",
        order: 3,
        name: "Received Oak's Parcel",
        kind: "item",
        map: "MAP_VIRIDIAN_CITY_MART",
        description:
            "The Viridian Mart clerk hands the player OAK'S PARCEL (a key item) to deliver to Prof. Oak. " +
            "There is no dedicated setflag for receiving the parcel — the scene is gated by " +
            "goto_if_unset FLAG_SYS_POKEDEX_GET and a per-map scene var (VAR_MAP_SCENE_VIRIDIAN_CITY_MART), " +
            "and the item itself (ITEM_OAKS_PARCEL) is what tracks it. Delivery immediately proceeds to the " +
            "Pokédex milestone, so FLAG_SYS_POKEDEX_GET marks the parcel quest *resolved*.",
        completion: {
            mode: "all",
            flags: [],
            item: { name: "ITEM_OAKS_PARCEL", resolvesTo: flagRef("FLAG_SYS_POKEDEX_GET") },
            note: "No dedicated flag; tracked by the OAK'S PARCEL key item. See got_pokedex for the resolved flag.",
        },
        requires: ["beat_rival_oaks_lab"],
        optional: false,
        reward: "Oak's Parcel key item; required to advance the Oak's Lab Pokédex scene.",
    },
    {
        id: "got_pokedex",
        order: 4,
        name: "Delivered Parcel / Received Pokédex",
        kind: "story",
        map: "MAP_PALLET_TOWN_PROFESSOR_OAKS_LAB",
        description:
            "Returning to Oak's Lab with the parcel triggers PalletTown_ProfessorOaksLab_EventScript_ReceiveDexScene: " +
            "Oak takes the parcel, the rival enters, and Oak gives the player the Pokédex plus 5 Poké Balls. " +
            "FLAG_SYS_POKEDEX_GET is set at the end of that scene.",
        completion: {
            mode: "all",
            flags: [flagRef("FLAG_SYS_POKEDEX_GET")],
        },
        requires: ["got_oaks_parcel"],
        optional: false,
        reward: "Pokédex + Poké Balls; enables catching and is the precondition for the Route 22 rival.",
    },
    {
        id: "beat_route22_rival",
        order: 5,
        name: "Defeated Route 22 Rival (optional)",
        kind: "battle",
        map: "MAP_ROUTE22",
        description:
            "A trigger-based (coord_event) early rival fight on Route 22, branched on VAR_STARTER_MON into one " +
            "of three TRAINER_RIVAL_ROUTE22_EARLY_* trainerbattle calls. No dedicated story flag is set for this " +
            "win — completion is the trainer-defeat flag (any of the three variants). Optional: not required to " +
            "reach Pewter, but returning to Oak afterward grants extra Poké Balls (got_pokeballs_topup).",
        completion: {
            mode: "any",
            flags: [
                trainerDefeatFlag("TRAINER_RIVAL_ROUTE22_EARLY_SQUIRTLE"),
                trainerDefeatFlag("TRAINER_RIVAL_ROUTE22_EARLY_BULBASAUR"),
                trainerDefeatFlag("TRAINER_RIVAL_ROUTE22_EARLY_CHARMANDER"),
            ],
        },
        requires: ["got_pokedex"],
        optional: true,
        reward: "Story beat only; gates the Oak Poké Ball top-up.",
    },
    {
        id: "got_pokeballs_topup",
        order: 6,
        name: "Received Poké Ball Top-up from Oak (optional)",
        kind: "item",
        map: "MAP_PALLET_TOWN_PROFESSOR_OAKS_LAB",
        description:
            "After the Route 22 rival, returning to Oak's Lab out of Poké Balls triggers a 5-ball top-up. " +
            "FLAG_GOT_POKEBALLS_FROM_OAK_AFTER_22_RIVAL is set, which in turn sets FLAG_OAK_SKIP_22_RIVAL_CHECK " +
            "(a derived flag, not a primary milestone). Optional and not on the path to Brock.",
        completion: {
            mode: "all",
            flags: [flagRef("FLAG_GOT_POKEBALLS_FROM_OAK_AFTER_22_RIVAL")],
            sideFlags: [flagRef("FLAG_OAK_SKIP_22_RIVAL_CHECK")],
        },
        requires: ["beat_route22_rival"],
        optional: true,
        reward: "+5 Poké Balls.",
    },
    {
        id: "defeated_brock",
        order: 7,
        name: "Defeated Brock",
        kind: "battle",
        map: "MAP_PEWTER_CITY_GYM",
        description:
            "PewterCity_Gym's victory script sets FLAG_DEFEATED_BROCK and FLAG_BADGE01_GET together. The " +
            "trainer-defeat flag (TRAINER_LEADER_BROCK) is also set by the trainerbattle. Completion is " +
            "satisfied by FLAG_DEFEATED_BROCK (the dedicated story flag) OR the trainer-defeat flag.",
        completion: {
            mode: "any",
            flags: [
                flagRef("FLAG_DEFEATED_BROCK"),
                trainerDefeatFlag("TRAINER_LEADER_BROCK"),
            ],
        },
        requires: ["got_pokedex"],
        optional: false,
        reward: "Gym cleared; Boulder Badge awarded.",
    },
    {
        id: "got_boulder_badge",
        order: 8,
        name: "Received Boulder Badge",
        kind: "badge",
        map: "MAP_PEWTER_CITY_GYM",
        description:
            "Set in the same Pewter Gym victory script as FLAG_DEFEATED_BROCK. This is the terminal " +
            "pre-Brock milestone — the project's scope ends here.",
        completion: {
            mode: "all",
            flags: [flagRef("FLAG_BADGE01_GET")],
        },
        requires: ["defeated_brock"],
        optional: false,
        reward: "Boulder Badge — pre-Brock scope complete.",
    },
];

// --- supplementary location-arrival flags ------------------------------------
//
// Soft "you've reached this area" signals the world-map / visited flags give.
// Not part of the strict story DAG (a player can be in Viridian before any of
// these are set), but useful as reward shaping for E4 and as redundant
// location checkpoints for D4. Resolved to numeric values like the rest.

const locationFlags = [
    { id: "visited_oaks_lab", flag: "FLAG_VISITED_OAKS_LAB", note: "Set on every transition into Oak's Lab." },
    { id: "world_map_viridian_city", flag: "FLAG_WORLD_MAP_VIRIDIAN_CITY", note: "Town map unlock for Viridian City." },
    { id: "world_map_pewter_city", flag: "FLAG_WORLD_MAP_PEWTER_CITY", note: "Town map unlock for Pewter City." },
    { id: "world_map_viridian_forest", flag: "FLAG_WORLD_MAP_VIRIDIAN_FOREST", note: "Town map unlock for Viridian Forest." },
    { id: "got_potion_route1", flag: "FLAG_GOT_POTION_ON_ROUTE_1", note: "Oak's aide on Route 1 hands out a Potion." },
].map((e) => ({ ...e, ...flagRef(e.flag) }));

// --- source commit -----------------------------------------------------------

let sourceCommit = "unknown";
try {
    let head = fs.readFileSync(path.join(DECOMP, ".git/HEAD"), "utf8").trim();
    if (head.startsWith("ref:")) {
        const ref = head.slice(4).trim();
        head = fs.readFileSync(path.join(DECOMP, ".git", ref), "utf8").trim();
    }
    sourceCommit = head;
} catch {
    // .git may be absent (e.g. a tarball); leave "unknown".
}

// --- write -------------------------------------------------------------------

const generatedAt = new Date().toISOString();

const output = {
    game: "FRLG",
    scope: "pre-Brock (Pallet Town through Pewter City gym / Boulder Badge)",
    generatedAt,
    source: { repo: "https://github.com/pret/pokefirered", commit: sourceCommit },
    flagBase: {
        note:
            "Flag bit-offsets resolved from include/constants/flags.h by evaluating the decomp's own " +
            "expressions (SYS_FLAGS + 0x20, FLAG_0x4FF + 1, FLAG_HIDDEN_ITEMS_START + N, ...). Trainer " +
            "defeat flags are TRAINER_FLAGS_START + trainerId (from opponents.h), matching the engine's " +
            "FlagSet for trainers. A runtime reader reads a flag by bitOffset = value: byte = floor(v/8), " +
            "bit = v % 8 — see gamestate/overworld/playerData.js readPlayerFlag.",
        TRAINER_FLAGS_START,
        SYS_FLAGS: resolveFlag("SYS_FLAGS"),
        TEMP_FLAGS_START: resolveFlag("TEMP_FLAGS_START"),
        FLAG_HIDDEN_ITEMS_START: resolveFlag("FLAG_HIDDEN_ITEMS_START"),
    },
    note:
        "completion.mode 'all' = every flag must be set; 'any' = any one (used for starter-dependent " +
        "battles, where only the variant matching the chosen starter is ever set). 'optional' milestones " +
        "are real story beats the pre-Brock path can skip (Route 22 rival + its Poké Ball top-up); the " +
        "critical path is chose_starter -> beat_rival_oaks_lab -> got_oaks_parcel -> got_pokedex -> " +
        "defeated_brock -> got_boulder_badge.",
    milestones,
    locationFlags,
};

fs.writeFileSync(path.join(OUT_DIR, "milestones.json"), JSON.stringify(output, null, 2));

const flagged = milestones.reduce((n, m) => n + m.completion.flags.length, 0);
console.log(
    `Wrote ${milestones.length} milestones (${flagged} flag refs, ${locationFlags.length} location flags) ` +
    `to ${path.relative(process.cwd(), path.join(OUT_DIR, "milestones.json"))}.`
);
