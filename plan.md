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
  and `staticdata/frlg/mapGraph.json` (one node per connected COMPONENT of each
  map — see the resolved Route 2 note in C2; warp edges with concrete tiles
  both ends + connection edges with direction/offset, every edge carrying
  `from.component`/`to.component`, plus `boundaryEdges` for the 9 real edges
  that leave the pre-Brock scope rather than dropping them silently) and
  `staticdata/frlg/components.json` (a per-tile connected-component label grid
  per map, undirected 4-connectivity over passable tiles, so the runtime can
  resolve a tile's component by O(1) lookup instead of flood-filling). Query
  layer: [`skills/locationGraph.js`](skills/locationGraph.js) —
  `resolveLocation`/`resolveDestination` (name/alias/"nearest \<type\>",
  backing the `goto` tool's `location` field) and `mapRoute`/`mapDistance`
  (BFS over the per-component graph, unweighted; multi-source when a caller
  has a map but no tile). `skills/locationGraph.js` `componentOf` (backed by
  components.json) and [`skills/staticMap.js`](skills/staticMap.js) turn a live
  tile into a component index. `skills/locationGraph.test.js` verifies every
  anchor is passable, every warp edge's landing tile is real, the graph
  composes correctly with C1 end-to-end (Pallet Town → Pewter Gym door), and
  the D1 tool-schema example queries resolve (64 checks, all green).
    - *Found:* door metatiles (`MB_WARP_DOOR`) read as collision-blocked in
      A1's static grid — the engine special-cases doors past the normal
      collision check. C1's `stopAdjacent` was already designed around this;
      a warp edge's `fromTile` is meant to be routed to that way (then press
      `facing`), not stood on directly.
    - *Note:* connection edges only carry `direction`/`offset`, not exact
      border tiles — C2 resolves those from both maps' live dimensions at
      execution time.
- **A4. Milestone/quest graph** — ✅ **DONE.**
  [`staticdata/extractMilestones.js`](staticdata/extractMilestones.js) emits
  `staticdata/frlg/milestones.json`: the pre-Brock story sequence as an
  ordered DAG of 8 milestones (chose starter → rival-in-lab → Oak's Parcel →
  Pokédex → Route 22 rival [optional] → Poké Ball top-up [optional] → Brock →
  Boulder Badge), each tagged with the RAM flag(s) that mark it complete.
  Flag bit-offsets are resolved authoritatively from the decomp's own
  `include/constants/flags.h` by evaluating its `#define` expressions
  (`SYS_FLAGS + 0x20`, `FLAG_0x4FF + 1`, …) with a small `+ - * /` evaluator
  over already-defined names (opponents.h defines merged in as a fallback so
  `SYS_FLAGS → TRAINER_FLAGS_END → MAX_TRAINERS_COUNT` resolves); trainer
  defeat flags are `TRAINER_FLAGS_START (0x500) + trainerId` from
  `opponents.h`, matching the engine's `FlagSet`. Starter-dependent battles
  (both rival fights, Brock) carry all three variant trainer-defeat flags
  under `completion.mode: "any"` — only the variant matching the chosen
  starter is ever set; the milestone is complete if *any* is. The Oak's
  Parcel milestone has no dedicated flag (it's a key item in the bag); its
  `completion.item.resolvesTo` points at `FLAG_SYS_POKEDEX_GET`, the flag the
  parcel-delivery scene sets, so the DAG can still advance past it. Which flag
  marks which beat is read from the actual map scripts (Oak's Lab, Viridian
  Mart parcel scene, Route 22 trigger rival, Pewter Gym victory).
  Query layer: [`skills/milestones.js`](skills/milestones.js) —
  `resolveMilestone`, `flagBit`/`completionFlags`, `isComplete`, and
  `currentMilestone` (furthest reached + next critical-path target +
  available optional side content, honoring the `requires` DAG; optional
  milestones never gate a later required one). Self-test
  [`skills/milestones.test.js`](skills/milestones.test.js) verifies the
  resolved flag values (badge=0x820, Pokédex=0x829, Brock trainer-defeat=
  0x69E), the ordering/critical path, the any-of alternates, and the DAG
  walk incl. optional-skip (57 checks, all green). Feeds E4 (milestone flags
  as RL reward) and D4 (savestate checkpoint per milestone).
    - *Note:* the runtime flag map
      (`constant/savestate_flag_map_frlg.js`) currently only knows the 8
      badge flags. Wiring these story flags into the runtime `readPlayerFlag`
      path is downstream B-work, not this static extraction — the bit-offsets
      here are what that wiring will consume.
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
- **B3. Input executor upgrade** — ✅ **DONE.**
  [`tools/inputExecutor.js`](tools/inputExecutor.js) is now the single low-level
  input path: `executeQueue` runs a button sequence through one module-level
  promise chain (so a concurrent `goto` leg and a dialog-advance can never
  interleave their presses on the socket), validates against the closed button
  enum, retries transient network errors (ECONNREFUSED / 5xx) with backoff, and
  gates every press on the emulator's OWN frame counter (`/core/currentFrame`)
  instead of a wall-clock `setTimeout(500)` — that 500ms sleep was ~30 frames
  between taps, slow AND decoupled from what the game is doing. A wall-clock cap
  keeps a paused/frozen emulator from hanging the queue. `advanceDialog` is the
  dialog-advance primitive: mashes A (optionally alternating with B) until the
  overworld controls unlock or a choice/interrupt surfaces, polling B1's
  `getState` + B2's `classifyInterrupt` and speaking the same `STOP_REASON`
  vocabulary (unlock → `NONE`; battle/menu/HP mid-mash → that reason verbatim;
  still locked after `maxPresses` → `CHOICE_REQUIRED`, the runtime-layer
  detection B2 deliberately leaves to C5). `awaitFrames` (tap settle / hold
  confirm) and the transport are injectable, so
  [`tools/inputExecutor.test.js`](tools/inputExecutor.test.js) exercises it
  offline with a fake `io`/`pollState`: validation, tap-vs-hold dispatch,
  onStep abort, `AbortSignal`, concurrent-queue serialization, the
  unreadable-frame-counter fallback, and every `advanceDialog` stop branch
  (41 checks, all green). The legacy [`tools/buttonPress.js`](tools/buttonPress.js)
  / [`tools/buttonHold.js`](tools/buttonHold.js) are now thin facades over the
  executor (same signatures) so the agent loop and C2's `gotoLive` get
  frame-accurate + reliable timing transparently; the stale `/hold?key=` query
  is corrected to `/hold?button=&duration=` per the current mGBA-http ButtonApi.
    - *Note:* mGBA-http's README is explicit that it is not built for
      frame-PERFECT (sub-frame / TAS) manipulation — there is network latency
      on every call. "Frame-accurate" here means "paced to whole emulator
      frames," which is what an AI/Twitch-plays harness needs; it is not a
      claim of sub-frame determinism. Live end-to-end pacing against a running
      emulator is deferred to D2's rewired loop.

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
    - *Found (resolved):* the `excludeEdges` recovery above can NOT by itself
      fix the case where the fix requires re-entering the SAME map at a different
      position, because the graph had one node per map, not one per connected
      region within a map. Route 2 is the pre-Brock example: rows 42-44 are a
      fully impassable Cut-tree line (no Cut pre-Boulder-Badge) splitting it
      into a south half (borders Viridian City) and a north half (borders Pewter
      City); the route to Pewter leaves the south half and re-enters the same
      map at the north half — the same graph node BFS already marked visited.
      **Resolved** by A3 splitting each map into per-connected-component graph
      nodes (undirected 4-connectivity of passable tiles — C1's ledge model is
      reversible, so that's exactly C1's reachability; no directed-SCC needed):
      [`staticdata/extractLocations.js`](staticdata/extractLocations.js) emits
      one node per component, every warp/connection edge carries
      `from.component`/`to.component`, and a per-tile label grid lands in
      [`staticdata/frlg/components.json`](staticdata/frlg/components.json).
      [`skills/locationGraph.js`](skills/locationGraph.js) `mapRoute` then keys
      on `(map, component)` (multi-source when a caller has a map but no tile),
      and [`skills/staticMap.js`](skills/staticMap.js) `componentOf` turns a
      live player/goal tile into that index. C2's `planCrossMapRoute`/
      `gotoLive` resolve `componentOf(start)`/`componentOf(goal)` and pass them
      in, so the BFS re-enters Route 2's north as a distinct unvisited node —
      `goto` now routes Pallet Town → Pewter City/Gym (shortest path: Route 2
      south → Route 2 East Building through-gatehouse → Route 2 north → Pewter;
      Viridian Forest's warps are the fallback when that edge is excluded).
      `resolveConnectionCrossing` gained an optional component filter so a
      multi-component border (Route 22 → Viridian City touches three small
      regions) picks a tile in the traveller's component instead of wrongly
      excluding a valid edge. The expected-failure test in
      crossMapRouter.test.js is flipped to assert the plan is found, re-enters
      Route 2 at ≥2 components, and replays legally under movement rules.
      Scanning every pre-Brock map, only Route 2's split sits on a needed route;
      Pewter Museum 1F (ticket gate) and a few Poké Center 2F floors also split
      and are handled by the same per-component nodes.
- **C3. Battle policy engine** — ✅ **DONE.** Rule-based, strategy-parameterized
  decision-maker behind D1's `set_battle_strategy` (the tool only updates the
  standing policy; this is what consumes it each battle turn).
  [`skills/battleData.js`](skills/battleData.js) is the cached loader over two
  static tables extracted from the decomp:
  [`staticdata/extractBattleData.js`](staticdata/extractBattleData.js) emits
  `staticdata/frlg/move_data.json` (per-move power/type/accuracy/pp/category/
  effect/priority/target/flags, parsed from `src/data/battle_moves.h` +
  `include/constants/{moves,pokemon,battle_move_effects}.h` + `include/battle.h`;
  `category` is derived from type per the Gen-3 rule, not read) and
  `staticdata/frlg/type_chart.json` (the `gTypeEffectiveness[336]` triplets from
  `src/battle_main.c`, normalized to 0/0.5/1/2 via the `TYPE_MUL_*` constants in
  `include/battle_main.h`; only non-1.0 matchups listed, engine default ×1).
  `getMoveByName`/`typeMultiplier` (single + combined two-type product) are the
  query surface; move names are emitted in the runtime `EMBER` form (not
  `MOVE_EMBER`) so they join B1's party-snapshot move names directly.
  [`skills/battlePolicy.js`](skills/battlePolicy.js) is the engine:
  pure `decideAction(battleState, policy, options)` scores the lead's usable
  damaging moves per the six `BATTLE_STRATEGY` presets — `default` (highest
  effective damage, switch on faint), `highest_damage` (raw power, type-blind
  tie-break to effective), `type_effective` (power × type-multiplier × 1.5 STAB),
  `conserve_pp` (favor high-remaining-PP / STAB, avoid burning rare PP),
  `level_grind` (stay in for XP, never switch), `flee` (wild only; trainer falls
  back to `default`) — plus `catch_wild` (chip with the weakest effective move;
  the ball throw is `use_item`'s job). It escalates exactly on `out_of_pp` (no
  damaging move with PP left), `about_to_faint` (lead ≤ HP threshold with no
  healthier switch available — when one exists it returns a `switch` action
  instead), and `unknown_state` (not in battle / lead unreadable), and honors
  `set_battle_strategy`'s `lead` arg (switch to the requested battler when
  possible). `runBattleLive` is the live adapter: polls B1's `getState`, asks
  `decideAction`, executes the chosen move's fight-menu sequence through B3's
  `executeQueue` (and a `flee`/`switch` branch), and returns a D1
  `makeOutcome(...)` envelope — escalating verbatim when the policy says to.
  [`skills/battlePolicy.test.js`](skills/battlePolicy.test.js) covers each
  strategy's move choice, the type/STAB scoring math, PP conservation,
  `catch_wild`, the `lead` preference, every escalation path, and the live
  adapter's outcome contract + escalation paths with an injected fake transport
  (33 checks, all green).
    - *Found (unresolved):* `runBattleLive` has two runtime gaps vs. a fully-
      equipped battle engine, both deferred B-work (the plan's C3 only needs
      A1–A3 + B1–B3; neither reader is part of B1's snapshot). (1) **Enemy-side
      data** (opponent species/types/HP) isn't readable from B1's snapshot, so
      `enemy` is passed as `null` and the policy degrades to raw-power / highest-
      damage scoring (its documented behavior when enemy types are unknown) —
      `type_effective` won't actually exploit live matchups until an opponent-
      struct RAM read lands. (2) **Battle-menu cursor** position isn't readable;
      move selection assumes the cursor opens on slot 0 and presses `down` N
      times — Gen-3 remembers the last-used move's position so the count can be
      off by the distance from that slot; a wrong count still selects a valid
      move (never a dead press) and B2 surfaces any resulting state next poll.
      Making either exact is downstream B-work; the `switch` action is surfaced
      to the model as `choice_required` until C4's party-menu macros land (party
      menu is C4's domain, not this engine's).

- **C4. Menu macros** — ✅ **DONE.** The four menu interactions behind D1's
  tools, in [`skills/menuMacros.js`](skills/menuMacros.js): heal at a
  Pokécenter, use an item, reorder the party, handle move-learn prompts. Same
  two-layer split as C1/C2/C3 — pure sequence builders + bag/party-state
  resolvers (`resolveBagItem`, `buildBagNavigationSequence`,
  `buildStartMenuToBagSequence`, `buildMoveLearnAcceptSequence`/`…Decline`,
  `partySlotDirection`) exercised offline, and live adapters that poll B1's
  `getState`, drive B3's `executeQueue`/`advanceDialog`, poll B2's
  `classifyInterrupt`, and return D1 `makeOutcome(...)` envelopes. Live
  adapters: `selectPartySlotLive` (party-menu cursor nav),
  `useItemLive` (`use_item`), `healAtPokecenterLive` + `healWithItemsLive` +
  `healLive` (`heal`, method-dispatched), `reorderPartyLive`,
  `handleMoveLearnPromptLive`. [`skills/menuMacros.test.js`](skills/menuMacros.test.js)
  covers the pure helpers, the reliable party-slot navigation (down/up/wrap via
  re-reading the slot id, menu-closed precondition, battle-mid-nav interrupt),
  `useItemLive`'s outcome contract + every precondition (item not in bag,
  in-battle, controls-locked, missing item, over-quantity, mid-use battle
  interrupt, with/without `target_slot`), the nurse-heal path (leg1/leg2
  `gotoLive` propagation, unknown-layout precondition, talk+dialog-mash happy
  path, dialog-never-engaged, advanceDialog-interrupted), `healWithItemsLive`
  (items-applied→ok, out-of-items→choice_required), `healLive` method dispatch
  (pokecenter/items/auto: healthy no-op, items-when-sufficient, pokecenter-else),
  reorder happy path + arg guards, and both move-learn decisions (decline default,
  accept+replaceSlot) (80 checks, all green).
    - *Reliable paths:* the **party-menu cursor** is readable from B1's snapshot
      (`menu.partyMenuSlot` via `getPartyMenuSlotId`), so `selectPartySlotLive`
      navigates to a target slot by re-reading the slot id after every up/down
      press — exact, no guessing, wrap-around handled. The **Pokécenter nurse
      heal** sidesteps the menu-cursor gaps entirely: every in-scope center uses
      FRLG's standard layout (verified against the decomp's `map.json`
      `object_events` + A1's collision/behavior grid for both pre-Brock centers
      — Viridian 5:4, Pewter 6:5 — nurse at (7,2) facing down behind an
      `MB_COUNTER` tile at (7,3), so the player talks across the counter by
      standing on the walkable tile (7,4) facing up), and the heal itself is a
      dialog B3's `advanceDialog` mashes through (the YES/NO "heal your
      Pokémon?" prompt defaults to YES, so mashing A confirms and advances).
      `POKECENTER_NURSE_INTERACT` keys the nurse-interact tile by `group:num`;
      an unknown center surfaces as `precondition_failed` rather than a guessed
      tile. `heal method=auto` prefers items when the bag has sufficient
      HP/status items for the injured party, else the (reliable) pokecenter.
    - *Found (unresolved):* the **start-menu and bag cursors** are NOT readable
      from B1's snapshot (no RAM read exists for them), so navigating to the
      BAG entry, a specific bag pocket, or a specific item slot assumes a known
      cursor start and presses a counted up/down — the SAME class of gap as
      C3's battle-move cursor (see `battlePolicy.js`'s docstring). A wrong
      count still presses SOME valid entry (never a dead press) and B2 surfaces
      odd state next poll; the live adapters are tested offline against the
      pure sequence logic + outcome contract, exactly as C3 is. Making either
      exact is downstream B-work (a bag/start-menu cursor RAM read, alongside
      the enemy-side and battle-menu-cursor reads C3 already defers), NOT this
      workstream. `heal method=pokecenter` is the reliable full-heal; items
      inherit the bag-cursor gap.
    - *Note:* move-learn prompts are not a model tool (D1 keeps the action
      space small); `handleMoveLearnPromptLive` is invoked from the agent loop
      when a level-up dialog is detected and defaults to **decline** (press B →
      "No") — the harness never overwrites a move the model might want without
      the model asking, since the move-forget cursor's start position is
      unreadable (same gap). `accept`+`replaceSlot` is available for a future
      policy.
