// Workstream A1 — Static map-data extraction from the pret/pokefirered decomp.
//
// Reads the decomp's map/layout/tileset source data and emits self-contained
// static JSON for the pre-Brock maps: layout grid (metatile IDs), per-tile
// collision + elevation, resolved metatile behaviors, warps, and connections.
// This replaces the slow, fragile runtime RAM reads of map geometry (see
// gamestate/overworld/mapLayouts.js) with data computed once, offline.
//
// Usage:
//   POKEFIRERED_PATH=~/Desktop/pokefirered node staticdata/extractMapData.js
//   node staticdata/extractMapData.js --decomp /path/to/pokefirered --out staticdata/frlg
//
// The decomp is NOT vendored into this repo; clone it separately:
//   git clone --depth 1 https://github.com/pret/pokefirered.git

import fs from "fs";
import path from "path";
import os from "os";

// --- CLI / paths -----------------------------------------------------------

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

// --- Constants (authoritative, from the decomp) ----------------------------
// include/global.fieldmap.h + src/fieldmap.c
const MAPGRID_METATILE_ID_MASK = 0x03ff;
const MAPGRID_COLLISION_MASK = 0x0c00;
const MAPGRID_COLLISION_SHIFT = 10;
const MAPGRID_ELEVATION_MASK = 0xf000;
const MAPGRID_ELEVATION_SHIFT = 12;
const MAPGRID_UNDEFINED = 0x03ff;
const NUM_METATILES_IN_PRIMARY = 640; // include/fieldmap.h
// FRLG metatile attributes are u32; behavior lives in bits 0-8.
const METATILE_ATTR_BYTES = 4;
const METATILE_ATTRIBUTE_BEHAVIOR_MASK = 0x000001ff;

