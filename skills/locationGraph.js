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

const __dirname = dirname(fileURLToPath(import.meta.url));
const FRLG_DIR = resolve(__dirname, "..", "staticdata", "frlg");

let registryCache = null;
let graphCache = null;
let adjacencyCache = null; // "group:num" -> [{ to: "group:num", edge }]

function key(group, num) {
    return `${group}:${num}`;
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
        const fromKey = key(edge.from.group, edge.from.num);
        const toKey = key(edge.to.group, edge.to.num);
        if (!adjacencyCache.has(fromKey)) adjacencyCache.set(fromKey, []);
        adjacencyCache.get(fromKey).push({ to: toKey, edge });
    }
    return adjacencyCache;
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
 * name/alias first, then a word-subset fallback (every word in the query
 * appears somewhere in the candidate name) for phrasings that drop a word,
 * e.g. "Pewter Gym" -> "Pewter City Gym", "Viridian Mart" -> "Viridian City Mart".
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
 * @param {object} edge
 * @returns {string}
 */
export function edgeKey(edge) {
    const from = `${edge.from.group}:${edge.from.num}`;
    const to = `${edge.to.group}:${edge.to.num}`;
    if (edge.kind === "warp") return `warp|${from}->${to}|${edge.fromTile.x},${edge.fromTile.y}`;
    return `connection|${from}->${to}|${edge.direction}|${edge.offset}`;
}

/**
 * Shortest map-hop path from (fromGroup,fromNum) to (toGroup,toNum), BFS over
 * warp + connection edges (unweighted: each map crossing counts as one hop).
 * @param {Set<string>} [excludeEdges] Edge keys (see `edgeKey`) to skip — for
 *        re-planning around a hop that turned out to be unwalkable within its
 *        map (see C2's note below: graph-level connectivity doesn't guarantee
 *        an HM-gated obstacle-free walk, e.g. Route 2's Cut-tree split).
 * @returns {{found: boolean, hops?: Array<object>}} `hops` is the ordered list
 *          of mapGraph.json edges to cross; empty array if already there.
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
export function mapRoute(fromGroup, fromNum, toGroup, toNum, excludeEdges) {
    const fromKey = key(fromGroup, fromNum);
    const toKey = key(toGroup, toNum);
    if (fromKey === toKey) return { found: true, hops: [] };

    const adjacency = getAdjacency();
    const visited = new Set([fromKey]);
    const cameFrom = new Map(); // key -> { prevKey, edge }
    const queue = [fromKey];

    for (let i = 0; i < queue.length; i++) {
        const cur = queue[i];
        if (cur === toKey) break;
        for (const { to, edge } of adjacency.get(cur) || []) {
            if (visited.has(to)) continue;
            if (excludeEdges && excludeEdges.has(edgeKey(edge))) continue;
            visited.add(to);
            cameFrom.set(to, { prevKey: cur, edge });
            queue.push(to);
        }
    }

    if (!visited.has(toKey)) return { found: false };

    const hops = [];
    let k = toKey;
    while (k !== fromKey) {
        const step = cameFrom.get(k);
        hops.push(step.edge);
        k = step.prevKey;
    }
    hops.reverse();
    return { found: true, hops };
}

/** Hop count between two maps, or null if unreachable within the graph. */
export function mapDistance(fromGroup, fromNum, toGroup, toNum) {
    const route = mapRoute(fromGroup, fromNum, toGroup, toNum);
    return route.found ? route.hops.length : null;
}

/**
 * Nearest location of a given `type` (map-hop distance from `from`, tie-broken
 * by local Manhattan distance when the candidate is on the same map).
 * @param {string} type Registry type tag, e.g. "pokecenter".
 * @param {{group:number,num:number,x?:number,y?:number}} from Current position.
 * @returns {object|null} A locations.json entry, or null if none reachable.
 */
export function nearestLocation(type, from) {
    const { locations } = getLocationRegistry();
    const candidates = locations.filter((l) => l.type === type);
    if (candidates.length === 0) return null;

    let best = null;
    let bestScore = Infinity;
    for (const loc of candidates) {
        const dist = mapDistance(from.group, from.num, loc.group, loc.num);
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