- **C5. Dialog handler** — ✅ **DONE.** Advances in-game text/cutscene/script
  dialog and resolves yes/no prompts, surfacing a `choice_required` interrupt to
  the model only when it can't blast through on its own — the implementation
  behind docs/tool-interface.md's "no `talk`/`interact` tool" rule (advancing
  dialog happens automatically inside a macro and surfaces as
  `choice_required`, never as a separate tool). Source:
  [`skills/dialogHandler.js`](skills/dialogHandler.js) — pure
  `decideDialogAction(state, policy, context)` core (delegates the interrupt
  *priority* — battle > dialog > warp > hp > menu > unknown — to B2's
  `classifyInterrupt` so the stop vocabulary stays unified; C5 only owns the
  dialog-specific layer: which button to mash, and the budget-exhausted →
  `choice_required` escalation B2 deliberately leaves to this handler) +
  `advanceDialogLive(policy, options)` live adapter (polls B1's `getState`,
  asks the core, executes the returned tap through B3's `executeQueue`, returns
  a D1 `makeOutcome(...)` envelope — escalating verbatim on battle/menu/hp/
  unknown mid-mash, or `choice_required` when the step budget runs out before
  the dialog clears). Standing dialog policy `choice: yes | no | ask`:
  `ask` (default) mashes A and surfaces when stuck; `yes` mashes A (Gen-3
  yes/no cursor opens on YES, so A confirms and clears); `no` mashes B (B
  cancels = NO on a yes/no box and also advances plain text, so the loop never
  stalls waiting for A). Self-test
  [`skills/dialogHandler.test.js`](skills/dialogHandler.test.js) covers every
  core branch (done/press/escalate per STOP_REASON, the per-policy button, the
  budget-headroom boundary, locked-trumps-concurrent-low-HP priority) and the
  live adapter's outcome contract (OK-clear, `choice_required` on a stuck
  prompt after the full budget, battle/hp escalation mid-mash, 0-press
  early-surface when already interrupted at start, `no` policy → B, AbortSignal)
  with an injected `FakeIo` + scripted `pollState` (39 checks, all green).
    - *Found (unresolved):* B1's snapshot carries no yes/no-prompt field — the
      deprecated `gamestate/menustate/partyMenu.js` reader is the closest thing
      and is documented as unreliable (its internal pointer isn't cleared on
      close). So this handler CANNOT pre-detect a yes/no box and stop *before*
      answering it: it only detects "controls still locked after the step
      budget" → `choice_required`. Under `ask`/`yes` the budget-mash will have
      confirmed YES on any yes/no box encountered (A = default-YES); under `no`
      it will have answered NO (B = cancel). Making `ask` truly surface a yes/no
      *before* answering needs a yes/no-prompt RAM read, which is downstream
      B-work (the plan's C5 only needs A1–A3 + B1–B3; no such reader is in B1's
      snapshot). The pure core + envelope contract are fully exercised offline
      regardless.
    - *Note:* ✅ **WIRED.** `advanceDialogLive` is now the C5 consumer inside
      `gotoLive`: on a `dialog` interrupt from B2 mid-route, `gotoLive` calls
      `advanceDialogLive` to auto-clear it and re-derives the next leg from
      wherever the player landed (the same way a warp re-derives) — surfacing
      to the model only when C5 escalates (`choice_required`/other). The same
      handoff drives `battle_started` interrupts through C3's `runBattleLive`
      (consuming the standing `battlePolicy` the dispatcher passes in from
      `set_battle_strategy`). The injection seams (`pollState`/`readCurrent`/
      `press`/`getNpcs`/`advanceDialog`/`runBattle`) added to `gotoLive` make
      the handoff testable offline; `crossMapRouter.test.js` grew a 29-check
      `gotoLive` wiring suite (dialog clear/escalate, battle fight/escalate,
      non-auto-clearable `hp_low` surfacing verbatim, start-of-call battle, and
      a plain-route regression) on top of C2's existing 94.

