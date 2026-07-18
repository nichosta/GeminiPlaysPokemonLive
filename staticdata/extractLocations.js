// Workstream A3 — Location registry + cross-map graph.
//
// Derives named locations and a map-level routing graph purely from the A1
// static extraction (staticdata/frlg/index.json + maps/*.json) — no decomp
// access needed, this is a second pass over already-extracted data.
//
// Emits:
//   staticdata/frlg/locations.json — named location -> (map, tile) registry,
//     one entry per extracted map, typed (city/route/gym/mart/pokecenter/...)
//     by MAP_TYPE_* plus name pattern, with an anchor tile: the map's own
//     center (nearest passable tile) for outdoor maps, or the landing tile of
//     whichever warp leads into it for indoor maps.
//   staticdata/frlg/mapGraph.json — nodes (the 30 maps) + edges (every warp
//     and connection between them, with concrete tiles for warps). Edges that
//     leave the pre-Brock scope (e.g. Route 1 -> Route 21, Pewter -> Route 3)
//     are kept separately as `boundaryEdges` so consumers know the scope has a
//     wall there rather than silently treating it as a dead end.
//
// Usage:
//   node staticdata/extractLocations.js
// =============================================================================

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRLG_DIR = path.join(__dirname, "frlg");

const index = JSON.parse(fs.readFileSync(path.join(FRLG_DIR, "index.json"), "utf8"));
const inScope = new Set(index.maps.map((m) => key(m.group, m.num)));
const mapData = new Map(); // "group:num" -> parsed map JSON
for (const m of index.maps) {
    mapData.set(key(m.group, m.num), JSON.parse(fs.readFileSync(path.join(FRLG_DIR, m.file), "utf8")));
}

function key(group, num) {
    return `${group}:${num}`;
}

// --- naming ------------------------------------------------------------------

/** "PewterCity_PokemonCenter_1F" -> "Pewter City Pokemon Center 1F". */
function humanize(name) {
    return name
        .split("_")
        .map((seg) => {
            if (/^\d+F$/i.test(seg)) return seg.toUpperCase(); // keep "1F"/"2F" verbatim
            return seg
                .replace(/([a-z])([A-Z])/g, "$1 $2")
                .replace(/([A-Za-z])(\d)/g, "$1 $2")
                .replace(/(\d)([A-Za-z])/g, "$1 $2");
        })
        .join(" ");
}

/** Type tag from MAP_TYPE_* (outdoor) or a name-pattern refinement (indoor). */
function classifyType(name, mapType) {
    if (mapType === "MAP_TYPE_TOWN") return "city";
    if (mapType === "MAP_TYPE_ROUTE") return "route";
    // MAP_TYPE_INDOOR — refine by name (substring, floor-suffix agnostic).
    if (name.includes("PokemonCenter")) return name.endsWith("_2F") ? "pokecenter_upstairs" : "pokecenter";
    if (name.includes("Mart")) return "mart";
    if (name.includes("Gym")) return "gym";
    if (name.includes("Museum")) return "museum";
    if (name.includes("School")) return "school";
    if (name.includes("Lab")) return "lab";
    if (name.includes("Entrance")) return "gate";
    if (name.includes("House")) return "house";
    if (name.includes("Building")) return "building";
    return "building";
}

function aliasesFor(displayName, type) {
    const a = new Set([displayName.toLowerCase()]);
    if (type === "pokecenter" || type === "pokecenter_upstairs") {
        a.add(displayName.replace(/Pokemon Center/i, "Pokecenter").toLowerCase());
        a.add(displayName.replace(/Pokemon Center/i, "Poke Center").toLowerCase());
    }
    if (type === "mart") {
        a.add(displayName.replace(/\bMart\b/i, "Shop").toLowerCase());
        a.add(displayName.replace(/\bMart\b/i, "Poke Mart").toLowerCase());
    }
    return [...a];
}

// --- anchors -------------------------------------------------------------

/** Nearest passable tile to a map's center (spiral search), for outdoor maps. */
function centerAnchor(map) {
    const { width, height, grid } = map;
    const passable = (x, y) => x >= 0 && y >= 0 && x < width && y < height && grid.collision[y * width + x] === 0;
    const cx = Math.floor(width / 2);
    const cy = Math.floor(height / 2);
    if (passable(cx, cy)) return { x: cx, y: cy };
    for (let r = 1; r < Math.max(width, height); r++) {
        for (let dy = -r; dy <= r; dy++) {
            for (let dx = -r; dx <= r; dx++) {
                if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
                if (passable(cx + dx, cy + dy)) return { x: cx + dx, y: cy + dy };
            }
        }
    }
    return { x: cx, y: cy }; // unreachable in practice; every extracted map has open floor
}

/** First in-scope warp landing tile inside this map, for indoor maps. */
function warpAnchor(destKey, incomingByDest) {
    const incoming = incomingByDest.get(destKey);
    if (!incoming || incoming.length === 0) return null;
    const { dest_warp_id } = incoming[0];
    const destMap = mapData.get(destKey);
    const landing = destMap.warps[dest_warp_id];
    if (!landing) return null;
    return { x: landing.x, y: landing.y };
}

