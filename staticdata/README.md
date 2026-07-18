# Static data pipeline (Workstream A)

Offline-extracted game data for the FireRed agent harness. The goal is to
replace slow, fragile *runtime* RAM reads of map geometry (see
`gamestate/overworld/mapLayouts.js`) with data computed once from the
[pret/pokefirered](https://github.com/pret/pokefirered) decomp.

## A1 — Map data (`frlg/`)

Layouts, per-tile collision + elevation, resolved metatile behaviors, warps, and
connections for every map in the pre-Brock scope (Pallet Town through the Pewter
City gym) — 30 maps: the overworld routes/towns plus their interiors and gates.

### Generating

The decomp is **not** vendored into this repo. Clone it anywhere, then run the
extractor (it defaults to `~/Desktop/pokefirered`):

```bash
git clone --depth 1 https://github.com/pret/pokefirered.git ~/Desktop/pokefirered
node staticdata/extractMapData.js
# or:  POKEFIRERED_PATH=/path/to/pokefirered node staticdata/extractMapData.js
# or:  node staticdata/extractMapData.js --decomp /path/to/pokefirered --out staticdata/frlg
```

### Output

- `frlg/index.json` — registry of extracted maps (id, name, group/num,
  dimensions, warp/connection counts) plus the source commit and grid-format
  notes.
- `frlg/metatile_behaviors.json` — behavior id → name table (e.g.
  `2` → `MB_TALL_GRASS`), extracted from `include/constants/metatile_behaviors.h`.
- `frlg/maps/<MapName>.json` — one file per map.

### Per-map schema

```jsonc
{
  "id": "MAP_PALLET_TOWN",
  "name": "PalletTown",
  "group": 3, "num": 0,          // matches RAM MAP_BANK_ADDR / MAP_NUMBER_ADDR
  "layout_id": "LAYOUT_PALLET_TOWN",
  "width": 24, "height": 20,
  "primary_tileset": "gTileset_General",
  "secondary_tileset": "gTileset_PalletTown",
  "map_type": "MAP_TYPE_TOWN",
  "connections": [               // adjacent overworld maps (edge-scrolling)
    { "direction": "up", "offset": 0, "map": "MAP_ROUTE1", "group": 3, "num": 19 }
  ],
  "warps": [                     // doors/stairs/etc.
    { "x": 6, "y": 7, "elevation": 0,
      "dest_map": "MAP_PALLET_TOWN_PLAYERS_HOUSE_1F",
      "dest_group": 4, "dest_num": 0, "dest_warp_id": 1 }
  ],
  "grid": {                      // all arrays row-major, index = y*width + x
    "metatileIds": [ ... ],      // block & 0x03FF
    "collision":   [ ... ],      // 0 = passable, non-zero = blocked
    "elevation":   [ ... ],      // 0-15 (0 and 15 are special: transition/bridge)
    "behaviorIds": [ ... ]       // resolve names via metatile_behaviors.json
  }
}
```

### How it's decoded (all authoritative, from the decomp)

- **Grid blocks** come from each layout's `map.bin` (`u16` little-endian per
  tile). Bit layout (`include/global.fieldmap.h`):
  metatile id `& 0x03FF`, collision `(v & 0x0C00) >> 10`, elevation
  `(v & 0xF000) >> 12`.
- **Behaviors**: FRLG metatile attributes are `u32` (not `u16` like Emerald);
  the behavior is bits 0-8 (`& 0x1FF`) per `src/fieldmap.c`. Metatile ids
  `< 640` index the primary tileset's `metatile_attributes.bin`, the rest index
  the secondary (`- 640`). The tileset label → `.bin` path mapping is parsed
  from `src/data/tilesets/headers.h` + `metatiles.h` (no name guessing).
- **group/num** come from `data/maps/map_groups.json` and are what the running
  game exposes via `MAP_BANK_ADDR` / `MAP_NUMBER_ADDR`, so static data can be
  looked up directly from live state.

> Note: the current runtime reader (`gamestate/overworld/mapMetatiles.js`) reads
> FRLG metatile attributes as `u16` with an `0x00FF` behavior mask, which
> truncates the 9-bit behavior field. The static extractor here uses the correct
> `u32` / `0x1FF` decode. This is the kind of fragile runtime read A1 is meant to
> replace.

## A2 — Trainers, sightlines, and items (`frlg/events/`)

Trainer positions/facing/sight range/parties, ground items, hidden items, and
scripted (trigger-based) trainer battles for the same 30 pre-Brock maps,
decoded from each map's own `object_events`/`bg_events`/`coord_events` plus
the decomp's script sources and `src/data/trainers.h` /
`src/data/trainer_parties.h`.

