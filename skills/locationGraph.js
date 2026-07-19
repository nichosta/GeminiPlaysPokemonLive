// =============================================================================
// LOCATION REGISTRY + CROSS-MAP GRAPH (A3)
// =============================================================================
//
// Query layer over the generated staticdata/frlg/locations.json and
// mapGraph.json (see staticdata/extractLocations.js). Answers the two
// questions C2 (cross-map routing) and D2 (the `goto`/`heal` tool args) need:
//
//   - "where is <named place>?"      -> resolveLocation / resolveDestination
//   - "what's the nearest <type>?"   -> nearestLocation (via map-hop BFS)
//   - "how do I get from map A to map B?" -> mapRoute (ordered warp/connection
//     edges; C2 walks each map leg with C1's findPath and executes the edge)
//
// Pure data + pure functions — no emulator dependency, matching staticMap.js.
// =============================================================================

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { componentOf } from "./staticMap.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FRLG_DIR = resolve(__dirname, "..", "staticdata", "frlg");

let registryCache = null;
let graphCache = null;
let adjacencyCache = null; // "group:num:component" -> [{ to: "group:num:component", edge }]

/** Node key: a component-node is identified by map (group:num) AND component. */
function nodeKey(group, num, component) {
    return `${group}:${num}:${component}`;
}

/** Loads and caches `frlg/locations.json`. */
export function getLocationRegistry() {
    if (!registryCache) {
        registryCache = JSON.parse(readFileSync(join(FRLG_DIR, "locations.json"), "utf8"));
    }
    return registryCache;
}

/** Loads and caches `frlg/mapGraph.json`. */
export function getMapGraph() {
    if (!graphCache) {
        graphCache = JSON.parse(readFileSync(join(FRLG_DIR, "mapGraph.json"), "utf8"));
    }
    return graphCache;
}

function getAdjacency() {
    if (adjacencyCache) return adjacencyCache;
    adjacencyCache = new Map();
    for (const edge of getMapGraph().edges) {
        // Post-A3 every edge carries from/to component; skip any that didn't
        // resolve (a warp with a missing landing) so a broken edge can't feed
        // the BFS a node key of `${group}:${num}:undefined`.
        if (edge.from.component == null || edge.to.component == null) continue;
        const fromKey = nodeKey(edge.from.group, edge.from.num, edge.from.component);
        if (!adjacencyCache.has(fromKey)) adjacencyCache.set(fromKey, []);
        adjacencyCache.get(fromKey).push({ to: nodeKey(edge.to.group, edge.to.num, edge.to.component), edge });
    }
    return adjacencyCache;
}

/** Every component-node key for a map (the multi-source/sink seed set). */
function nodeKeysForMap(group, num) {
    return getMapGraph()
        .nodes.filter((n) => n.group === group && n.num === num)
        .map((n) => nodeKey(group, num, n.component));
}

// -----------------------------------------------------------------------------
// Named-location resolution
// -----------------------------------------------------------------------------