// --- build locations.json ------------------------------------------------

// Map every in-scope warp destination -> the warps that land there, in stable
// (index.json map order, then warps-array order) so anchor choice is deterministic.
const incomingByDest = new Map();
for (const m of index.maps) {
    const data = mapData.get(key(m.group, m.num));
    for (const w of data.warps || []) {
        const destKey = key(w.dest_group, w.dest_num);
        if (!inScope.has(destKey)) continue;
        if (!incomingByDest.has(destKey)) incomingByDest.set(destKey, []);
        incomingByDest.get(destKey).push(w);
    }
}

const locations = [];
for (const m of index.maps) {
    const mKey = key(m.group, m.num);
    const data = mapData.get(mKey);
    const displayName = humanize(m.name);
    const type = classifyType(m.name, data.map_type);

    let anchor;
    let anchorKind;
    if (data.map_type === "MAP_TYPE_INDOOR") {
        anchor = warpAnchor(mKey, incomingByDest);
        anchorKind = "warp";
        if (!anchor) {
            anchor = centerAnchor(data); // no in-scope door found; fall back
            anchorKind = "center";
        }
    } else {
        anchor = centerAnchor(data);
        anchorKind = "center";
    }

    if (data.grid.collision[anchor.y * data.width + anchor.x] !== 0) {
        throw new Error(`${m.name}: computed anchor (${anchor.x},${anchor.y}) is not passable`);
    }

    locations.push({
        name: displayName,
        aliases: aliasesFor(displayName, type),
        type,
        id: m.id,
        group: m.group,
        num: m.num,
        x: anchor.x,
        y: anchor.y,
        anchorKind,
    });
}

// --- build mapGraph.json ---------------------------------------------------

const nodes = index.maps.map((m) => ({
    id: m.id,
    name: m.name,
    group: m.group,
    num: m.num,
    type: classifyType(m.name, mapData.get(key(m.group, m.num)).map_type),
    mapType: mapData.get(key(m.group, m.num)).map_type,
}));

const edges = [];
const boundaryEdges = [];

for (const m of index.maps) {
    const mKey = key(m.group, m.num);
    const data = mapData.get(mKey);

    for (const w of data.warps || []) {
        const destKey = key(w.dest_group, w.dest_num);
        if (!inScope.has(destKey)) {
            boundaryEdges.push({
                kind: "warp",
                from: { group: m.group, num: m.num },
                fromTile: { x: w.x, y: w.y },
                to: w.dest_map,
            });
            continue;
        }
        const destMap = mapData.get(destKey);
        const landing = destMap.warps[w.dest_warp_id];
        edges.push({
            kind: "warp",
            from: { group: m.group, num: m.num },
            fromTile: { x: w.x, y: w.y },
            to: { group: w.dest_group, num: w.dest_num },
            toTile: landing ? { x: landing.x, y: landing.y } : null,
        });
    }

    for (const c of data.connections || []) {
        const destKey = key(c.group, c.num);
        if (!inScope.has(destKey)) {
            boundaryEdges.push({
                kind: "connection",
                from: { group: m.group, num: m.num },
                direction: c.direction,
                offset: c.offset,
                to: c.map,
            });
            continue;
        }
        edges.push({
            kind: "connection",
            from: { group: m.group, num: m.num },
            direction: c.direction,
            offset: c.offset,
            to: { group: c.group, num: c.num },
        });
    }
}

// --- write -------------------------------------------------------------

const generatedAt = new Date().toISOString();

fs.writeFileSync(
    path.join(FRLG_DIR, "locations.json"),
    JSON.stringify(
        {
            generatedAt,
            source: "derived from staticdata/frlg/index.json + maps/*.json (A1)",
            note:
                "One entry per extracted map. `anchorKind: warp` means (x,y) is the " +
                "landing tile of the first in-scope warp into this map (deterministic " +
                "by index.json order); `center` means the nearest passable tile to the " +
                "map's geometric center (outdoor maps, or indoor maps with no in-scope door).",
            locations,
        },
        null,
        2
    )
);

fs.writeFileSync(
    path.join(FRLG_DIR, "mapGraph.json"),
    JSON.stringify(
        {
            generatedAt,
            source: "derived from staticdata/frlg/index.json + maps/*.json (A1)",
            note:
                "Graph of the 30 pre-Brock maps joined by warps (concrete tiles both " +
                "ends) and overworld connections (direction+offset; C2 resolves exact " +
                "border tiles at execution time from live map dimensions). " +
                "`boundaryEdges` are real warps/connections whose destination falls " +
                "outside the pre-Brock extraction scope (e.g. Route 1 -> Route 21, " +
                "Pewter City -> Route 3) — kept so consumers see a documented scope " +
                "wall rather than an edge that silently vanished.",
            nodes,
            edges,
            boundaryEdges,
        },
        null,
        2
    )
);

console.log(`Wrote ${locations.length} locations, ${edges.length} edges, ${boundaryEdges.length} boundary edges.`);
