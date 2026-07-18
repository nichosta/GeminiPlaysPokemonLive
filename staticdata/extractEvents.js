// Workstream A2 — trainers, sightlines, and items extraction from the
// pret/pokefirered decomp.
//
// Reads each pre-Brock map's object events (NPCs/trainers/item balls),
// background events (signs/hidden items), and coord events (script triggers,
// e.g. the Route 22 rival battle), resolves the scripts they point at against
// the decomp's own script sources to find `trainerbattle_*` / `finditem`
// commands, and cross-references `src/data/trainers.h` +
// `src/data/trainer_parties.h` for trainer class/name/party. Emits
// self-contained static JSON per map, independent of the A1 map-geometry
// output (see extractMapData.js) so re-running either pipeline never clobbers
// the other.
//
// Usage:
//   POKEFIRERED_PATH=~/Desktop/pokefirered node staticdata/extractEvents.js
//   node staticdata/extractEvents.js --decomp /path/to/pokefirered --out staticdata/frlg

import fs from "fs";
import path from "path";
import os from "os";

// --- CLI / paths (mirrors extractMapData.js) --------------------------------

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
  expandHome(cli.decomp || process.env.POKEFIRERED_PATH || path.join(os.homedir(), "Desktop/pokefirered"))
);
const OUT_DIR = path.resolve(expandHome(cli.out || path.join(path.dirname(new URL(import.meta.url).pathname), "frlg")));

if (!fs.existsSync(path.join(DECOMP, "data/maps/map_groups.json"))) {
  console.error(`pokefirered decomp not found at: ${DECOMP}`);
  console.error("Pass --decomp <path> or set POKEFIRERED_PATH. Clone with:");
  console.error("  git clone --depth 1 https://github.com/pret/pokefirered.git");
  process.exit(1);
}

function readJSON(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

// The maps in scope for A1/A2: everything reachable up to and including the
// Pewter City gym (Brock). Kept in sync with extractMapData.js's SCOPE_MAPS
// by hand — duplicated rather than imported so this script has no side
// effects from importing A1's top-level extraction run.
const SCOPE_MAPS = [
  "PalletTown",
  "PalletTown_PlayersHouse_1F",
  "PalletTown_PlayersHouse_2F",
  "PalletTown_RivalsHouse",
  "PalletTown_ProfessorOaksLab",
  "Route1",
  "ViridianCity",
  "ViridianCity_House",
  "ViridianCity_Gym",
  "ViridianCity_School",
  "ViridianCity_Mart",
  "ViridianCity_PokemonCenter_1F",
  "ViridianCity_PokemonCenter_2F",
  "Route22",
  "Route22_NorthEntrance",
  "Route2",
  "Route2_ViridianForest_SouthEntrance",
  "Route2_ViridianForest_NorthEntrance",
  "Route2_House",
  "Route2_EastBuilding",
  "ViridianForest",
  "PewterCity",
  "PewterCity_Museum_1F",
  "PewterCity_Museum_2F",
  "PewterCity_Gym",
  "PewterCity_Mart",
  "PewterCity_House1",
  "PewterCity_House2",
  "PewterCity_PokemonCenter_1F",
  "PewterCity_PokemonCenter_2F",
];

// --- Global indexes ----------------------------------------------------------

// dirName -> { group, num }, from data/maps/map_groups.json (matches RAM
// MAP_BANK_ADDR / MAP_NUMBER_ADDR, same as A1).
function buildMapIndex() {
  const groups = readJSON(path.join(DECOMP, "data/maps/map_groups.json"));
  const byDir = new Map();
  groups.group_order.forEach((groupName, groupIdx) => {
    groups[groupName].forEach((dir, num) => byDir.set(dir, { group: groupIdx, num }));
  });
  return byDir;
}

// name -> numeric value, for simple `#define NAME (0x..|\d+)` constants
// headers (species/items/trainers/trainer classes/moves are all shaped this
// way in the decomp).
function parseDefines(filePath, prefix) {
  const src = fs.readFileSync(filePath, "utf8");
  const re = new RegExp(`#define\\s+(${prefix}[A-Za-z0-9_]*)\\s+(0x[0-9A-Fa-f]+|\\d+)\\b`, "g");
  const byName = new Map();
  for (let m; (m = re.exec(src)); ) {
    byName.set(m[1], parseInt(m[2], m[2].startsWith("0x") ? 16 : 10));
  }
  return byName;
}

// TRAINER_CLASS_X -> readable name ("BUG CATCHER"), from the trainer class
// name text table.
function buildTrainerClassNames() {
  const src = fs.readFileSync(path.join(DECOMP, "src/data/text/trainer_class_names.h"), "utf8");
  const re = /\[(TRAINER_CLASS_\w+)\]\s*=\s*_\("([^"]*)"\)/g;
  const byName = new Map();
  for (let m; (m = re.exec(src)); ) byName.set(m[1], m[2]);
  return byName;
}

