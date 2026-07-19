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

// Permanent HM-gated field obstacles (cut trees, Strength boulders) — see
// extractObstacles.js. These are object events, not collision tiles, so A1's
// collision grid treats their tiles as passable; the component/graph
// extraction below must additionally treat them as blocked, or the router
// (skills/crossMapRouter.js) plans "shortest" routes through them that are
// physically sealed off pre-HM (Route 2's Cut-tree-gated East Building hop is
// the case that surfaced this: `findPath` already rejects it via
// obstacles.json, but the graph previously didn't know the two sides were
// disconnected, so it kept offering that hop as if it were reachable).
const obstaclesFile = path.join(FRLG_DIR, "obstacles.json");
const obstaclesByMap = new Map(); // "group:num" -> Set("x,y")
if (fs.existsSync(obstaclesFile)) {
    const obstaclesJson = JSON.parse(fs.readFileSync(obstaclesFile, "utf8"));
    for (const [mKey, tiles] of Object.entries(obstaclesJson.maps || {})) {
        obstaclesByMap.set(mKey, new Set(tiles.map((t) => `${t.x},${t.y}`)));
    }
}

/** True when (x,y) is blocked either by collision or a permanent HM-gated obstacle. */
function isBlocked(mKey, map, x, y) {
    if (map.grid.collision[y * map.width + x] !== 0) return true;
    const obstacles = obstaclesByMap.get(mKey);
    return obstacles ? obstacles.has(`${x},${y}`) : false;
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

/** Nearest passable (non-obstacle) tile to a map's center (spiral search), for outdoor maps. */
function centerAnchor(mKey, map) {
    const { width, height } = map;
    const passable = (x, y) => x >= 0 && y >= 0 && x < width && y < height && !isBlocked(mKey, map, x, y);
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
            anchor = centerAnchor(mKey, data); // no in-scope door found; fall back
            anchorKind = "center";
        }
    } else {
        anchor = centerAnchor(mKey, data);
        anchorKind = "center";
    }

    if (isBlocked(mKey, data, anchor.x, anchor.y)) {
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

// --- connected components (per map) ----------------------------------------
// A map's passable tiles can split into multiple 4-connected regions when an
// impassable line bisects it — Route 2 is the pre-Brock example: rows 42-44 are
// a fully impassable Cut-tree wall (no Cut pre-Boulder-Badge) splitting it into
// a south half bordering Viridian City and a north half bordering Pewter City.
//
// The graph below has ONE NODE PER COMPONENT, not per map, so a route can
// re-enter the same map at a different component: the Pallet -> Pewter detour
// goes Route 2 (south) -> Viridian Forest -> Route 2 (north) -> Pewter, and the
// forest warps land back on Route 2's NORTH half — a distinct node from the
// SOUTH half the route left. A one-node-per-map graph can't express that
// re-entry (BFS marks the map visited on the way in via the south), which is
// why goto/C2 previously could not route Pallet Town -> Pewter City/Gym.
//
// C1's movement model is reversible — a ledge tile (MB_JUMP_*) lets you step
// back up onto it from a non-jump direction, so ledges don't create one-way
// disconnects for reachability. Undirected 4-connectivity of passable tiles is
// therefore exactly C1's reachability; no directed-SCC machinery is needed.

const DIRS4 = [
    [0, -1],
    [0, 1],
    [-1, 0],
    [1, 0],
];

/**
 * Undirected 4-connected components over passable tiles. Returns labels +
 * count. `mKey` looks up this map's permanent HM-gated obstacles (cut trees,
 * Strength boulders) so they split components the same way `findPath` treats
 * them as blocked at runtime — otherwise the graph offers routes through
 * tiles that are collision-passable but object-event-blocked pre-HM.
 */
function computeComponents(mKey, map) {
    const { width, height } = map;
    const blocked = (x, y) => isBlocked(mKey, map, x, y);
    const labels = new Int32Array(width * height).fill(-1); // -1 = blocked
    let count = 0;
    for (let sy = 0; sy < height; sy++) {
        for (let sx = 0; sx < width; sx++) {
            const si = sy * width + sx;
            if (blocked(sx, sy) || labels[si] !== -1) continue;
            const stack = [[sx, sy]];
            labels[si] = count;
            while (stack.length) {
                const [x, y] = stack.pop();
                for (const [dx, dy] of DIRS4) {
                    const nx = x + dx;
                    const ny = y + dy;
                    if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
                    const ni = ny * width + nx;
                    if (blocked(nx, ny) || labels[ni] !== -1) continue;
                    labels[ni] = count;
                    stack.push([nx, ny]);
                }
            }
            count++;
        }
    }
    return { labels, count };
}

/**
 * Component index of (x,y). Blocked tiles (door metatiles, collision != 0, or
 * a permanent HM-gated obstacle) have no label of their own; return the label
 * of a passable ortho-neighbour, the way the player steps off the tile. -1 if
 * the tile is isolated. Used for warp from/to tiles (doors) and any connection
 * landing that happens to be blocked.
 */
function componentOfTile(map, labels, x, y) {
    const { width, height } = map;
    if (x < 0 || y < 0 || x >= width || y >= height) return -1;
    const direct = labels[y * width + x];
    if (direct !== -1) return direct;
    for (const [dx, dy] of DIRS4) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const ni = ny * width + nx;
        if (labels[ni] !== -1) return labels[ni];
    }
    return -1;
}