function normalize(s) {
    return s
        .toLowerCase()
        .replace(/['’]/g, "")
        .replace(/\s+/g, " ")
        .trim();
}

/**
 * Resolves a free-text location name against the registry: exact match on
 * name/alias/canonical `MAP_*` id first, then a word-subset fallback (every
 * word in the query appears somewhere in the candidate name) for phrasings
 * that drop a word, e.g. "Pewter Gym" -> "Pewter City Gym", "Viridian Mart"
 * -> "Viridian City Mart". The id match is case-insensitive exact-only (no
 * fuzzy matching) — models occasionally pass the internal decomp id (e.g.
 * "MAP_ROUTE1") instead of the friendly name they were shown, presumably
 * from training-data familiarity with the games' source; every
 * locations.json entry already carries its id, so this is a cheap, safe win.
 * @param {string} query
 * @returns {object|null} A locations.json entry, or null if nothing matched.
 */
export function resolveLocation(query) {
    if (!query) return null;
    const norm = normalize(query);
    const { locations } = getLocationRegistry();

    for (const loc of locations) {
        if (normalize(loc.name) === norm) return loc;
        if (loc.aliases.some((a) => normalize(a) === norm)) return loc;
        if (typeof loc.id === "string" && loc.id.toLowerCase() === norm) return loc;
    }

    if (norm.length < 4) return null; // too short to fuzzy-match safely
    const queryWords = norm.split(" ");
    let best = null;
    for (const loc of locations) {
        const names = [loc.name, ...loc.aliases].map(normalize);
        const matches = names.some((n) => {
            const nameWords = n.split(" ");
            return queryWords.every((w) => nameWords.includes(w));
        });
        if (matches) {
            if (!best || loc.name.length < best.name.length) best = loc;
        }
    }
    return best;
}

/** type tag -> natural-language phrases that mean it, for "nearest X" queries. */
const TAG_ALIASES = {
    pokecenter: ["pokecenter", "pokemon center", "poke center", "pokemoncenter", "pc", "nurse"],
    mart: ["mart", "shop", "pokemart", "poke mart", "store"],
    gym: ["gym"],
    museum: ["museum"],
    lab: ["lab", "laboratory"],
    house: ["house"],
};

/** Resolves a free-text type phrase (e.g. "pokemon center") to a registry `type`. */
export function resolveTag(phrase) {
    if (!phrase) return null;
    const norm = normalize(phrase);
    for (const [tag, aliases] of Object.entries(TAG_ALIASES)) {
        if (aliases.includes(norm)) return tag;
    }
    return null;
}

// -----------------------------------------------------------------------------
// Cross-map graph traversal
// -----------------------------------------------------------------------------

/**
 * Stable identity for a mapGraph.json edge, so a BFS can be re-run excluding
 * one it already tried. Two edges with the same key are the same crossing.
 * Includes component so the per-component edges A3 emits for a split map (same
 * map pair, different regions — e.g. Route 2 north vs. south) are distinct.
 * @param {object} edge
 * @returns {string}
 */
export function edgeKey(edge) {
    const fc = edge.from.component ?? 0; // boundary edges lack component; default 0
    const tc = edge.to.component ?? 0;
    const from = `${edge.from.group}:${edge.from.num}:${fc}`;
    const to = `${edge.to.group}:${edge.to.num}:${tc}`;
    if (edge.kind === "warp") return `warp|${from}->${to}|${edge.fromTile.x},${edge.fromTile.y}`;
    return `connection|${from}->${to}|${edge.direction}|${edge.offset}`;
}

/**
 * Shortest map-hop path between two positions, BFS over warp + connection edges
 * (unweighted: each map crossing counts as one hop). `from`/`to` carry a
 * `component` index when the caller knows the exact tile (C2 does — it resolves
 * `componentOf(start)`/`componentOf(goal)`); when `component` is omitted the BFS
 * seeds every component-node of that map and succeeds reaching any component of
 * the target map (a heuristic for nearest/distance queries that have a map but
 * no tile).
 *
 * The graph has one node per connected COMPONENT, not per map — so this CAN
 * route through a detour that re-enters the same map at a different region
 * (Pallet Town -> Pewter City via Viridian Forest, which lands back on Route 2's
 * north half after leaving its south half). A one-node-per-map BFS marks the
 * map visited on the way in via the south half and can't express that re-entry.
 *
 * @param {{group:number,num:number,component?:number}} from
 * @param {{group:number,num:number,component?:number}} to
 * @param {Set<string>} [excludeEdges] Edge keys (see `edgeKey`) to skip — for
 *        re-planning around a hop that turned out to be unwalkable within its
 *        map (graph-level connectivity doesn't guarantee an HM-gated-obstacle-
 *        free walk; see C2's note).
 * @returns {{found: boolean, hops?: Array<object>}} `hops` is the ordered list
 *          of mapGraph.json edges to cross; empty array if already at the goal.
 *
 * Executing a hop (for C2):
 *   - `kind: "warp"` — door metatiles carry MB_WARP_DOOR and read as
 *     collision-blocked in C1's static grid (the engine special-cases doors
 *     past the normal collision check), so route to `fromTile` with C1's
 *     `stopAdjacent: true` and press the returned `facing` to cross; you land
 *     at `toTile` on `to`.
 *   - `kind: "connection"` — an overworld border crossing, not a tile-precise
 *     warp. Only `direction`/`offset` are given; C2 must resolve the exact
 *     border tile from both maps' live dimensions before routing to it.
 *   - The BFS is unweighted over MAP hops only: it has no idea whether a
 *     connection's overlap is actually walkable inside either map (e.g. an
 *     HM-gated obstacle). When C1 reports no-path on a hop, C2 re-plans via
 *     `excludeEdges` rather than trusting the graph-level route blindly.
 */
export function mapRoute(from, to, excludeEdges) {
    const adjacency = getAdjacency();
    const startKeys = from.component != null ? [nodeKey(from.group, from.num, from.component)] : nodeKeysForMap(from.group, from.num);
    if (startKeys.length === 0) return { found: false };
    const targetKeys = to.component != null ? [nodeKey(to.group, to.num, to.component)] : nodeKeysForMap(to.group, to.num);
    const targetSet = new Set(targetKeys);
    const startSet = new Set(startKeys);

    // Already at the goal (same component, or an any-component match on the map).
    if (startKeys.some((k) => targetSet.has(k))) return { found: true, hops: [] };

    const visited = new Set(startKeys);
    const cameFrom = new Map(); // nodeKey -> { prevKey, edge }
    const queue = [...startKeys];
    let endKey = null;

    for (let i = 0; i < queue.length; i++) {
        const cur = queue[i];
        if (targetSet.has(cur)) {
            endKey = cur;
            break;
        }
        for (const { to: nbKey, edge } of adjacency.get(cur) || []) {
            if (visited.has(nbKey)) continue;
            if (excludeEdges && excludeEdges.has(edgeKey(edge))) continue;
            visited.add(nbKey);
            cameFrom.set(nbKey, { prevKey: cur, edge });
            queue.push(nbKey);
        }
    }

    if (endKey === null) return { found: false };

    const hops = [];
    let k = endKey;
    while (!startSet.has(k)) {
        const step = cameFrom.get(k);
        hops.push(step.edge);
        k = step.prevKey;
    }
    hops.reverse();
    return { found: true, hops };
}

/** Hop count between two positions, or null if unreachable within the graph. */
export function mapDistance(from, to) {
    const route = mapRoute(from, to);
    return route.found ? route.hops.length : null;
}

/**
 * Nearest location of a given `type` (map-hop distance from `from`, tie-broken
 * by local Manhattan distance when the candidate is on the same map). When
 * `from` carries a tile, its component is resolved precisely; otherwise the
 * distance is the multi-source heuristic (any component of `from`'s map).
 * @param {string} type Registry type tag, e.g. "pokecenter".
 * @param {{group:number,num:number,x?:number,y?:number}} from Current position.
 * @returns {object|null} A locations.json entry, or null if none reachable.
 */
export function nearestLocation(type, from) {
    const { locations } = getLocationRegistry();
    const candidates = locations.filter((l) => l.type === type);
    if (candidates.length === 0) return null;

    const fromPos = {
        group: from.group,
        num: from.num,
        component: from.x != null && from.y != null ? componentOf(from.group, from.num, from.x, from.y) : undefined,
    };

    let best = null;
    let bestScore = Infinity;
    for (const loc of candidates) {
        const toPos = { group: loc.group, num: loc.num, component: componentOf(loc.group, loc.num, loc.x, loc.y) };
        const dist = mapDistance(fromPos, toPos);
        if (dist === null) continue;
        const sameMap = loc.group === from.group && loc.num === from.num;
        const tieBreak = sameMap && from.x != null && from.y != null ? Math.abs(loc.x - from.x) + Math.abs(loc.y - from.y) : 0;
        const score = dist * 100000 + tieBreak;
        if (score < bestScore) {
            bestScore = score;
            best = loc;
        }
    }
    return best;
}

/**
 * Resolves a `goto`-style destination string (D1's DESTINATION_SCHEMA
 * `location` field) against the registry: "nearest <type>" queries resolve
 * relative to `from`; anything else is a plain name lookup.
 * @param {string} query
 * @param {{group:number,num:number,x?:number,y?:number}} [from]
 * @returns {object|null}
 */
export function resolveDestination(query, from = {}) {
    const nearestMatch = /^\s*nearest\s+(.+?)\s*$/i.exec(query || "");
    if (nearestMatch) {
        const tag = resolveTag(nearestMatch[1]);
        return tag ? nearestLocation(tag, from) : null;
    }
    return resolveLocation(query);
}