// sPartyArrayName -> array of { species, level, iv, item, moves }, from
// src/data/trainer_parties.h. Handles all four TrainerMon* struct variants
// (no-item/item x default-moves/custom-moves) generically by only reading
// the fields that are present.
function buildPartyArrays(speciesIds, itemIds, moveIds) {
  const src = fs.readFileSync(path.join(DECOMP, "src/data/trainer_parties.h"), "utf8");
  const arrays = new Map();
  const arrRe = /static const struct TrainerMon\w+ (\w+)\[\] = \{\n([\s\S]*?)\n\};/g;
  const monRe = / {4}\{\n([\s\S]*?)\n {4}\},?/g;
  for (let m; (m = arrRe.exec(src)); ) {
    const [, name, body] = m;
    const mons = [];
    monRe.lastIndex = 0;
    for (let mm; (mm = monRe.exec(body)); ) {
      const text = mm[1];
      const species = /\.species\s*=\s*(SPECIES_\w+)/.exec(text)?.[1] ?? null;
      const level = /\.lvl\s*=\s*(\d+)/.exec(text)?.[1];
      const iv = /\.iv\s*=\s*(\d+)/.exec(text)?.[1];
      const item = /\.heldItem\s*=\s*(ITEM_\w+)/.exec(text)?.[1] ?? null;
      const movesMatch = /\.moves\s*=\s*\{([^}]*)\}/.exec(text);
      const moves = movesMatch
        ? movesMatch[1].split(",").map((s) => s.trim()).filter(Boolean)
        : null;
      mons.push({
        species,
        species_num: species ? speciesIds.get(species) ?? null : null,
        level: level ? Number(level) : null,
        iv: iv ? Number(iv) : null,
        item,
        item_num: item ? itemIds.get(item) ?? null : null,
        moves,
        moves_num: moves ? moves.map((mv) => moveIds.get(mv) ?? null) : null,
      });
    }
    arrays.set(name, mons);
  }
  return arrays;
}

// TRAINER_X -> { trainerClass, trainerName, items, doubleBattle, party },
// from src/data/trainers.h + the party arrays above.
function buildTrainerIndex(speciesIds, itemIds, moveIds) {
  const src = fs.readFileSync(path.join(DECOMP, "src/data/trainers.h"), "utf8");
  const partyArrays = buildPartyArrays(speciesIds, itemIds, moveIds);
  const byName = new Map();
  const blockRe = /\[(TRAINER_\w+)\]\s*=\s*\{\n([\s\S]*?)\n {4}\},/g;
  for (let m; (m = blockRe.exec(src)); ) {
    const [, id, body] = m;
    const trainerClass = /\.trainerClass\s*=\s*(TRAINER_CLASS_\w+)/.exec(body)?.[1] ?? null;
    const trainerName = /\.trainerName\s*=\s*_\("([^"]*)"\)/.exec(body)?.[1] ?? null;
    const itemsMatch = /\.items\s*=\s*\{([^}]*)\}/.exec(body);
    const items = itemsMatch ? itemsMatch[1].split(",").map((s) => s.trim()).filter(Boolean) : [];
    const doubleBattle = /\.doubleBattle\s*=\s*(TRUE|FALSE)/.exec(body)?.[1] === "TRUE";
    const partyMatch = /\.party\s*=\s*\w+\((\w+)\)/.exec(body);
    const party = partyMatch ? partyArrays.get(partyMatch[1]) ?? [] : [];
    byName.set(id, { trainerClass, trainerName, items, doubleBattle, party });
  }
  return byName;
}

// --- Script source index -----------------------------------------------------
//
// Flattens every map's scripts.inc plus the shared data/scripts/*.inc files
// into one label -> body-text map, so trainerbattle_*/finditem commands can
// be resolved regardless of indirection (a script `goto`/`call`-ing another
// label, possibly in a different file — e.g. item balls route through the
// shared data/scripts/item_ball_scripts.inc).