/**
 * Connection border frame — mirrors resolveConnectionCrossing in
 * skills/crossMapRouter.js so this extraction and the runtime resolver agree on
 * which border tiles pair up across a connection (decomp's
 * SetPositionFromConnection: to.coord = from.coord - offset).
 */
function connectionFrame(fromMap, toMap, edge) {
    const { direction, offset } = edge;
    let vertical; // true: up/down (varying coord is x); false: left/right (y)
    let fromFixed; // from-map's fixed row (vertical) or column (horizontal)
    let toFixed; // to-map's fixed row/column, mirrored across the border
    switch (direction) {
        case "up":
            vertical = true;
            fromFixed = 0;
            toFixed = toMap.height - 1;
            break;
        case "down":
            vertical = true;
            fromFixed = fromMap.height - 1;
            toFixed = 0;
            break;
        case "left":
            vertical = false;
            fromFixed = 0;
            toFixed = toMap.width - 1;
            break;
        case "right":
            vertical = false;
            fromFixed = fromMap.width - 1;
            toFixed = 0;
            break;
        default:
            return null;
    }
    const fromDim = vertical ? fromMap.width : fromMap.height;
    const toDim = vertical ? toMap.width : toMap.height;
    const lo = Math.max(0, offset);
    const hi = Math.min(fromDim, offset + toDim); // exclusive
    return { vertical, fromFixed, toFixed, lo, hi };
}

// Compute components for every map once; reused for nodes, edges, and the
// components.json label grid the runtime componentOf() reads back.
const componentsByMap = new Map(); // "group:num" -> { labels: Int32Array, count }
for (const m of index.maps) {
    const mKey = key(m.group, m.num);
    componentsByMap.set(mKey, computeComponents(mKey, mapData.get(mKey)));
}

// --- build mapGraph.json (one node per component) --------------------------

const nodes = [];
for (const m of index.maps) {
    const mKey = key(m.group, m.num);
    const data = mapData.get(mKey);
    const { labels, count } = componentsByMap.get(mKey);
    const sizes = new Array(count).fill(0);
    for (let i = 0; i < labels.length; i++) if (labels[i] !== -1) sizes[labels[i]]++;
    for (let comp = 0; comp < count; comp++) {
        nodes.push({
            id: m.id,
            name: m.name,
            group: m.group,
            num: m.num,
            component: comp,
            type: classifyType(m.name, data.map_type),
            mapType: data.map_type,
            tileCount: sizes[comp],
        });
    }
}

const edges = [];
const boundaryEdges = [];

