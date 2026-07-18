// =============================================================================
// A3 location registry + cross-map graph self-test (offline, checked-in data)
// =============================================================================
//
//   node skills/locationGraph.test.js
//
// Verifies: every location anchor is on the map it claims and is passable;
// the map graph's edges are internally consistent with the maps they connect;
// name/alias/nearest resolution returns sane results; BFS map routes are
// actually walkable (each hop's edge really does join the two maps claimed).
// =============================================================================

import { getStaticMap } from "./staticMap.js";
import {
    getLocationRegistry,
    getMapGraph,
    resolveLocation,
    resolveTag,
    resolveDestination,
    mapRoute,
    mapDistance,
    nearestLocation,
} from "./locationGraph.js";

let passed = 0;
let failed = 0;
function check(name, cond, detail = "") {
    if (cond) {
        passed++;
        console.log(`  ok   ${name}`);
    } else {
        failed++;
        console.error(`  FAIL ${name} ${detail}`);
    }
}

// --- 1. Every location anchor is in-bounds and passable on its own map -----
{
    const { locations } = getLocationRegistry();
    check("locations: 30 entries", locations.length === 30, `got ${locations.length}`);
    for (const loc of locations) {
        const map = getStaticMap(loc.group, loc.num);
        const ok = !!map && loc.x >= 0 && loc.y >= 0 && loc.x < map.width && loc.y < map.height && map.grid.collision[loc.y * map.width + loc.x] === 0;
        check(`anchor passable: ${loc.name}`, ok, JSON.stringify(loc));
    }
}

// --- 2. Graph nodes match the location registry's map set ------------------
{
    const graph = getMapGraph();
    const { locations } = getLocationRegistry();
    check("graph: 30 nodes", graph.nodes.length === 30, `got ${graph.nodes.length}`);
    const nodeKeys = new Set(graph.nodes.map((n) => `${n.group}:${n.num}`));
    const locKeys = new Set(locations.map((l) => `${l.group}:${l.num}`));
    check("graph nodes == location maps", nodeKeys.size === locKeys.size && [...nodeKeys].every((k) => locKeys.has(k)));
}

// --- 3. Every warp edge's toTile is actually a warp landing on the dest map -
{
    const graph = getMapGraph();
    let allOk = true;
    for (const edge of graph.edges) {
        if (edge.kind !== "warp") continue;
        const destMap = getStaticMap(edge.to.group, edge.to.num);
        if (!destMap || !edge.toTile) {
            allOk = false;
            continue;
        }
        const onWarp = destMap.warps.some((w) => w.x === edge.toTile.x && w.y === edge.toTile.y);
        if (!onWarp) allOk = false;
    }
    check("warp edges: toTile lands on a real warp in dest map", allOk);
}

// --- 4. Connection edges are symmetric (A->B implies B->A, opposite dir) ---
{
    const graph = getMapGraph();
    const opposite = { up: "down", down: "up", left: "right", right: "left" };
    let allOk = true;
    for (const edge of graph.edges) {
        if (edge.kind !== "connection") continue;
        const back = graph.edges.some(
            (e) =>
                e.kind === "connection" &&
                e.from.group === edge.to.group &&
                e.from.num === edge.to.num &&
                e.to.group === edge.from.group &&
                e.to.num === edge.from.num &&
                e.direction === opposite[edge.direction]
        );
        if (!back) allOk = false;
    }
    check("connection edges: symmetric", allOk);
}

// --- 5. Name resolution matches the examples from the D1 tool schema -------
{
    const cases = [
        ["Pewter City", "MAP_PEWTER_CITY"],
        ["pewter city", "MAP_PEWTER_CITY"],
        ["Pewter Gym", "MAP_PEWTER_CITY_GYM"],
        ["Viridian Mart", "MAP_VIRIDIAN_CITY_MART"],
        ["Pallet Town", "MAP_PALLET_TOWN"],
    ];
    for (const [query, id] of cases) {
        const res = resolveLocation(query);
        check(`resolveLocation("${query}")`, res && res.id === id, JSON.stringify(res));
    }
    check("resolveLocation: unknown -> null", resolveLocation("Cinnabar Island") === null);
}

// --- 6. Tag + nearest resolution --------------------------------------------
{
    check('resolveTag("Pokecenter")', resolveTag("Pokecenter") === "pokecenter");
    check('resolveTag("pokemon center")', resolveTag("pokemon center") === "pokecenter");
    check('resolveTag("gibberish")', resolveTag("gibberish") === null);

    const pallet = { group: 3, num: 0 };
    const nearest = nearestLocation("pokecenter", pallet);
    check("nearestLocation(pokecenter) from Pallet Town found", !!nearest, JSON.stringify(nearest));
    if (nearest) {
        check("nearest pokecenter really is one", nearest.type === "pokecenter");
        const dist = mapDistance(pallet.group, pallet.num, nearest.group, nearest.num);
        check("nearest pokecenter is reachable", typeof dist === "number" && dist >= 0);
    }

    const viaGoto = resolveDestination("nearest Pokecenter", pallet);
    check("resolveDestination('nearest Pokecenter') == nearestLocation", viaGoto && nearest && viaGoto.id === nearest.id);

    const plain = resolveDestination("Pewter Gym", pallet);
    check("resolveDestination(plain name) == resolveLocation", plain && plain.id === "MAP_PEWTER_CITY_GYM");
}

// --- 7. mapRoute produces a walkable chain of edges -------------------------
{
    const pallet = { group: 3, num: 0 };
    const pewterGym = resolveLocation("Pewter Gym");
    const route = mapRoute(pallet.group, pallet.num, pewterGym.group, pewterGym.num);
    check("mapRoute: Pallet Town -> Pewter Gym found", route.found, JSON.stringify(route));
    if (route.found) {
        check("mapRoute: nonzero hops", route.hops.length > 0);
        check("mapRoute: reasonably short", route.hops.length <= 12, `${route.hops.length} hops`);
        // Replay the hop chain: each edge's `from` must be the map the previous
        // edge's `to` landed on, starting at Pallet Town and ending at the gym.
        let cur = { group: pallet.group, num: pallet.num };
        let ok = true;
        for (const edge of route.hops) {
            if (edge.from.group !== cur.group || edge.from.num !== cur.num) ok = false;
            cur = edge.to;
        }
        check("mapRoute: hop chain is contiguous", ok);
        check("mapRoute: chain ends at goal", cur.group === pewterGym.group && cur.num === pewterGym.num);
    }
}

// --- 8. Same-map route is trivially empty; self-distance is zero -----------
{
    const route = mapRoute(3, 0, 3, 0);
    check("mapRoute: same map -> found, 0 hops", route.found && route.hops.length === 0);
    check("mapDistance: same map -> 0", mapDistance(3, 0, 3, 0) === 0);
}

// --- 9. Boundary edges are recorded, not silently dropped -------------------
{
    const graph = getMapGraph();
    check("boundaryEdges: present", Array.isArray(graph.boundaryEdges) && graph.boundaryEdges.length > 0, `got ${graph.boundaryEdges?.length}`);
    const palletBoundary = graph.boundaryEdges.some((e) => e.from.group === 3 && e.from.num === 0);
    check("boundaryEdges: Pallet Town's south connection recorded", palletBoundary);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