function collectScriptFiles() {
  const files = [];
  const mapsDir = path.join(DECOMP, "data/maps");
  for (const dir of fs.readdirSync(mapsDir)) {
    const p = path.join(mapsDir, dir, "scripts.inc");
    if (fs.existsSync(p)) files.push(p);
  }
  const scriptsDir = path.join(DECOMP, "data/scripts");
  if (fs.existsSync(scriptsDir)) {
    for (const f of fs.readdirSync(scriptsDir)) {
      if (f.endsWith(".inc")) files.push(path.join(scriptsDir, f));
    }
  }
  return files;
}

const LABEL_RE = /^([A-Za-z_]\w*)::?\s*(?:@.*)?$/;

function buildScriptIndex() {
  const byName = new Map();
  for (const file of collectScriptFiles()) {
    const lines = fs.readFileSync(file, "utf8").split("\n");
    let current = null;
    for (const line of lines) {
      const isIndented = /^[ \t]/.test(line);
      const trimmed = line.trim();
      if (!isIndented && trimmed !== "") {
        const m = LABEL_RE.exec(trimmed);
        if (m) {
          current = [];
          byName.set(m[1], current);
          continue;
        }
      }
      if (current) current.push(line);
    }
  }
  const byNameJoined = new Map();
  for (const [k, v] of byName) byNameJoined.set(k, v.join("\n"));
  return byNameJoined;
}

// Breadth-first walk of goto/call (and their _if_eq/_if_set/... variants)
// starting at `startLabel`, collecting whatever `onMatch(line)` returns for
// each body line, tagged with any `_if_eq` conditions accumulated along the
// path that reached it. Used to resolve both trainerbattle_* (trainers) and
// finditem (item balls) through arbitrary script indirection.
const JUMP_RE = /^(goto|call)(_if_\w+)?\s+(.+?)\s*$/;

function bfsScript(scriptIndex, startLabel, onMatch) {
  if (!startLabel || startLabel === "0x0") return [];
  const visited = new Set();
  const queue = [{ label: startLabel, conditions: [] }];
  const results = [];
  while (queue.length) {
    const { label, conditions } = queue.shift();
    if (!label || visited.has(label) || visited.size > 300) continue;
    visited.add(label);
    const body = scriptIndex.get(label);
    if (!body) continue;
    for (const rawLine of body.split("\n")) {
      const line = rawLine.trim();
      const hit = onMatch(line);
      if (hit) results.push({ ...hit, conditions });
      const jm = JUMP_RE.exec(line);
      if (!jm) continue;
      const args = jm[3].split(",").map((s) => s.trim());
      const target = args[args.length - 1];
      if (!/^[A-Za-z_]\w*$/.test(target) || !scriptIndex.has(target)) continue;
      let nextConditions = conditions;
      if (jm[2] === "_if_eq" && args.length >= 3) {
        nextConditions = [...conditions, { var: args[0], value: args[1] }];
      }
      queue.push({ label: target, conditions: nextConditions });
    }
  }
  return results;
}

const TRAINERBATTLE_RE = /\btrainerbattle_(\w+)\s+(TRAINER_\w+)/;
const FINDITEM_RE = /\bfinditem\s+(ITEM_\w+)/;
const STARTER_RE = /\bsetvar\s+PLAYER_STARTER_SPECIES,\s*(SPECIES_\w+)/;

function findTrainerBattles(scriptIndex, startLabel) {
  return bfsScript(scriptIndex, startLabel, (line) => {
    const m = TRAINERBATTLE_RE.exec(line);
    return m ? { trainerbattleType: m[1], trainerId: m[2] } : null;
  });
}

function findGivenItem(scriptIndex, startLabel) {
  const hits = bfsScript(scriptIndex, startLabel, (line) => {
    const fi = FINDITEM_RE.exec(line);
    if (fi) return { kind: "item", item: fi[1] };
    const sv = STARTER_RE.exec(line);
    if (sv) return { kind: "starter", species: sv[1] };
    return null;
  });
  return hits[0] ?? null;
}

// --- Per-map extraction -------------------------------------------------------

const FACING_BY_MOVEMENT_TYPE = {
  MOVEMENT_TYPE_FACE_UP: "up",
  MOVEMENT_TYPE_FACE_DOWN: "down",
  MOVEMENT_TYPE_FACE_LEFT: "left",
  MOVEMENT_TYPE_FACE_RIGHT: "right",
};