for (const m of index.maps) {
    const mKey = key(m.group, m.num);
    const data = mapData.get(mKey);
    const fromComps = componentsByMap.get(mKey);

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
        const destComps = componentsByMap.get(destKey);
        const landing = destMap.warps[w.dest_warp_id];
        const fromComp = componentOfTile(data, fromComps.labels, w.x, w.y);
        const toComp = landing ? componentOfTile(destMap, destComps.labels, landing.x, landing.y) : -1;
        edges.push({
            kind: "warp",
            from: { group: m.group, num: m.num, component: fromComp },
            fromTile: { x: w.x, y: w.y },
            to: { group: w.dest_group, num: w.dest_num, component: toComp },
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
        const toMap = mapData.get(destKey);
        const toComps = componentsByMap.get(destKey);
        // Enumerate every (fromComp -> toComp) pair reachable along the border;
        // one edge per distinct pair. Single-component borders (the common case,
        // incl. every critical-path connection) yield exactly one edge.
        // Multi-component borders (e.g. Route 22 -> Viridian City, whose right
        // edge touches three small regions) yield one per reachable pair.
        const frame = connectionFrame(data, toMap, c);
        const pairs = new Set();
        if (frame) {
            const { vertical, fromFixed, toFixed, lo, hi } = frame;
            for (let v = lo; v < hi; v++) {
                const fx = vertical ? v : fromFixed;
                const fy = vertical ? fromFixed : v;
                if (data.grid.collision[fy * data.width + fx] !== 0) continue;
                const tx = vertical ? v - c.offset : toFixed;
                const ty = vertical ? toFixed : v - c.offset;
                if (tx < 0 || ty < 0 || tx >= toMap.width || ty >= toMap.height) continue;
                if (toMap.grid.collision[ty * toMap.width + tx] !== 0) continue;
                const fromComp = fromComps.labels[fy * data.width + fx];
                const toComp = toComps.labels[ty * toMap.width + tx];
                if (fromComp === -1 || toComp === -1) continue;
                pairs.add(`${fromComp},${toComp}`);
            }
        }
        for (const pairKey of pairs) {
            const [fromComp, toComp] = pairKey.split(",").map(Number);
            edges.push({
                kind: "connection",
                from: { group: m.group, num: m.num, component: fromComp },
                to: { group: c.group, num: c.num, component: toComp },
                direction: c.direction,
                offset: c.offset,
            });
        }
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
                "border tiles at execution time from live map dimensions). Nodes are " +
                "per CONNECTED COMPONENT, not per map: a map bisected by an impassable " +
                "line (Route 2's Cut-tree wall, Pewter Museum's ticket gate) gets one " +
                "node per 4-connected passable region, and every edge carries " +
                "`from.component`/`to.component` so BFS can re-enter the same map at a " +
                "different region (the Pallet -> Pewter detour through Viridian Forest). " +
                "Component indices match components.json 1:1. `boundaryEdges` are real " +
                "warps/connections whose destination falls outside the pre-Brock " +
                "extraction scope (e.g. Route 1 -> Route 21, Pewter City -> Route 3) — " +
                "kept so consumers see a documented scope wall rather than an edge that " +
                "silently vanished.",
            nodes,
            edges,
            boundaryEdges,
        },
        null,
        2
    )
);

fs.writeFileSync(
    path.join(FRLG_DIR, "components.json"),
    JSON.stringify(
        {
            generatedAt,
            source: "derived from staticdata/frlg/index.json + maps/*.json (A1)",
            note:
                "Per-tile connected-component label grid (undirected 4-connectivity " +
                "over passable tiles; -1 = blocked). Lets the runtime resolve which " +
                "component a tile is in via O(1) lookup instead of recomputing a flood " +
                "fill. Component indices match mapGraph.json nodes' `component` field " +
                "1:1 — a node exists for every component, even portal-free pockets " +
                "(which simply carry no edges and are unreachable by BFS).",
            gridFormat: "row-major, index = y*width + x; value = component index or -1",
            maps: Object.fromEntries(
                index.maps.map((m) => {
                    const { labels, count } = componentsByMap.get(key(m.group, m.num));
                    return [
                        key(m.group, m.num),
                        { width: m.width, height: m.height, count, labels: Array.from(labels) },
                    ];
                })
            ),
        },
        null,
        2
    )
);

console.log(`Wrote ${locations.length} locations, ${nodes.length} component-nodes, ${edges.length} edges, ${boundaryEdges.length} boundary edges.`);