## Workstream D — Agent framework

- **D1. Freeze the tool interface** — ✅ **DONE (v1.0.0).** `goto`,
  `set_battle_strategy`, `heal`, `use_item`, `press` (escape hatch), constrained
  args + `max_steps` budget, and a single outcome envelope whose `stop_reason`
  enum is shared with B2. Source of truth:
  [`llminteract/toolInterface.js`](llminteract/toolInterface.js) (schemas +
  `toOpenAITools()`/`TOOLS_BY_NAME` for D2, `makeOutcome`/`STOP_REASON` for D3);
  prose spec + change policy in [`docs/tool-interface.md`](docs/tool-interface.md).
  Frozen — C implements against it, D3 logs in its shape, E3 traces depend on it.
- **D2. Rewire the agent loop** — ✅ **DONE.** [`agent.js`](agent.js) is now
  event-driven: the model is called only on a macro boundary (after a tool
  returns its outcome envelope), never on a fixed timer. Each iteration
  snapshots via B1's `getState()`, renders that snapshot to pure text via the
  new [`llminteract/buildStatePrompt.js`](llminteract/buildStatePrompt.js),
  calls OpenRouter with D1's frozen tools (`toOpenAITools()`), parses the native
  `tool_calls[0]` the SDK returns (the pre-D2 JSON `functionCall` blob is gone),
  dispatches `{name, args}` via the new
  [`llminteract/toolDispatcher.js`](llminteract/toolDispatcher.js), and feeds
  the outcome back as a `tool` message the model reads next turn. The Cerebras
  vision call is **dropped entirely** — no `describeScreenshot`, no
  `getGameImagesBase64`/`parseDataURI`, no `CEREBRAS_API_KEY`; the model reads
  ONLY the text state prompt (RAM location/flags/party/bag + the on-screen
  collision grid, warps, NPCs). The dispatcher wires the tools whose
  implementations have landed (per the critical path): `goto` → C2's `gotoLive`
  (which now auto-drives the interrupts the harness owns — a `dialog` interrupt
  is cleared by C5's `advanceDialogLive`, a `battle_started` interrupt is fought
  by C3's `runBattleLive` consuming the standing policy; only escalations
  `choice_required`/`out_of_pp`/… surface to the model), `press` → B3's
  `executeQueue` polled for interrupts per press, `set_battle_strategy` →
  records the standing policy in memory (read by `gotoLive` via
  `getBattlePolicy()` when a battle interrupts, so the policy set here is what
  C3 consumes each fight). `heal` → C4's `healLive`,
  `use_item` → C4's `useItemLive` (both wired once C4 landed; see C4). `press`'s interrupt policy
  is deliberately narrower than `goto`'s: because the model is manually driving
  the escape hatch, a dialog/script lock or open menu is *expected*, not an
  interrupt — it only stops early on battle-start / warp / hp-low (pressing A
  through dialog is the whole point). `CONFIGS.js` was rewritten to match: the
  main prompt reframed around the five high-level tools + the event-driven
  model, the RAM-data prompt dropped all screenshot-description references, the
  JSON output-format section was replaced with a tool-calling contract (no
  `response_format` — incompatible with tools on most providers), and the
  Cerebras vision prompt/model were removed. History save/load was relaxed to
  accept OpenAI tool-call message shapes (an assistant turn may carry
  `tool_calls` with null content, followed by a `tool`-role result) and rejects
  the pre-D2 history on disk as incompatible (starts fresh); tool-call pairs are
  flattened to text for the summarization call so that request stays
  provider-portable. Offline tests: [`toolDispatcher.test.js`](llminteract/toolDispatcher.test.js)
  (37 checks — unknown tool, goto delegation + arg pass-through + missing-args,
  press execution / button-enum validation / `max_steps` cap, the press
  interrupt policy across all four stop branches incl. the dialog-lock opt-out,
  `set_battle_strategy` storage + enum validation, heal/use_item delegation +
  arg validation incl. bad method/target_slot/quantity + throw-isolation) and
  [`buildStatePrompt.test.js`](llminteract/buildStatePrompt.test.js) (25 checks —
  every snapshot section surfaces, read-errors reported inline, and no
  screenshot/vision wording survives), all green. The dead-on-disk
  `describeScreenshot.js` / `processResponse.js` are left in place rather than
  deleted to keep the diff reviewable.
    - *Note:* live end-to-end play against a running emulator (OpenRouter +
      mGBA-http) is not exercised here — it needs an emulator and an API key and
      is deferred to a real run. The loop's dispatch path, prompt shape, and
      history plumbing are all covered offline. `avoid_trainers` on `goto` is
      accepted but a no-op until A2's sightline tiles are ray-cast (downstream,
      per A2's note).