function buildBattleInfo(battle, trainerIndex, trainerIds, trainerClassIds, trainerClassNames) {
  const info = trainerIndex.get(battle.trainerId);
  return {
    trainerbattle_type: battle.trainerbattleType,
    trainer_id: battle.trainerId,
    trainer_num: trainerIds.get(battle.trainerId) ?? null,
    trainer_class: info?.trainerClass ?? null,
    trainer_class_num: info?.trainerClass ? trainerClassIds.get(info.trainerClass) ?? null : null,
    trainer_class_name: info?.trainerClass ? trainerClassNames.get(info.trainerClass) ?? null : null,
    trainer_name: info?.trainerName ?? null,
    double_battle: info?.doubleBattle ?? false,
    items: info?.items ?? [],
    party: info?.party ?? [],
    conditions: battle.conditions ?? [],
  };
}

function buildTrainerEntry(oe, battle, indexes) {
  const { conditions, ...battleInfo } = buildBattleInfo(battle, ...indexes);
  return {
    local_id: oe.local_id ?? null,
    x: oe.x,
    y: oe.y,
    elevation: oe.elevation,
    movement_type: oe.movement_type,
    facing: FACING_BY_MOVEMENT_TYPE[oe.movement_type] ?? null,
    trainer_type: oe.trainer_type,
    sight_range: oe.trainer_type && oe.trainer_type !== "TRAINER_TYPE_NONE" ? Number(oe.trainer_sight_or_berry_tree_id) : null,
    script: oe.script,
    flag: oe.flag,
    ...battleInfo,
  };
}

function extractMapEvents(dir, ctx) {
  const { mapIndex, scriptIndex, itemIds, trainerIndex, trainerIds, trainerClassIds, trainerClassNames } = ctx;
  const battleIndexes = [trainerIndex, trainerIds, trainerClassIds, trainerClassNames];
  const mapJson = readJSON(path.join(ctx.DECOMP, "data/maps", dir, "map.json"));
  const gn = mapIndex.get(dir) ?? { group: null, num: null };

  const trainers = [];
  const items = [];
  for (const oe of mapJson.object_events || []) {
    if (oe.type !== "object") continue; // skip "clone" object events (decorative, no script)

    if (oe.graphics_id === "OBJ_EVENT_GFX_ITEM_BALL") {
      const given = findGivenItem(scriptIndex, oe.script);
      items.push({
        local_id: oe.local_id ?? null,
        x: oe.x,
        y: oe.y,
        elevation: oe.elevation,
        script: oe.script,
        flag: oe.flag,
        item: given?.kind === "item" ? given.item : null,
        item_num: given?.kind === "item" ? itemIds.get(given.item) ?? null : null,
        gives_starter: given?.kind === "starter" ? given.species : null,
      });
      continue;
    }

    const battles = findTrainerBattles(scriptIndex, oe.script);
    if (battles.length === 0) continue;
    if (battles.length > 1) {
      console.warn(`  ! ${dir}: ${oe.local_id ?? oe.script} resolves ${battles.length} trainer battles; keeping all under trainer_battles`);
      trainers.push({
        local_id: oe.local_id ?? null,
        x: oe.x,
        y: oe.y,
        elevation: oe.elevation,
        movement_type: oe.movement_type,
        facing: FACING_BY_MOVEMENT_TYPE[oe.movement_type] ?? null,
        trainer_type: oe.trainer_type,
        sight_range: oe.trainer_type && oe.trainer_type !== "TRAINER_TYPE_NONE" ? Number(oe.trainer_sight_or_berry_tree_id) : null,
        script: oe.script,
        flag: oe.flag,
        trainer_battles: battles.map((b) => buildBattleInfo(b, ...battleIndexes)),
      });
    } else {
      trainers.push(buildTrainerEntry(oe, battles[0], battleIndexes));
    }
  }

  const hiddenItems = (mapJson.bg_events || [])
    .filter((e) => e.type === "hidden_item")
    .map((e) => ({
      x: e.x,
      y: e.y,
      elevation: e.elevation,
      item: e.item,
      item_num: itemIds.get(e.item) ?? null,
      flag: e.flag,
      quantity: e.quantity,
      underfoot: !!e.underfoot,
    }));

  const scriptedEncounters = [];
  for (const ce of mapJson.coord_events || []) {
    if (ce.type !== "trigger") continue;
    const battles = findTrainerBattles(scriptIndex, ce.script);
    if (battles.length === 0) continue;
    scriptedEncounters.push({
      trigger: { x: ce.x, y: ce.y, elevation: ce.elevation, var: ce.var, var_value: ce.var_value },
      script: ce.script,
      battles: battles.map((b) => buildBattleInfo(b, ...battleIndexes)),
    });
  }

  return {
    id: mapJson.id,
    name: dir,
    group: gn.group,
    num: gn.num,
    trainers,
    items,
    hidden_items: hiddenItems,
    scripted_encounters: scriptedEncounters,
  };
}