### Generating

```bash
node staticdata/extractEvents.js
# or:  POKEFIRERED_PATH=/path/to/pokefirered node staticdata/extractEvents.js
# or:  node staticdata/extractEvents.js --decomp /path/to/pokefirered --out staticdata/frlg
```

Independent of A1's `extractMapData.js` — separate output directory
(`frlg/events/`), so re-running either pipeline never clobbers the other.

### Output

- `frlg/events/index.json` — registry (id, name, group/num, per-category
  counts) plus the source commit.
- `frlg/events/<MapName>.json` — one file per map:
  - `trainers[]` — `x`/`y`/`elevation`, `movement_type` + a resolved `facing`
    (`up`/`down`/`left`/`right`, `null` for wander/alternating types),
    `trainer_type` (`TRAINER_TYPE_NONE`/`NORMAL`/`SEE_ALL_DIRECTIONS`/
    `BURIED`) and `sight_range` (tiles; `null` when `trainer_type` is
    `NONE`), plus the resolved trainer: class, name, held items,
    double-battle flag, and full `party[]` (species, level, IV, held item,
    moves — symbolic decomp names alongside resolved numeric ids, e.g.
    `species`/`species_num`). A handful of trainers resolve to more than one
    `trainerbattle_*` call (branchy scripts); those carry `trainer_battles[]`
    instead of flat fields.
  - `items[]` — ground `OBJ_EVENT_GFX_ITEM_BALL` objects, resolved through
    their `finditem` script to an item (symbolic + numeric id). The three
    Pallet Town starter balls carry `gives_starter` (a species) instead,
    since they run a custom script, not `finditem`.
  - `hidden_items[]` — straight from each map's `bg_events` (type
    `hidden_item`); no script resolution needed, the item/quantity/flag are
    already data.
  - `scripted_encounters[]` — trainer battles reached through a map
    `coord_event` trigger rather than sight/interaction (e.g. the Route 22
    and Oak's Lab rival fights). Each records the trigger tile and one entry
    per reachable `trainerbattle_*`, tagged with the `_if_eq` branch
    conditions (e.g. `VAR_STARTER_MON`) walked to reach it.

### How it's decoded

- **Trainer/item resolution** flattens every map's `scripts.inc` plus the
  shared `data/scripts/*.inc` files into one label → body-text index, then
  does a breadth-first walk of `goto`/`call` (and `_if_eq`/`_if_set`/...
  variants) from an object's/trigger's script label, collecting
  `trainerbattle_*`/`finditem` commands wherever they're actually reached —
  this is what resolves indirection like item balls routing through the
  shared `item_ball_scripts.inc`, or the Route 22 rival trigger chaining
  through `VAR_TEMP_1`/`VAR_STARTER_MON` branches to one of three
  `trainerbattle_earlyrival` calls.
- **Trainer data** (class, name, held items, party) is parsed directly from
  `src/data/trainers.h` (`TRAINER_X = { ... }` blocks) and
  `src/data/trainer_parties.h` (all four `TrainerMon*` struct variants —
  no-item/item × default-moves/custom-moves — read generically by only
  pulling the fields present).
- **Numeric ids** (`species_num`, `item_num`, `trainer_num`, `moves_num`,
  `trainer_class_num`) are resolved from the decomp's own
  `#define NAME value` constants headers (`include/constants/{species,items,
  moves,opponents}.h`, `trainers.h` for `TRAINER_CLASS_*`) — same
  authoritative-decode philosophy as A1's group/num resolution, not guessed.

> *Note:* `sight_range`/`facing` describe the sightline trigger as the decomp
> encodes it (origin tile, direction, tile count); they are not a
> precomputed set of sightline tiles. Casting that ray through a map's A1
> collision grid (a trainer's sightline stops at the first obstacle) is
> downstream work for whichever C-workstream skill consumes this.

## A3 — Location registry + cross-map graph (`frlg/locations.json`, `frlg/mapGraph.json`)

A second pass over A1's output (no decomp access needed) that names every
extracted map and joins them into a routing graph.

### Generating

```bash
node staticdata/extractLocations.js
```

### Output

- `frlg/locations.json` — one entry per map: `name` (humanized, e.g.
  `PewterCity_Gym` -> "Pewter City Gym"), `aliases`, a `type` tag
  (`city`/`route`/`gym`/`mart`/`pokecenter`/`pokecenter_upstairs`/`museum`/
  `school`/`lab`/`gate`/`house`/`building`, from `MAP_TYPE_*` for outdoor maps
  and a name-pattern refinement for indoor ones), and an anchor tile: for
  indoor maps, the landing tile of the first in-scope warp into that map
  (deterministic, real warp-pair data — not guessed); for outdoor maps, the
  nearest passable tile to the map's geometric center.
- `frlg/mapGraph.json` — 30 nodes (the extracted maps) + edges: warp edges
  carry concrete tiles on both ends (`fromTile`/`toTile`, resolved via the
  same warp-pair convention: a warp's `dest_warp_id` indexes the destination
  map's own `warps[]` array), connection edges carry `direction`/`offset`
  only. `boundaryEdges` records real warps/connections whose destination
  falls outside the pre-Brock scope (e.g. Route 1 -> Route 21, Pewter City ->
  Route 3, the Pokémon Center 2F union-room/trade-center warps) instead of
  silently dropping them.

Query layer: [`skills/locationGraph.js`](../skills/locationGraph.js) —
`resolveLocation`/`resolveDestination` (name/alias/"nearest \<type\>"
resolution, backing the `goto` tool's `location` field) and `mapRoute`/
`mapDistance` (BFS over the graph). Self-test:
[`skills/locationGraph.test.js`](../skills/locationGraph.test.js).

> Found: door metatiles (`MB_WARP_DOOR`) read as collision-blocked in A1's
> static grid — the game engine special-cases doors past the normal collision
> check. C1's pathfinder already accounts for this (`stopAdjacent: true` +
> press the returned `facing`); a warp edge's `fromTile` is meant to be routed
> to that way, not stood on directly.

## A4 — Milestone / quest graph (`frlg/milestones.json`)

The pre-Brock story sequence encoded as an ordered list of milestones, each
tagged with the RAM flag(s) that mark it complete — the reward signals E4
(SFT+RL on milestone flags) and the savestate checkpoints D4 needs.

### Generating

```bash
node staticdata/extractMilestones.js
# or:  POKEFIRERED_PATH=/path/to/pokefirered node staticdata/extractMilestones.js
# or:  node staticdata/extractMilestones.js --decomp /path/to/pokefirered --out staticdata/frlg
```

Needs the decomp (reads `include/constants/flags.h` + `include/constants/opponents.h`);
emits one file independent of the other A extractors.

### Output

`frlg/milestones.json` — `{ source, flagBase, milestones[], locationFlags[] }`.

Each milestone: `id`, `order`, `name`, `kind` (`story`/`battle`/`item`/`badge`),
`map`, `description`, `requires[]` (prior milestone ids — the story DAG),
`optional` (the Route 22 rival + its Poké Ball top-up are real beats the path
to Brock can skip), `reward`, and `completion`:

- `completion.mode` — `"all"` (every flag must be set) or `"any"` (any one).
  Starter-dependent battles (both rival fights, Brock) carry the three variant
  trainer-defeat flags under `"any"`; only the one matching the chosen starter
  is ever set, so the milestone is complete if *any* variant is.
- `completion.flags[]` — `{ flag, value }` pairs. `value` is the bit-offset a
  runtime reader passes to `readPlayerFlag` (`byte = floor(v/8)`, `bit = v % 8`).
- `completion.item.resolvesTo` — present for the Oak's Parcel milestone, which
  has no dedicated flag (it's a key item in the bag). Its `resolvesTo` flag
  (`FLAG_SYS_POKEDEX_GET`, set by the parcel-delivery scene) is what tracks it.

The critical path (non-optional): `chose_starter → beat_rival_oaks_lab →
got_oaks_parcel → got_pokedex → defeated_brock → got_boulder_badge`.

`flagBase` records the resolved anchor values (`TRAINER_FLAGS_START = 0x500`,
`SYS_FLAGS = 0x800`, …) so a consumer can sanity-check the math.

`locationFlags[]` — soft "you've reached this area" signals (visited-Oak's-Lab,
town-map unlocks, the Route 1 Potion aide), resolved to bit-offsets like the
rest. Supplementary to the strict story DAG.

### How it's decoded (all authoritative, from the decomp)

- **Flag values** are resolved from `include/constants/flags.h` by evaluating
  the decomp's own `#define` expressions (`SYS_FLAGS + 0x20`,
  `FLAG_0x4FF + 1`, `FLAG_HIDDEN_ITEMS_START + N`, …) with a tiny `+ - * /`
  integer evaluator over already-defined names — so a future flag renumbering
  in the decomp flows through without an edit here. `flags.h` references
  symbols from `opponents.h` (`SYS_FLAGS → TRAINER_FLAGS_END →
  MAX_TRAINERS_COUNT`), so `opponents.h`'s defines are merged in as a fallback.
- **Trainer defeat flags** are `TRAINER_FLAGS_START + trainerId`, where the
  trainer id comes from `include/constants/opponents.h` (`TRAINER_RIVAL_*`,
  `TRAINER_LEADER_BROCK`) — matching the engine's own `FlagSet` for trainers,
  not guessed. (e.g. `TRAINER_LEADER_BROCK = 414 → 0x500 + 0x19E = 0x69E`.)
- **Which flag marks which beat** is read from the relevant map scripts:
  `PalletTown_ProfessorOaksLab` (`FLAG_SYS_POKEMON_GET`,
  `FLAG_BEAT_RIVAL_IN_OAKS_LAB`, `FLAG_SYS_POKEDEX_GET`),
  `ViridianCity_Mart` (parcel scene, gated by `goto_if_unset
  FLAG_SYS_POKEDEX_GET`), `Route22` (trigger-based early rival, no dedicated
  flag → trainer-defeat flag), and `PewterCity_Gym` (`FLAG_DEFEATED_BROCK` +
  `FLAG_BADGE01_GET` set together).

Query layer: [`skills/milestones.js`](../skills/milestones.js) —
`resolveMilestone`, `completionFlags`/`flagBit`/`flagValues`,
`isComplete`, and `currentMilestone` (furthest reached + next critical-path
target + available optional side content, honoring the DAG). Self-test:
[`skills/milestones.test.js`](../skills/milestones.test.js) (57 checks, all
green).

> *Note:* the runtime flag map (`constant/savestate_flag_map_frlg.js`)
> currently only knows the 8 badge flags. Wiring these story flags into the
> runtime `readPlayerFlag` path (so B1's snapshot / E4's reward signal can
> actually read them) is downstream runtime work, not part of this static
> extraction — the bit-offsets here are what that wiring will consume.

## A5 — Walkthrough/wiki corpus (`corpus/`)

Clean text corpus extracted from walkthrough wikis and video transcripts,
scoped to pre-Brock (Pallet Town through Pewter City gym / Boulder Badge).
For LLM finetuning and reference.

### Inputs

- **Bulbapedia**: parts 1–3 of the FireRed/LeafGreen walkthrough (intro, routes/cities up to Pewter).
- **StrategyWiki**: 7 pre-Brock location pages: Pallet Town, Route 1, Viridian City, Route 22, Route 2, Viridian Forest, Pewter City.
- **Video transcripts**: Three gameplay recordings (frame descriptions + optional commentary):
  - `01_100pct_no_commentary`: frame descriptions only.
  - `02_full_game_walkthrough`: frame descriptions only.
  - `03_switch2_gameplay_walkthrough`: frame descriptions + commentary.

### Generating

```bash
node staticdata/scrapeWalkthroughs.js
# or with flags:
node staticdata/scrapeWalkthroughs.js --wiki-only      # fetch wikis only
node staticdata/scrapeWalkthroughs.js --transcripts-only # clean transcripts only
node staticdata/scrapeWalkthroughs.js --out <dir>      # output directory (default: staticdata/corpus)
node staticdata/scrapeWalkthroughs.js --urls <path>    # custom URL JSON path
node staticdata/scrapeWalkthroughs.js --transcripts <dir> # custom transcripts dir
```

### Output layout

```
staticdata/corpus/
  index.json                  # manifest (tracked)
  wiki/                       # (gitignored)
    bulbapedia_part-1.txt
    bulbapedia_part-2.txt
    bulbapedia_part-3.txt
    strategywiki_pallet-town.txt
    strategywiki_route-1.txt
    ... (7 total StrategyWiki pages)
  transcripts/                # (gitignored)
    01_100pct_no_commentary.txt
    02_full_game_walkthrough.txt
    03_switch2_gameplay_walkthrough.txt
```

### Processing steps

1. **Wiki fetch**: MediaWiki API queries with polite 500ms delays. Light text cleanup (CRLF→LF, trailing space trim, blank-line collapse).
2. **Transcript clean**:
   - Parse frame description + commentary lines into timestamped events.
   - Noise filtering: drop frame descriptions matching "the frame is black" or watermark artifacts.
   - Pre-Brock truncation: stop after first event containing "boulderbadge" (case-insensitive, spaces removed).
   - Commentary events (`Transcript (...)`) kept verbatim (no noise filter).
3. **Manifest**: emit index.json with metadata (character counts, fetch timestamps, cut markers).

### Licenses

This corpus is derived from:
- **Bulbapedia**: CC BY-NC-SA 2.5 (https://bulbapedia.bulbagarden.net/)
- **StrategyWiki**: CC BY-SA (https://strategywiki.org/)
- **Video transcripts**: assumed derivative; corpus is regenerable offline.

The generated `corpus/` directory is gitignored (bulk text); only `index.json` is tracked.
