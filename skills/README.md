# Skills / macros (Workstream C)

High-level movement and interaction macros the agent loop (D2) calls behind the
frozen tool interface (D1). Each builds on the static data (A1–A3) and the
runtime state layer (B1–B3).

## C1 — Within-map A\* (`pathfinding.js`)

Grid pathfinding over the A1 static collision data for a **single** map. Returns
the button-press sequence (`up`/`down`/`left`/`right`) that walks the player from
its current tile to a goal tile, or reports that no path exists.

```js
import { getStaticMapById } from "./skills/staticMap.js";
import { findPath, findPathLive } from "./skills/pathfinding.js";

// Pure (offline): route over a known map.
const map = getStaticMapById("MAP_PALLET_TOWN");
const res = findPath(map, { x: 12, y: 1 }, { x: 16, y: 13 }, { stopAdjacent: true });
// -> { found: true, directions: ["down", ...], path: [...], cost, facing }

// Live (emulator): route on the current map, blocking on-screen NPCs.
const live = await findPathLive({ x: 16, y: 13 });
```

Design:

- **Passability** = static `collision === 0`, in bounds, and not a
  `blockedTiles` entry. `blockedTiles` is where dynamic obstacles plug in: B1's
  live NPC positions (`getCurrentMapNpcs`, folded in automatically by
  `findPathLive`) and, once A2 lands, trainer **sightline** tiles. The core is
  agnostic about a blocked tile's origin.
- **Ledges** (`MB_JUMP_*` behaviors) are modelled as valid **one-way** shortcuts:
  stepping into a ledge in its jump direction hops over it (one press, two
  tiles). Ledge tiles are `collision != 0`, so they are never walked *onto* — the
  planner only ever uses the legal jump.
- **`stopAdjacent`** routes to a tile next to the goal (with the `facing`
  direction to press), for interacting with things you can't stand on — warp
  doors, NPCs, signs.
- A blocked **start** tile (e.g. an NPC misread onto the player) never strands
  the search.

`findPath` is pure and deterministic; `pathfinding.test.js` re-simulates every
emitted route against the movement rules and checks it against the checked-in
static data:

```bash
node skills/pathfinding.test.js
```

`staticMap.js` is the cached (group, num) → static-map loader shared by these
skills. C2 (cross-map router) composes `findPath` per map with warp/connection
traversal from A3.