// --- Run -----------------------------------------------------------------

console.log("Indexing decomp constants and scripts...");
const mapIndex = buildMapIndex();
const speciesIds = parseDefines(path.join(DECOMP, "include/constants/species.h"), "SPECIES_");
const itemIds = parseDefines(path.join(DECOMP, "include/constants/items.h"), "ITEM_");
const moveIds = parseDefines(path.join(DECOMP, "include/constants/moves.h"), "MOVE_");
const trainerIds = parseDefines(path.join(DECOMP, "include/constants/opponents.h"), "TRAINER_");
const trainerClassIds = parseDefines(path.join(DECOMP, "include/constants/trainers.h"), "TRAINER_CLASS_");
const trainerClassNames = buildTrainerClassNames();
const trainerIndex = buildTrainerIndex(speciesIds, itemIds, moveIds);
const scriptIndex = buildScriptIndex();
console.log(`  ${trainerIndex.size} trainers, ${scriptIndex.size} script labels indexed`);

fs.mkdirSync(path.join(OUT_DIR, "events"), { recursive: true });

let sourceCommit = "unknown";
try {
  sourceCommit = fs.readFileSync(path.join(DECOMP, ".git/HEAD"), "utf8").trim();
  if (sourceCommit.startsWith("ref:")) {
    const ref = sourceCommit.slice(4).trim();
    sourceCommit = fs.readFileSync(path.join(DECOMP, ".git", ref), "utf8").trim();
  }
} catch {}

const ctx = { DECOMP, mapIndex, scriptIndex, itemIds, trainerIndex, trainerIds, trainerClassIds, trainerClassNames };
const indexEntries = [];
for (const dir of SCOPE_MAPS) {
  const mapDir = path.join(DECOMP, "data/maps", dir);
  if (!fs.existsSync(mapDir)) {
    console.warn(`  ! skipping ${dir}: not found in decomp`);
    continue;
  }
  const events = extractMapEvents(dir, ctx);
  fs.writeFileSync(path.join(OUT_DIR, "events", `${dir}.json`), JSON.stringify(events, null, 2) + "\n");
  indexEntries.push({
    id: events.id,
    name: events.name,
    group: events.group,
    num: events.num,
    trainers: events.trainers.length,
    items: events.items.length,
    hidden_items: events.hidden_items.length,
    scripted_encounters: events.scripted_encounters.length,
    file: `events/${dir}.json`,
  });
  console.log(
    `  ✓ ${dir} (${events.trainers.length} trainers, ${events.items.length} items, ${events.hidden_items.length} hidden items, ${events.scripted_encounters.length} scripted encounters)`
  );
}

fs.writeFileSync(
  path.join(OUT_DIR, "events", "index.json"),
  JSON.stringify(
    {
      game: "FRLG",
      scope: "pre-Brock (Pallet Town through Pewter City gym)",
      source: { repo: "https://github.com/pret/pokefirered", commit: sourceCommit },
      generatedAt: new Date().toISOString(),
      notes: {
        trainers:
          "object_events resolved through trainerbattle_* commands (BFS over goto/call indirection). facing/sight_range describe the sightline trigger; encounter-tile geometry (line-of-cast over collision) is computed downstream, not here.",
        items: "ground OBJ_EVENT_GFX_ITEM_BALL object_events resolved through finditem commands; Pallet Town starter balls carry gives_starter instead of item.",
        hidden_items: "bg_events of type hidden_item; item/quantity/flag come straight from map.json, no script resolution needed.",
        scripted_encounters:
          "coord_events (map triggers) that reach a trainerbattle_* through script indirection, e.g. the Route 22 rival fight. conditions[] records _if_eq branches (var, value) walked to reach each battle.",
      },
      maps: indexEntries,
    },
    null,
    2
  ) + "\n"
);

console.log(`\nExtracted events for ${indexEntries.length} maps to ${path.join(OUT_DIR, "events")}`);
