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
