// Workstream A (obstacle layer) — Static field-obstacle extraction from the
// pret/pokefirered decomp.
//
// Cut trees (and Strength boulders) are OBJECT EVENTS, not collision tiles, so
// A1's collision grid — and therefore A3's connected-component graph built from
// it — treats their tiles as passable. That makes the router plan routes that
// physically require an HM the player doesn't have: on Route 2 the two cut trees
// at (16,62)/(15,69) are the only tiles bridging the west field to the east
// corridor, so the (18,46) "East Building" gatehouse the graph picks as the
// shortest Pallet->Pewter hop is actually sealed off until Cut. When the player
// walks toward it the tree loads as a live blocker, the pure plan collapses, and
// the harness thrashes into the adjacent tall grass fighting encounters.
//
// This pass emits the fixed positions of those permanent obstacles per map so
// the pathfinder can treat them as blocked from static data (always, not only
// when the live object event happens to be loaded near the player). Feeding
// them into `findPath` makes the Cut-gated leg come back no-path, which the
// existing excludeEdges replan in crossMapRouter/locationGraph already recovers
// from by routing via Viridian Forest instead.
//
// Usage:
//   POKEFIRERED_PATH=~/Desktop/pokefirered node staticdata/extractObstacles.js
//   node staticdata/extractObstacles.js --decomp /path/to/pokefirered --out staticdata/frlg
//
// The decomp is NOT vendored; clone it separately (see staticdata/README.md).

import fs from "fs";
import path from "path";
import os from "os";

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
  console.error("Pass --decomp <path> or set POKEFIRERED_PATH.");
  process.exit(1);
}

function readJSON(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

// Object-event graphics ids that are permanent, HM-gated field obstacles.
// The `kind`/`requires` tell the runtime which HM removes them; pre-Brock the
// player has none, so all of these are unconditionally impassable in scope.
// Keyed on the decomp's OBJ_EVENT_GFX_* symbol so no numeric id is guessed.
const OBSTACLE_GFX = {
  OBJ_EVENT_GFX_CUT_TREE: { kind: "cut_tree", requires: "cut" },
  OBJ_EVENT_GFX_PUSHABLE_BOULDER: { kind: "boulder", requires: "strength" },
};

// Only the pre-Brock maps A1 extracted (keep this in lockstep with
// extractMapData.js's SCOPE_MAPS so obstacles.json covers exactly the maps the
// pathfinder can load).
const SCOPE_MAPS = [
  "PalletTown", "PalletTown_PlayersHouse_1F", "PalletTown_PlayersHouse_2F",
  "PalletTown_RivalsHouse", "PalletTown_ProfessorOaksLab",
  "Route1",
  "ViridianCity", "ViridianCity_House", "ViridianCity_Gym", "ViridianCity_School",
  "ViridianCity_Mart", "ViridianCity_PokemonCenter_1F", "ViridianCity_PokemonCenter_2F",
  "Route22", "Route22_NorthEntrance",
  "Route2", "Route2_ViridianForest_SouthEntrance", "Route2_ViridianForest_NorthEntrance",
  "Route2_House", "Route2_EastBuilding", "ViridianForest",
  "PewterCity", "PewterCity_Museum_1F", "PewterCity_Museum_2F", "PewterCity_Gym",
  "PewterCity_Mart", "PewterCity_House1", "PewterCity_House2",
  "PewterCity_PokemonCenter_1F", "PewterCity_PokemonCenter_2F",
];

function buildMapIndex() {
  const groups = readJSON(path.join(DECOMP, "data/maps/map_groups.json"));
  const byDir = new Map();
  groups.group_order.forEach((groupName, groupIdx) => {
    groups[groupName].forEach((dir, num) => byDir.set(dir, { group: groupIdx, num }));
  });
  return byDir;
}

function main() {
  const byDir = buildMapIndex();
  const maps = {};
  let total = 0;

  for (const dir of SCOPE_MAPS) {
    const loc = byDir.get(dir);
    if (!loc) {
      console.warn(`skip: ${dir} not found in map_groups.json`);
      continue;
    }
    const mapJsonPath = path.join(DECOMP, "data/maps", dir, "map.json");
    if (!fs.existsSync(mapJsonPath)) {
      console.warn(`skip: ${dir} has no map.json`);
      continue;
    }
    const mapJson = readJSON(mapJsonPath);
    const obstacles = [];
    for (const obj of mapJson.object_events || []) {
      const spec = OBSTACLE_GFX[obj.graphics_id];
      if (!spec) continue;
      obstacles.push({ x: obj.x, y: obj.y, kind: spec.kind, requires: spec.requires });
    }
    if (obstacles.length > 0) {
      maps[`${loc.group}:${loc.num}`] = obstacles;
      total += obstacles.length;
    }
  }

  const out = {
    generatedAt: new Date().toISOString(),
    note: "Permanent HM-gated field obstacles (cut trees, Strength boulders) as object-event tile positions. Pre-Brock the player has no HM, so all are impassable. See extractObstacles.js.",
    maps,
  };
  const outPath = path.join(OUT_DIR, "obstacles.json");
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n");
  console.log(`Wrote ${outPath}: ${total} obstacles across ${Object.keys(maps).length} maps`);
  for (const [k, v] of Object.entries(maps)) {
    console.log(`  ${k}: ${v.map((o) => `(${o.x},${o.y})${o.kind === "cut_tree" ? "" : ":" + o.kind}`).join(" ")}`);
  }
}

main();