- **D3. Trace logging** — ✅ **DONE.** Every model call is recorded as a
  `(state_before, tool_call, outcome)` tuple in exactly the shape E3's
  distillation trace collection will consume. Source of truth:
  [`llminteract/traceLogger.js`](llminteract/traceLogger.js) — a pure
  `makeTraceRecord({...})` builder (separated from file I/O so the shape is
  unit-testable offline) plus a file-backed `TraceLogger` that appends one JSON
  object per line to a per-run JSONL file (serialized through one promise chain
  so concurrent appends from the async loop never interleave partial lines;
  writes never throw into the loop — a trace gap is preferable to crashing a
  live run). Each record carries: `schema_version` (`trace/1.0`, independent of
  the tool interface), the frozen `tool_interface_version` stamped verbatim
  (so a trace collected under v1.0.0 can never be silently replayed against a
  bumped interface), `run_id`/`turn`/`model`, `state_before` = the rendered
  pure-text prompt the model actually read (the SLM trains on exactly that text
  → the `tool_call` it maps to), a compact `state_summary` (map/pos/in-battle/
  controls-locked/badges/party-count/money) for cheap E3/E4 filtering without
  re-parsing the prompt, `tool_call` `{name,args}` or `null` (a no-tool nudge
  turn is still logged so the trace is a complete log of every model
  invocation — E3 filters those out as non-distillable rather than wondering
  where the turn went), `is_escape_hatch` (true for `press`, per D1: every
  press is a candidate for a missing macro), the verbatim `outcome` envelope
  (so E4 can score positive `ok`/`interrupted` samples vs negative
  `failed`/`blocked` ones), and a free-form `metadata` (usage tokens, etc.).
  `summarizeState()` derives the compact summary from a B1 snapshot;
  `isValidTraceRecord()` validates lines for E3's future loader so one corrupt
  line can't abort a whole dataset; `makeRunId()` shares the run-id format
  across agent.js and any ad-hoc runner. Wired into
  [`agent.js`](agent.js): a logger is constructed at boot (path configurable
  via `TRACE_FILE_PATH`, default `traces/trace-<runId>.jsonl`, git-ignored/
  regenerable), and `append(makeTraceRecord(...))` is called at the two macro-
  boundary completion points — after the dispatch resolves an outcome AND in
  the no-tool-call nudge branch (tool_call=null/outcome=null). A SIGINT/SIGTERM
  handler flushes the write queue so the last records land on disk before the
  process exits. Offline test
  [`llminteract/traceLogger.test.js`](llminteract/traceLogger.test.js): record
  shape + version stamps, the press escape-hatch flag, the no-tool-call turn,
  `summarizeState` edge cases, JSONL line integrity + ordering under concurrent
  appends, `append(raw)` build+stamp path, failure isolation on a bad path,
  closed-logger drops, `isValidTraceRecord` rejecting corrupt shapes, and an
  E3-readiness assertion that the (state_before → tool_call) distillation unit
  + an E4-scoreable outcome round-trip through JSON (50 checks, all green).
    - *Note:* the trace is written from the live `agent.js` runtime, which needs
      an emulator + OpenRouter key to actually drive the loop; the record shape,
      writer, and wiring are covered offline. E3's distillation collection will
      read these JSONL files back (via `isValidTraceRecord`) and branch from
      D4's savestate checkpoints for coverage.