// The set of maps in scope for A1: everything reachable up to and including the
// Pewter City gym (Brock). Overworld routes/towns plus their pre-Brock
// interiors and gate buildings. Directory names as they appear in data/maps/.
const SCOPE_MAPS = [
  // Pallet Town + interiors
  "PalletTown",
  "PalletTown_PlayersHouse_1F",
  "PalletTown_PlayersHouse_2F",
  "PalletTown_RivalsHouse",
  "PalletTown_ProfessorOaksLab",
  // Route 1
  "Route1",
  // Viridian City + interiors
  "ViridianCity",
  "ViridianCity_House",
  "ViridianCity_Gym",
  "ViridianCity_School",
  "ViridianCity_Mart",
  "ViridianCity_PokemonCenter_1F",
  "ViridianCity_PokemonCenter_2F",
  // Route 22 (rival)
  "Route22",
  "Route22_NorthEntrance",
  // Route 2 + gates + Viridian Forest
  "Route2",
  "Route2_ViridianForest_SouthEntrance",
  "Route2_ViridianForest_NorthEntrance",
  "Route2_House",
  "Route2_EastBuilding",
  "ViridianForest",
  // Pewter City + interiors
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

// --- Small helpers ---------------------------------------------------------

function readJSON(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

// --- Build global indexes --------------------------------------------------

// dirName -> { group, num }  and  mapId ("MAP_...") -> { group, num, name }
function buildMapIndex() {
  const groups = readJSON(path.join(DECOMP, "data/maps/map_groups.json"));
  const order = groups.group_order;
  const byDir = new Map();
  const byId = new Map();
  order.forEach((groupName, groupIdx) => {
    const dirs = groups[groupName];
    dirs.forEach((dir, num) => {
      byDir.set(dir, { group: groupIdx, num });
      const mapJsonPath = path.join(DECOMP, "data/maps", dir, "map.json");
      if (fs.existsSync(mapJsonPath)) {
        const id = readJSON(mapJsonPath).id;
        if (id) byId.set(id, { group: groupIdx, num, name: dir });
      }
    });
  });
  return { byDir, byId };
}

// layout id -> layout record from data/layouts/layouts.json
function buildLayoutIndex() {
  const { layouts } = readJSON(path.join(DECOMP, "data/layouts/layouts.json"));
  const byId = new Map();
  for (const l of layouts) if (l && l.id) byId.set(l.id, l);
  return byId;
}

// Tileset label ("gTileset_General") -> { attributesPath, isSecondary }.
// Parsed authoritatively from the decomp source so there's no name guessing.
function buildTilesetAttrIndex() {
  const headers = fs.readFileSync(path.join(DECOMP, "src/data/tilesets/headers.h"), "utf8");
  const metatiles = fs.readFileSync(path.join(DECOMP, "src/data/tilesets/metatiles.h"), "utf8");

  // gMetatileAttributes_Foo -> relative bin path
  const attrSymToPath = new Map();
  const incbinRe = /const\s+u32\s+(gMetatileAttributes_\w+)\s*\[\s*\]\s*=\s*INCBIN_U32\(\s*"([^"]+)"\s*\)/g;
  for (let m; (m = incbinRe.exec(metatiles)); ) attrSymToPath.set(m[1], m[2]);

  // Each `const struct Tileset gTileset_X = { ... .isSecondary = ..., .metatileAttributes = gMetatileAttributes_Y, ... };`
  const tilesetToAttr = new Map();
  const blockRe = /const\s+struct\s+Tileset\s+(gTileset_\w+)\s*=\s*\{([\s\S]*?)\};/g;
  for (let m; (m = blockRe.exec(headers)); ) {
    const label = m[1];
    const body = m[2];
    const attrMatch = body.match(/\.metatileAttributes\s*=\s*(gMetatileAttributes_\w+)/);
    const secMatch = body.match(/\.isSecondary\s*=\s*(TRUE|FALSE)/);
    if (!attrMatch) continue;
    const attrSym = attrMatch[1];
    const relPath = attrSymToPath.get(attrSym);
    if (!relPath) continue;
    tilesetToAttr.set(label, {
      attributesPath: path.join(DECOMP, relPath),
      isSecondary: secMatch ? secMatch[1] === "TRUE" : undefined,
    });
  }
  return tilesetToAttr;
}

// Metatile behavior id -> name ("MB_TALL_GRASS"), from the decomp header.
function buildBehaviorNameIndex() {
  const src = fs.readFileSync(path.join(DECOMP, "include/constants/metatile_behaviors.h"), "utf8");
  const byId = new Map();
  const re = /#define\s+(MB_\w+)\s+(0x[0-9A-Fa-f]+|\d+)/g;
  for (let m; (m = re.exec(src)); ) byId.set(parseInt(m[2], m[2].startsWith("0x") ? 16 : 10), m[1]);
  return byId;
}

// Read a tileset's metatile_attributes.bin into an array of behavior ids.
function readBehaviorsFromAttrBin(attributesPath) {
  const buf = fs.readFileSync(attributesPath);
  const behaviors = [];
  for (let i = 0; i + METATILE_ATTR_BYTES <= buf.length; i += METATILE_ATTR_BYTES) {
    const attr = buf.readUInt32LE(i);
    behaviors.push(attr & METATILE_ATTRIBUTE_BEHAVIOR_MASK);
  }
  return behaviors;
}

// --- Core extraction -------------------------------------------------------

const mapIndex = buildMapIndex();
const layoutIndex = buildLayoutIndex();
const tilesetAttrIndex = buildTilesetAttrIndex();
const behaviorNames = buildBehaviorNameIndex();
const behaviorCache = new Map(); // tileset label -> behavior id array

function behaviorsForTileset(label) {
  if (behaviorCache.has(label)) return behaviorCache.get(label);
  const entry = tilesetAttrIndex.get(label);
  if (!entry) {
    console.warn(`  ! no tileset attributes found for ${label}`);
    behaviorCache.set(label, []);
    return [];
  }
  const behaviors = readBehaviorsFromAttrBin(entry.attributesPath);
  behaviorCache.set(label, behaviors);
  return behaviors;
}

// Resolve a metatile id to its behavior id using primary/secondary tilesets,
// mirroring GetAttributeByMetatileIdAndMapLayout in src/fieldmap.c.
function resolveBehaviorId(metatileId, primaryBehaviors, secondaryBehaviors) {
  if (metatileId < NUM_METATILES_IN_PRIMARY) {
    return metatileId < primaryBehaviors.length ? primaryBehaviors[metatileId] : 0;
  }
  const idx = metatileId - NUM_METATILES_IN_PRIMARY;
  return idx < secondaryBehaviors.length ? secondaryBehaviors[idx] : 0;
}

function resolveMapRef(mapId) {
  const hit = mapIndex.byId.get(mapId);
  return hit ? { group: hit.group, num: hit.num } : { group: null, num: null };
}

function extractMap(dir) {
  const mapJson = readJSON(path.join(DECOMP, "data/maps", dir, "map.json"));
  const groupNum = mapIndex.byDir.get(dir);
  const layout = layoutIndex.get(mapJson.layout);
  if (!layout) throw new Error(`layout ${mapJson.layout} not found for ${dir}`);

  const width = layout.width;
  const height = layout.height;
  const blockdata = fs.readFileSync(path.join(DECOMP, layout.blockdata_filepath));
  const expectedBytes = width * height * 2;
  if (blockdata.length !== expectedBytes) {
    console.warn(`  ! ${dir}: map.bin is ${blockdata.length} bytes, expected ${expectedBytes} (${width}x${height})`);
  }

  const primaryBehaviors = behaviorsForTileset(layout.primary_tileset);
  const secondaryBehaviors = behaviorsForTileset(layout.secondary_tileset);

  const metatileIds = new Array(width * height);
  const collision = new Array(width * height);
  const elevation = new Array(width * height);
  const behaviorIds = new Array(width * height);

  for (let i = 0; i < width * height; i++) {
    const block = blockdata.readUInt16LE(i * 2);
    const metatileId = block & MAPGRID_METATILE_ID_MASK;
    metatileIds[i] = metatileId;
    collision[i] = (block & MAPGRID_COLLISION_MASK) >> MAPGRID_COLLISION_SHIFT;
    elevation[i] = (block & MAPGRID_ELEVATION_MASK) >> MAPGRID_ELEVATION_SHIFT;
    behaviorIds[i] =
      metatileId === MAPGRID_UNDEFINED ? 0 : resolveBehaviorId(metatileId, primaryBehaviors, secondaryBehaviors);
  }

  const connections = (mapJson.connections || []).map((c) => ({
    direction: c.direction,
    offset: c.offset,
    map: c.map,
    ...resolveMapRef(c.map),
  }));

  const warps = (mapJson.warp_events || []).map((w) => ({
    x: w.x,
    y: w.y,
    elevation: w.elevation,
    dest_map: w.dest_map,
    dest_warp_id: Number(w.dest_warp_id),
    ...(() => {
      const r = resolveMapRef(w.dest_map);
      return { dest_group: r.group, dest_num: r.num };
    })(),
  }));

  return {
    id: mapJson.id,
    name: dir,
    group: groupNum ? groupNum.group : null,
    num: groupNum ? groupNum.num : null,
    layout_id: mapJson.layout,
    width,
    height,
    primary_tileset: layout.primary_tileset,
    secondary_tileset: layout.secondary_tileset,
    map_type: mapJson.map_type,
    weather: mapJson.weather,
    requires_flash: mapJson.requires_flash,
    allow_running: mapJson.allow_running,
    allow_cycling: mapJson.allow_cycling,
    allow_escaping: mapJson.allow_escaping,
    connections,
    warps,
    grid: {
      // All grids are row-major, length width*height. index = y*width + x.
      metatileIds,
      collision, // 0 = passable, non-zero = blocked (per collision layer)
      elevation,
      behaviorIds,
    },
  };
}

// --- Run -------------------------------------------------------------------

fs.mkdirSync(path.join(OUT_DIR, "maps"), { recursive: true });

// Shared behavior id -> name table (bits 0-8 of the u32 metatile attribute).
const behaviorTable = {};
for (const [id, name] of [...behaviorNames.entries()].sort((a, b) => a[0] - b[0])) {
  behaviorTable[id] = name;
}
fs.writeFileSync(
  path.join(OUT_DIR, "metatile_behaviors.json"),
  JSON.stringify(behaviorTable, null, 2) + "\n"
);

let sourceCommit = "unknown";
try {
  sourceCommit = fs
    .readFileSync(path.join(DECOMP, ".git/HEAD"), "utf8")
    .trim();
  if (sourceCommit.startsWith("ref:")) {
    const ref = sourceCommit.slice(4).trim();
    sourceCommit = fs.readFileSync(path.join(DECOMP, ".git", ref), "utf8").trim();
  }
} catch {}

const indexEntries = [];
for (const dir of SCOPE_MAPS) {
  const mapDir = path.join(DECOMP, "data/maps", dir);
  if (!fs.existsSync(mapDir)) {
    console.warn(`  ! skipping ${dir}: not found in decomp`);
    continue;
  }
  const map = extractMap(dir);
  fs.writeFileSync(path.join(OUT_DIR, "maps", `${dir}.json`), JSON.stringify(map, null, 2) + "\n");
  indexEntries.push({
    id: map.id,
    name: map.name,
    group: map.group,
    num: map.num,
    width: map.width,
    height: map.height,
    warps: map.warps.length,
    connections: map.connections.length,
    file: `maps/${dir}.json`,
  });
  console.log(`  ✓ ${dir} (${map.width}x${map.height}, ${map.warps.length} warps, ${map.connections.length} connections)`);
}

fs.writeFileSync(
  path.join(OUT_DIR, "index.json"),
  JSON.stringify(
    {
      game: "FRLG",
      scope: "pre-Brock (Pallet Town through Pewter City gym)",
      source: { repo: "https://github.com/pret/pokefirered", commit: sourceCommit },
      generatedAt: new Date().toISOString(),
      behaviorTable: "metatile_behaviors.json",
      gridFormat: {
        order: "row-major, index = y*width + x",
        collision: "0 = passable, non-zero = blocked",
        elevation: "0-15; 0 and 15 are special (transition/bridge)",
        behaviorIds: "resolve names via metatile_behaviors.json",
      },
      maps: indexEntries,
    },
    null,
    2
  ) + "\n"
);

console.log(`\nExtracted ${indexEntries.length} maps to ${OUT_DIR}`);
