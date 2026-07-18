# FireRed Agent Harness — Project Plan

Goal: rework this harness so a model plays Pokémon FireRed through the first gym
(Brock) via high-level intent tools (`goto`, `set_battle_strategy`, `heal`, …),
with pathfinding, battles, menus, and dialog handled by the harness. Then use the
finished harness to distill a FreeSolo SLM (SFT + RL).

Scope: everything up to and including the Pewter City gym.

---

## Workstream A — Static data pipeline (offline; no emulator needed)

- **A1. Extract map data from pret/pokefirered** — ✅ **DONE** (branch
  `a1-static-map-data`). `staticdata/extractMapData.js` emits per-tile
  collision/elevation/metatile-behavior grids, warps, and connections for the
  30 pre-Brock maps (Pallet Town → Pewter gym) to `staticdata/frlg/`, keyed by
  map group/num so live state can look them up. Decode is taken from the
  decomp's own field/tileset source (blocks, `u32`/`0x1FF` behaviors, tileset→
  attributes via `headers.h`+`metatiles.h`), not guessed. Decomp cloned to
  `~/Desktop/pokefirered` (not vendored; see `staticdata/README.md`).
    - *Found:* the runtime reader `gamestate/overworld/mapMetatiles.js` decodes
      FRLG behaviors as `u16 & 0x00FF`, truncating the 9-bit field — exactly the
      fragile RAM read this workstream replaces. Not yet fixed.