- **D4. Eval harness** — ✅ **DONE.** Savestate checkpoints at each
  milestone + a timed run-to-Brock benchmark, so harness and model changes are
  measurable. Source of truth:
  [`skills/evalHarness.js`](skills/evalHarness.js). Two concerns in one module,
  both mirroring D3's pure-builder + live-transport split so the shape and
  decision logic are unit-testable offline with injected fakes (no emulator,
  no API key):
    - **Milestone checkpoints.** `EvalHarness.update(state)` polls A4's
      milestone graph against RAM — `readFlagSet(readFlag)` reads every story
      flag by its resolved bit-offset via `readPlayerFlag` (NOT B1's snapshot,
      which only knows the 8 badge flags — the whole point of A4 resolving
      the offsets authoritatively from the decomp), then `currentMilestone`
      walks the DAG. The first time a milestone is complete AND every
      predecessor (transitively) is complete — i.e. when `currentMilestone`
      counts it as "reached" — an mGBA savestate is written to
      `<checkpointDir>/<milestone-id>.ss` via `POST /core/savestatefile
      ?path=&flags=31` (mGBA's SAVESTATE ALL bitmask; `loadstatefile` flags=29,
      matching mGBA's own scripting defaults). Each milestone is saved at most
      once; a `saveState` failure is swallowed (the milestone is NOT marked
      checkpointed, so it retries next poll) — a missing checkpoint is
      preferable to crashing a live run. E3 (distillation trace collection)
      branches runs from these checkpoints for coverage instead of always
      replaying Pallet Town; `checkpointPath(dir, idOrName)` is the inverse
      it calls to load one by milestone id. Item-tracked beats with no flag of
      their own (Oak's Parcel) checkpoint via their `resolvesTo` flag — so the
      parcel checkpoint lands at the pokedex-delivery scene, a known limitation
      noted inline. Optional side beats (Route 22 rival, Poké Ball top-up)
      checkpoint too, so coverage can branch from side content.
    - **Benchmark.** `start()` stamps run start wall-clock + (optional)
      emulator frame counter (`/core/currentFrame`, independent of wall-clock
      so API latency doesn't dilute the harness-efficiency signal);
      `markTurn()` / `markSteps(n)` are called per agent-loop iteration / per
      dispatched outcome's `steps_used`. On reaching the terminal Boulder Badge
      beat, `update` finalizes and writes the report once
      (`makeBenchmarkReport` — pure; `isValidBenchmarkReport` validates lines
      for a future loader so a corrupt report can't misread); on SIGINT/SIGTERM
      the shutdown handler calls `close()` which writes a report even if the
      terminal milestone was never reached. The report carries schema_version
      (`eval/1.0`), run_id/model, start/finish wall-clock + frame (and derived
      `elapsed_ms` / `frames`), turns, steps, `reached_milestone`, `terminal`,
      `progress` (0..1), and an ordered `milestones[]` with each beat's
      crossing time/turn/frame — the numbers a model swap or harness change
      moves ("did model X reach Brock faster, in fewer turns, with fewer
      failed outcomes?").
    - Wired into [`agent.js`](agent.js): an `EvalHarness` is constructed at
      boot (`CHECKPOINT_DIR` / `EVAL_REPORT_PATH` env-overridable, defaults
      `checkpoints/<runId>/` + `eval/benchmark-<runId>.json`, both git-ignored/
      regenerable, same convention as D3's traces), `start()`ed, `update()` is
      called after each B1 snapshot (try/catch so it never breaks the loop),
      `markTurn()`/`markSteps()` after each model turn, and `close()` is in
      the SIGINT/SIGTERM handler alongside the D3 trace flush. Offline test
      [`skills/evalHarness.test.js`](skills/evalHarness.test.js) (94 checks,
      all green) covers: the flag-name set's completeness, `readFlagSet`
      error isolation, full story sequencing (6 savestates, in order, once
      each, idempotent on re-poll), any-mode starter variants, all-mode,
      item-tracked parcel, optional-beat checkpoints, out-of-order DAG gating
      (badge set without prereqs does NOT checkpoint the terminal), savestate
      write-failure swallow + retry, benchmark timing/turns/steps/crossings/
      elapsed, report builder + validator + JSON round-trip, closed-harness
      drop, benchmark-only mode (no savestates, crossings still tracked), and
      the transport URL builders' path/slot/flags.
    - *Note:* like D2/D3, live end-to-end play against a running emulator +
      OpenRouter key is not exercised here — the checkpoint decision logic,
      report shape, transport, and agent.js wiring are all covered offline.
      `avoid_trainers` on `goto` is still a no-op (no A2 sightline ray-cast
      yet), so trainer-induced HP-low interrupts can still cost a run turns —
      the benchmark measures that cost rather than assuming it away.

## Workstream E — Finetuning (after D2 is stable)

- **E1. QA pairs from wiki corpus** (slim) — ✅ **DONE.**
  [`staticdata/extractWikiQA.js`](staticdata/extractWikiQA.js) generates a slim
  SFT dataset of question/answer pairs grounded in A5's wiki corpus
  (`staticdata/corpus/wiki/*.txt`; transcripts are E2's domain, skipped here).
  The "teacher" — Cerebras `gemma-4-31b` (`CONFIGS.CEREBRAS_MODEL_NAME`, the
  OpenAI-compatible client from `agent.js:42`) — only *generates* Q/A from the
  passage text; the prompt forbids inventing facts not in the passage, so this
  is grounded data generation, not distillation of the model's own behavior
  (that's E3's job). Each wiki file is chunked by MediaWiki `==`/`===` section
  (preamble → "Introduction"; table-only stubs dropped; over-long sections
  paragraph-batched at ~2000 chars), each passage → one `temperature:0` call
  returning `{pairs:[{question,answer}]}`, parsed robustly (brace-matched JSON
  extraction so gemma's loose output survives). Per-passage error isolation so
  one bad passage can't blank the run; a sha1(passage) cache
  (`.wiki_qa_cache.json`) makes re-runs free and idempotent and survives a
  mid-run abort; bounded-concurrency pool (default 2). Output: `wiki_qa.jsonl`
  (one `{id,source,title,section,question,answer}` per line — git-ignored/
  regenerable, A5 convention) + tracked `wiki_qa_index.json` manifest (counts,
  model, `temperature`, `promptHash`, `failures[]`). Full run: 49 passages →
  201 pairs (104 Bulbapedia + 97 StrategyWiki), 0 failures, ~9s; re-run is all
  cache hits. CLI: `--limit`, `--source`, `--model`, `--concurrency`,
  `--out`, `--dry-run` (chunk + manifest, no API key needed).

- **E2. State→intent pairs from walkthroughs** — ✅ **DONE.**
  [`staticdata/extractStateIntent.js`](staticdata/extractStateIntent.js) generates
  a slim SFT dataset mapping a recent game STATE (a sliding window of A5's
  transcript frame-description text) to a high-level INTENT — one teacher-
  generated tool call against the frozen D1 interface (`goto` /
  `set_battle_strategy` / `heal` / `use_item` / `press`). Mirrors E1's pipeline
  (load `corpus/index.json` → filter `type==="transcript"` → per-item work →
  Cerebras `gemma-4-31b`, temperature 0, OpenAI-compatible client → brace-counted
  JSON parse → sha1 per-window cache (model folded into key) → dedup → gitignored
  `.jsonl` + tracked `_index.json`, ids `frlg-intent-0001`). The teacher only
  *generates* the intent label from the depicted gameplay (grounded, not a
  distillation of the walkthrough player's actions — E3's job), consistent with
  [[sft-data-is-grounded-not-distilled]]. Per the plan E2 needs A5 + D1 (not
  B1/D2), so the "state" side is the transcript's frame-description text, not a
  B1 RAM snapshot — D2/D3 reconcile the runtime state serialization later.
  Windowing is the new design choice vs. E1 (transcripts have no MediaWiki `==`
  sections): a sliding event window of the last `--window` events (default 6)
  advanced by `--stride` (default 3, 50% overlap); the intent is for the LATEST
  event in each window. Transcript 03 mixes frame descriptions with first-person
  narrator commentary; since the cleaned `.txt` doesn't mark which is which, the
  system prompt instructs the teacher to base intent on depicted gameplay and
  ignore narrator commentary (recovering `isComment` from the raw source would
  touch A5 — out of scope). The system prompt's tool list is rendered directly
  from `TOOLS`/`TOOLS_BY_NAME` so it auto-tracks D1, and every emitted intent is
  validated against the D1 schemas (`validateIntent`: name ∈ the 5 tools,
  required args present, `strategy`/`method`/`buttons` enums honored, `goto`
  `destination` is a proper `{location}`|`{x,y}` object) — invalid labels go to
  `failures[]` and never enter the SFT set. Pure-function self-test
  [`staticdata/extractStateIntent.test.js`](staticdata/extractStateIntent.test.js)
  covers `buildWindows` (size/stride/overlap/tail-clip) and `validateIntent`
  (all 5 tools' accept+reject cases) offline (44 checks, all green). Full run:
  3 transcripts → 981 windows → 981 pairs, 0 failures, ~10 min (longer prompt +
  Cerebras load); re-run is all cache hits, identical output. Distribution:
  `set_battle_strategy` 480, `press` 310, `goto` 151, `heal` 23, `use_item` 17.
  CLI: `--out`, `--limit`, `--source`, `--model`, `--concurrency`, `--window`,
  `--stride`, `--dry-run`.
    - *Found:* the D2 CONFIGS rework that moved the live agent to OpenRouter
      (`google/gemini-3.5-flash`) also dropped `CONFIGS.CEREBRAS_MODEL_NAME`
      entirely — so E1's `cli.model || CONFIGS.CEREBRAS_MODEL_NAME` (and this
      script's first draft) resolved to `undefined`, producing 0 pairs. E2
      resolves the teacher model as `--model || process.env.CEREBRAS_MODEL_NAME
      || "gemma-4-31b"` without importing CONFIGS; the `.env` still carries
      `CEREBRAS_API_KEY`, so the SFT-prep lane keeps its Cerebras teacher. **E1
      is currently broken against the working-tree CONFIGS** for the same reason
      and needs the same one-line fix — left for a separate E1 touch-up, not
      done here to keep this commit scoped to E2.
- **E3. Distillation trace collection** — ✅ **DONE.**
  [`staticdata/extractAgentTraces.js`](staticdata/extractAgentTraces.js) turns
  the D3 trace logs live `node agent.js` runs already write (`traces/*.jsonl`,
  one file per boot, `llminteract/traceLogger.js`) into the SFT-source corpus.
  Unlike E1/E2, this is GENUINE behavior distillation, not a grounded label: the
  `state`/`tool_call` pair is exactly what the live `google/gemini-3.5-flash`
  model read and chose (`CONFIGS.js`'s `OPENROUTER_MODEL_NAME`), with no teacher
  call at all — the script only filters and reshapes. Filtering keeps
  `outcome.status === "ok"` turns only (configurable via `--status`), which
  drops every `failed`/`invalid_args`/`budget_exhausted`/no-tool-call turn AND
  every `interrupted` turn regardless of `stop_reason` — including every
  low-health interrupt (`hp_low`, `about_to_faint`) — so the student never
  trains on gemini's mistakes or on the harness taking over mid-execution, per
  TRAINING.md's "SFT can only be as good as the answers you show it." A SECOND
  filter, `isManualMovementFallback()`, drops `press` turns where the model
  manually walked the overworld (directional buttons while
  `state_summary.in_battle===false` AND `state_summary.controls_locked===false`)
  instead of calling `goto` — this is a degenerate fallback (the model gives up
  retrying `goto` after it fails, e.g. a bad destination format or a routing
  gap) confirmed live on 2026-07-19: the user stopped a fresh run specifically
  because of this pattern, and it turned out to be present across most of the
  older trace files too, not just the new run — every legitimate dialog/
  cutscene press (`controls_locked===true`) uses only a/b and never mixes in
  movement buttons, so the signal cleanly separates the two without touching
  in-battle manual presses. Exact `(state, tool_call)` duplicates collapse via
  a sha1 dedup key (mirrors E2's `dedupKey`). Full run against the 20 trace
  files on disk (a start-to-Brock campaign plus one fresh, deliberately-cut-
  short run, `run-improvement-log.md`): 1047 raw lines (645 `ok` / 314
  `interrupted` / 57 `failed` / 21 `no_tool_call` / 10 `budget_exhausted`), 262
  manual-movement-fallback presses dropped → 326 deduped pairs (187 dupes
  dropped). Distribution is still press-heavy but less so (`press` 231,
  `set_battle_strategy` 41, `goto` 42, `heal` 9, `fight_battle` 3) — the
  corpus's honest composition (manual battle-mashing pre-`fight_battle` still
  generates many turns per LLM call), not rebalanced. Output:
  `staticdata/frlg/agent_traces.jsonl` (git-ignored/regenerable) + tracked
  `agent_traces_index.json` manifest. Pure-function self-test
  [`staticdata/extractAgentTraces.test.js`](staticdata/extractAgentTraces.test.js)
  (22 checks, all green) covers `isDistillable` (incl. the low-HP-interrupt
  exclusion), `isManualMovementFallback`, `dedupKey`, `toAgentTraceRecord`,
  `parseAgentTraceObj`. CLI: `--traces-dir`, `--out`, `--status`, `--limit`,
  `--dry-run`.
    - *Found while live-testing (not fixed):* the manual-movement fallback is
      often triggered by `goto` failing on a bracket-wrapped coordinate string
      destination (e.g. `"[2, 4]"`, `"[21, 34]"`) — `normalizeGotoDestination`
      (`llminteract/toolDispatcher.js:107`) coerces bare `"x,y"` and
      `"map,x,y"` strings but not a bracket-wrapped variant, so these resolve
      to `invalid_args`/"could not resolve destination" instead of a
      coordinate. A second, separate cause is genuine: `goto MAP_ROUTE2` failed
      with `"no map route to destination"` from Pewter City — a real graph gap
      in `skills/locationGraph.js`/`mapGraph.json`, not a format bug. Neither
      is fixed yet; flagged for a future harness touch-up since fixing the
      format bug directly reduces how often this fallback recurs in future
      live runs.
- **E4. SFT + RL on FreeSolo** — using milestone flags from A4/D4 as reward
  signals. The E3 lane's freesolo env
  ([`finetune-agent/`](finetune-agent/), parallel to `finetune/` and
  `finetune-state-intent/`, no shared push source) is built and ready to train:
  [`buildAgentDataset.js`](finetune-agent/buildAgentDataset.js) splits
  `agent_traces.jsonl` into a stratified-by-run 254/72 train/eval (`dataset/`,
  git-ignored except the tracked `eval_index.json`); `environment.py` +
  `system_message.txt` (the D1 interface framed for a live state prompt,
  output `{"tool_call":{...},"commentary":"..."}`) + `configs/{sft,rl,opd}.toml`
  (model `Qwen/Qwen3.5-9B`, matching the state-intent lane's "before" baseline;
  `max_context_tokens = 4096`, measured via tiktoken against the longest row —
  2248 tokens including the system message); `TRAINING.md` copied
  byte-identical from the other two lanes. `configs/opd.toml` calls out
  explicitly that OPD's teacher is a managed model (GLM-5.2 by default), NOT
  gemini — the actual gemini-distillation mechanism here is SFT against the
  harvested traces.
  [`finetune-agent/agentTraceEval.js`](finetune-agent/agentTraceEval.js) is the
  before/after/gemini comparison harness (mirrors
  `finetune-state-intent/intentEval.js`: `parse_ok`/`valid`/`name_accuracy`/
  `exact_accuracy`/`arg_match_rate`, optional Cerebras judge), test-covered in
  [`agentTraceEval.test.js`](finetune-agent/agentTraceEval.test.js) (14 checks).
  Not yet run: `flash env push` + the actual SFT training run + before/after
  eval numbers.

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
