# FireRed Agent Harness — Project Plan

Goal: rework this harness so a model plays Pokémon FireRed through the first gym
(Brock) via high-level intent tools (`goto`, `set_battle_strategy`, `heal`, …),
with pathfinding, battles, menus, and dialog handled by the harness. Then use the
finished harness to distill a FreeSolo SLM (SFT + RL).

Scope: everything up to and including the Pewter City gym.

---

## Workstream A — Static data pipeline (offline; no emulator needed)

- **A1. Extract map data from pret/pokefirered** — layouts, collision/metatile
  behaviors, warps, connections for the ~10 pre-Brock maps → static JSON. The
  decomp's `data/maps/*/map.json` files give this almost directly.
- **A2. Extract trainers, sightlines, and items** — trainer positions,
  facing/view range (for encounter-tile prediction), parties, ground items and
  hidden items on those maps.
- **A3. Location registry + cross-map graph** — named locations ("Pewter City",
  "nearest Pokécenter", "Viridian Mart") → (map, coords); graph of maps joined
  by warps/connections for cross-map routing.
- **A4. Milestone/quest graph** — the pre-Brock story sequence encoded with the
  RAM flags that mark each step complete (Oak's Parcel, rival fights, badge).
- **A5. Scrape walkthrough/wiki corpus** — Bulbapedia parts 1–3
  (`~/Desktop/frlg_walkthrough_urls.json`) and saved walkthroughs
  (`~/Desktop/pokemon_walkthroughs`) into clean text for the finetune stages.
  Fully independent; can run anytime.

## Workstream B — Runtime state layer (emulator; no static data needed)

- **B1. Unified `getState()` snapshot** — consolidate the existing RAM readers
  (`gamestate/`) into one call: player pos/map, party, battle state,
  script/dialog flags, menu state. Mostly reorganizing code that exists.
- **B2. Interrupt detector** — fast polling loop with an explicit enum of stop
  conditions: battle started, dialog/cutscene (controls locked), warp completed,
  HP below threshold, unexpected menu, script running. This is the crux —
  invest here.
- **B3. Input executor upgrade** — reliable button queue with frame-accurate
  timing, plus a dialog-advance primitive (mash A/B until controls unlock or a
  choice appears).

## Workstream C — Skills/macros (needs A1–A3 + B1–B3)

- **C1. Within-map A\*** — over A1 collision data, avoiding trainer sightline
  tiles from A2, live NPC positions from B1.
- **C2. Cross-map router** — "goto Pewter City" = graph search over A3 + C1 per
  map + warp traversal, executed step-by-step under B2's interrupt watch.
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