- **A2. Extract trainers, sightlines, and items** — ✅ **DONE.**
  [`staticdata/extractEvents.js`](staticdata/extractEvents.js) emits
  `staticdata/frlg/events/<MapName>.json` for the same 30 maps: `trainers[]`
  (position, facing, `trainer_type`/`sight_range`, and the resolved trainer —
  class, name, held items, full `party[]` with species/level/IV/moves,
  symbolic decomp names alongside resolved numeric ids), `items[]` (ground
  item balls resolved through their `finditem` script; the 3 Pallet Town
  starter balls carry `gives_starter` instead), `hidden_items[]` (straight
  from `bg_events`), and `scripted_encounters[]` (trigger-based battles like
  the Route 22 / Oak's Lab rival fights, with the `_if_eq` branch conditions
  walked to reach each one). Trainer/item scripts are resolved by flattening
  every map's `scripts.inc` + the shared `data/scripts/*.inc` files into one
  label index and BFS-walking `goto`/`call` indirection from each
  object's/trigger's script — needed since item balls route through a shared
  script file and the rival fights branch through `VAR_STARTER_MON`. Trainer
  class/name/party come from `src/data/trainers.h` +
  `src/data/trainer_parties.h`, parsed generically across all four
  `TrainerMon*` struct variants.
    - *Note:* `sight_range`/`facing` describe the sightline trigger as
      encoded (origin, direction, tile count) — not precomputed sightline
      tiles. Ray-casting that through A1's collision grid (stopping at the
      first obstacle) is downstream work for whichever C-workstream skill
      consumes this, per the plan text below ("A2's trainer sightline tiles
      will plug in unchanged").
- **A3. Location registry + cross-map graph** — ✅ **DONE.** Second pass over
  A1's output (no decomp access needed):
  [`staticdata/extractLocations.js`](staticdata/extractLocations.js) emits
  `staticdata/frlg/locations.json` (one named entry per map — humanized name,
  aliases, a type tag, and an anchor tile: the landing tile of the first
  in-scope warp for indoor maps, nearest-passable-to-center for outdoor ones)
  and `staticdata/frlg/mapGraph.json` (30 nodes, warp edges with concrete
  tiles both ends + connection edges with direction/offset, plus
  `boundaryEdges` for the 9 real edges that leave the pre-Brock scope rather
  than dropping them silently). Query layer:
  [`skills/locationGraph.js`](skills/locationGraph.js) —
  `resolveLocation`/`resolveDestination` (name/alias/"nearest \<type\>",
  backing the `goto` tool's `location` field) and `mapRoute`/`mapDistance`
  (BFS over the graph, unweighted). `skills/locationGraph.test.js` verifies
  every anchor is passable, every warp edge's landing tile is real, the graph
  composes correctly with C1 end-to-end (Pallet Town → Pewter Gym door), and
  the D1 tool-schema example queries resolve (58 checks, all green).
    - *Found:* door metatiles (`MB_WARP_DOOR`) read as collision-blocked in
      A1's static grid — the engine special-cases doors past the normal
      collision check. C1's `stopAdjacent` was already designed around this;
      a warp edge's `fromTile` is meant to be routed to that way (then press
      `facing`), not stood on directly.
    - *Note:* connection edges only carry `direction`/`offset`, not exact
      border tiles — C2 resolves those from both maps' live dimensions at
      execution time.
- **A4. Milestone/quest graph** — the pre-Brock story sequence encoded with the
  RAM flags that mark each step complete (Oak's Parcel, rival fights, badge).
- **A5. Scrape walkthrough/wiki corpus** — ✅ **DONE.**
  `staticdata/scrapeWalkthroughs.js` builds a pre-Brock clean-text corpus in
  `staticdata/corpus/` from two inputs: the MediaWiki-based wikis
  (Bulbapedia parts 1–3 + StrategyWiki's 7 Pallet→Pewter location pages, pulled
  as plaintext via each wiki's `extracts` API) and the saved video transcripts
  (`~/Desktop/pokemon_walkthroughs`, 3 playthroughs). Transcripts are parsed
  into timestamped events (both frame-description and commentary formats,
  including indented `at Xs:` sub-lines), noise-filtered, and truncated at the
  Boulder Badge award. Output is git-ignored/regenerable; the `index.json`
  manifest is tracked. Feeds E1 (wiki QA) and E2 (transcript state→intent).
    - *Note:* wiki fetches shell out to `curl`, not `fetch` — StrategyWiki's WAF
      403s node's TLS fingerprint (both `fetch` and the `https` module); `curl`
      passes.

## Workstream B — Runtime state layer (emulator; no static data needed)

- **B1. Unified `getState()` snapshot** — ✅ **DONE.** One call consolidating
  the existing RAM readers (`gamestate/`) into a structured, serializable
  snapshot: player pos/map/movement/money/badges, party (+ HP aggregates),
  battle state, script/dialog lock, menu state. Pure aggregation (no new memory
  addresses); per-section error isolation so a single bad read can't blank a
  poll; heavy map/bag reads gated behind options for B2's fast poll. Source of
  truth: [`gamestate/getState.js`](gamestate/getState.js); shape + field→
  `STOP_REASON` map in [`docs/state-snapshot.md`](docs/state-snapshot.md).
  B2 polls it, D2 prompts from it, D3 logs it as `state_before`.
- **B2. Interrupt detector** — ✅ **DONE.**
  [`gamestate/interruptDetector.js`](gamestate/interruptDetector.js): pure
  `classifyInterrupt(state, options)` reads B1's snapshot fields against the
  documented field→`STOP_REASON` table (`docs/state-snapshot.md`) — battle
  started, dialog/cutscene/script (`progress.controlsLocked` covers all three
  under one signal, `SCRIPT_LOCK_FIELD_CONTROLS`), warp completed (diffed
  against a caller-supplied baseline map, so callers where a map change is
  expected progress — C2's `goto` — can opt out and never see it), HP below
  threshold, and unexpected menu; falls back to `UNKNOWN_STATE` when the
  player position/map itself can't be read. `watchForInterrupt(options)` wraps
  it in the actual fast polling loop (baseline poll, then re-poll on an
  interval until a stop condition, timeout, or abort). `choice_required`,
  `out_of_pp`, `about_to_faint`, and pathing `blocked` are deliberately left
  to C5/C3/C2 — they need context (a surfaced prompt, battle move data, live
  NPC positions) this detector doesn't have.
  [`gamestate/interruptDetector.test.js`](gamestate/interruptDetector.test.js)
  covers every STOP_REASON, the priority order between them, the
  baseline/expectWarp/expectMenu opt-outs, and the polling loop against a
  fake `pollState` (24 checks, all green). C2's `crossMapRouter.js` (built
  before this landed, using its own inline placeholder) now imports this
  module directly instead.
- **B3. Input executor upgrade** — reliable button queue with frame-accurate
  timing, plus a dialog-advance primitive (mash A/B until controls unlock or a
  choice appears).

## Workstream C — Skills/macros (needs A1–A3 + B1–B3)

- **C1. Within-map A\*** — ✅ **DONE.** Grid A\* over A1 collision data for a
  single map, returning the `up/down/left/right` button sequence to a goal (or
  no-path). Source: [`skills/pathfinding.js`](skills/pathfinding.js) (`findPath`
  pure core + `findPathLive` emulator adapter) over
  [`skills/staticMap.js`](skills/staticMap.js) (cached (group,num)→map loader).
  Passability = static `collision === 0` minus a `blockedTiles` set — where B1's
  live NPC positions fold in (automatic in `findPathLive`) and A2's trainer
  sightline tiles will plug in unchanged. Ledges (`MB_JUMP_*`) are modelled as
  legal one-way jump shortcuts; `stopAdjacent` routes next to interact-only tiles
  (warps/NPCs/signs) and reports the `facing` press; a blocked start tile can't
  strand the search. `skills/pathfinding.test.js` re-simulates every emitted
  route against the movement rules over the checked-in static data (18 checks,
  all green). C2 composes this per map with warp/connection traversal.
- **C2. Cross-map router** — ✅ **DONE.** "goto Pewter City" = A3's map-hop
  graph search + a C1 leg per map + warp/connection traversal. Source:
  [`skills/crossMapRouter.js`](skills/crossMapRouter.js) — `resolveConnectionCrossing`
  (border-tile math for overworld connections, taken from the decomp's own
  `SetPositionFromConnection`/`IsCoordInIncomingConnectingMap`, not guessed:
  vertical connections relate `to.x = from.x - offset`, horizontal ones
  `to.y = from.y - offset`), `planCrossMapRoute` (pure planner, composes a C1
  `findPath` per map), and `gotoLive` (live adapter: re-derives one leg at a
  time from wherever the player actually is, so B1's live NPC positions fold
  in fresh at every map crossed, not just the first; polls B2's
  `classifyInterrupt` after every button press and returns a D1
  `makeOutcome(...)` envelope, so this can back the `goto` tool directly once
  D2 wires it in). `skills/crossMapRouter.test.js` verifies the connection
  math against an independently-written copy of the decomp formula for all 10
  in-scope connection edges (round-trip A→B→A too), and replays a full
  Pallet Town → Viridian City Pokémon Center plan (2 connections + 1 warp)
  leg-by-leg under real movement rules (94 checks, all green).
    - *Found:* the map-hop graph (A3) is unweighted and knows nothing about
      what's actually walkable *inside* a map. When a hop's leg comes back
      no-path, C2 excludes that specific edge and re-runs the BFS
      (`mapRoute`'s new `excludeEdges` param + `edgeKey` in
      [`skills/locationGraph.js`](skills/locationGraph.js)) rather than
      failing the whole plan on a graph-level shortest path that isn't
      actually walkable — this recovers whenever a genuinely different
      map-level route exists.
    - *Found (unresolved):* that recovery can NOT fix the case where the fix
      requires re-entering the SAME map at a different position, because the
      graph has one node per map, not one per connected region within a map.
      Route 2 is the pre-Brock example: rows 42-44 are a fully impassable
      Cut-tree line (no Cut pre-Boulder-Badge) splitting it into a south half
      (borders Viridian City) and a north half (borders Pewter City); the
      real route detours through Viridian Forest's warps, which land back on
      Route 2's north half — the same graph node BFS already marked visited
      via the south half. So **`goto`/C2 cannot currently route Pallet Town →
      Pewter City/Gym** (pinned as an expected-failure test in
      crossMapRouter.test.js so a future fix has to notice and update it).
      Fixing this for real needs A3 to split a map into per-connected-
      component graph nodes (accounting for one-way ledges as directed
      edges) — real work, deferred; every other pre-Brock map was scanned and
      Route 2 is the only one whose split actually sits on a needed route.
- **C3. Battle policy engine** — rule-based, parameterized by a strategy the
  model sets; escalates to the model on no-PP / about-to-faint / unknown state.
- **C4. Menu macros** — heal at Pokécenter, use item, reorder party, handle
  move-learn prompts.
- **C5. Dialog handler** — advance text; surface yes/no choices to the model or
  apply a default policy.

## Workstream D — Agent framework

- **D1. Freeze the tool interface** — ✅ **DONE (v1.0.0).** `goto`,
  `set_battle_strategy`, `heal`, `use_item`, `press` (escape hatch), constrained
  args + `max_steps` budget, and a single outcome envelope whose `stop_reason`
  enum is shared with B2. Source of truth:
  [`llminteract/toolInterface.js`](llminteract/toolInterface.js) (schemas +
  `toOpenAITools()`/`TOOLS_BY_NAME` for D2, `makeOutcome`/`STOP_REASON` for D3);
  prose spec + change policy in [`docs/tool-interface.md`](docs/tool-interface.md).
  Frozen — C implements against it, D3 logs in its shape, E3 traces depend on it.
- **D2. Rewire the agent loop** — event-driven (model called only on macro
  completion or interrupt), drop the Cerebras vision call, pure-text state
  prompt.
- **D3. Trace logging** — every model call recorded as
  (state, tool call, outcome) in exactly the format E3 will consume.
- **D4. Eval harness** — savestate checkpoints at each milestone, timed
  run-to-Brock benchmark, so harness and model changes are measurable.

## Workstream E — Finetuning (after D2 is stable)

- **E1. QA pairs from wiki corpus** (slim) — needs A5.
- **E2. State→intent pairs from walkthroughs** — needs A5 + D1; can start
  before the harness works.
- **E3. Distillation trace collection** — big-model runs on the finished
  harness, branched from savestates for coverage.
- **E4. SFT + RL on FreeSolo** — using milestone flags from A4/D4 as reward
  signals.

---

## Parallel lanes

These four can run simultaneously from the start:

| Lane | Tasks | Needs |
|------|-------|-------|
| 1 | A1 → A2 → A3 → A4 | decomp repo only |
| 2 | B1 → B2 → B3 | emulator only |
| 3 | D1 (interface spec), then D3/D4 scaffolding | nothing / lane 2 |
| 4 | A5 → E1/E2 | wiki URLs only |

**C is the merge point**: C1→C2 (needs lanes 1+2), with C3, C4, C5 parallel to
the pathfinding pair and to each other. D2 lands last, wiring C's skills behind
D1's interface. E3/E4 are strictly after that.

**Critical path:** A1 → C1 → C2 → D2 → D4 → E3 → E4.

The walkthrough/wiki lane and SFT data prep (E1/E2) are off the critical path —
good candidates for background scripts while the harness is being built.

## Sequencing warning

It's tempting to start C1 before A1 is done by reading collision from RAM (the
current code does this). Fine for prototyping the algorithm, but commit to the
static-data version — runtime RAM reads of map geometry are the slow, fragile
thing being eliminated.
