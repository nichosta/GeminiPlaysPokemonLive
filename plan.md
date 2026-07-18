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
  implementations have landed (per the critical path): `goto` → C2's `gotoLive`,
  `press` → B3's `executeQueue` polled for interrupts per press,
  `set_battle_strategy` → records the standing policy in memory (C3 pending —
  the stored policy is what C3 will consume). `heal`/`use_item` return
  `precondition_failed` until C4's menu macros land. `press`'s interrupt policy
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
  (25 checks — unknown tool, goto delegation + arg pass-through + missing-args,
  press execution / button-enum validation / `max_steps` cap, the press
  interrupt policy across all four stop branches incl. the dialog-lock opt-out,
  `set_battle_strategy` storage + enum validation, heal/use_item stubs) and
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
- **D3. Trace logging** — every model call recorded as
  (state, tool call, outcome) in exactly the format E3 will consume.
- **D4. Eval harness** — savestate checkpoints at each milestone, timed
  run-to-Brock benchmark, so harness and model changes are measurable.

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
