# Run improvement log

Goal: get `node agent.js` to complete an unattended run from the very start of
the game (title/new-save) through defeating Brock (`got_boulder_badge`
milestone in `skills/milestones.js` / `TERMINAL_MILESTONE` in
`skills/evalHarness.js`). Iterating live against mGBA-http on the FRLG ROM.

Using checkpoints under `checkpoints/` (see `SAVESTATES.md`) to jump straight
to trouble spots instead of replaying from the start every time; the final
confirming run must be a single unattended start-to-Brock pass.

---

## 2026-07-18

### Pre-flight check (before first run attempt)

- Baseline: all 14 test suites green (`node --test $(find . -name "*.test.js" ...)`).
- Live emulator state inspected via `getState()`: player on Route 1, level 6
  Charmander, quest tracker reports `reached: beat_rival_oaks_lab` — matches
  the last eval run's checkpoint (`eval/benchmark-run-tie7wn-e660.json`,
  `checkpoints/run-tie7wn-e660/`). mGBA-http has the FRLG ROM loaded and
  responsive.

### Bug #1 (fixed): `menu.partyMenuOpen` false-positive on a fresh save

**Symptom:** `getState()` reported `menu.partyMenuOpen: true` /
`partyMenuSlot: 0` while the live screenshot showed a plain overworld scene
(no menu open at all). This is load-bearing: `interruptDetector.js`'s
`classifyInterrupt` treats `menu.partyMenuOpen` as `STOP_REASON.UNEXPECTED_MENU`
unless the caller passes `expectMenu`, and `buildStatePrompt.js` renders it
straight into the model's prompt. Left as-is, the agent would either get stuck
being told a menu is open that isn't, or the model would see confusing state
text on every single turn.

**Root cause:** `getPartyMenuSlotId()` (`gamestate/menustate/partyMenu.js`)
reads a byte at `PARTY_MENU_ADDR + PARTY_MENU_SLOTID_OFFSET` that's supposed
to read `7` when closed — but that's only true once the game's own
`ClosePartyMenu` code has actually run at least once. On a save where the
party menu has never been opened this boot, the byte is just its
zero-initialized BSS value (`0`), which `getState.js` was interpreting as
"slot 0 selected, menu open."

Confirmed live: `PARTY_MENU_INTERNAL_ADDR` (the pointer the old, already-
deprecated `isPartyMenuOpen()` checks) read `0x0` at the same moment —
i.e. the party-menu handler has never been allocated this session at all.

**Fix:** Added `isPartyMenuHandlerAllocated()` to `partyMenu.js` (checks only
pointer nullness, no further dereference) and AND'd it into
`getState.js`'s `partyMenuOpen` computation: `partyMenuHandlerAllocated &&
partyMenuSlot !== PARTY_MENU_CLOSED_SLOT`. Verified live: `partyMenuOpen` now
reads `false` on the current save. All 14 test suites still pass.

**Caveat to watch for:** the internal pointer, once set, is *never* cleared
again per its own docstring — so this gate only helps for "menu never opened
yet this boot." Once the party menu has been opened once in a run, we're back
to trusting `partyMenuSlot` alone to correctly reset to `7` on close (which is
what the game's own code is supposed to do). If a false-positive
`UNEXPECTED_MENU` shows up *after* the first real party-menu visit in a run,
that's a different bug from this one — come back here and re-open this
investigation rather than assuming it's fixed.

### First live run attempt — in progress (background, PID logged below)

Saved a safety checkpoint before starting:
`checkpoints/session/route1_pre_run.ss` (Route 1, post-rival-battle, the
current save's furthest point — see "start" note below).

Launched `node agent.js`, logging to
`/tmp/claude-1000/.../scratchpad/agent-run.log` (session-scoped scratch dir,
not in the repo). Observed so far, ~3 minutes of wall clock:

- Startup clean: WebSocket overlay, eval harness, trace logger, chat/summary
  history all initialize without error. Eval harness immediately
  re-checkpointed `chose_starter` + `beat_rival_oaks_lab` (already-passed
  milestones on this save, expected).
- Model's first `goto` call passed `destination` as a bare string
  (`"Viridian City"`) instead of the required `{location: "Viridian City"}` /
  `{x,y}` object shape → `invalid_args`. The model did not retry `goto`
  correctly afterward; it fell back to raw `press` calls for movement instead.
  **Not treating this as a harness bug** — the schema and error message are
  both correct and clear; this is `google/gemini-3.5-flash` (a small/cheap
  model per `CONFIGS.js`) not getting the tool-call shape right on the first
  try. Worth revisiting only if it recurs constantly and stalls progress.
- A wild battle interrupted a `press` call (`stop_reason: battle_started`,
  correctly caught). The model set a battle strategy
  (`set_battle_strategy {strategy: highest_damage}`) then fought the battle by
  manually mashing `press: ["a"]` turn by turn rather than letting `goto`'s
  built-in battle auto-handoff (`runBattleLive`, wired into `gotoLive` per the
  C3/C5 commits) drive it. Initially flagged this as a possible gap, **but
  it's intended**: `CONFIGS.js`'s `SYSTEM_PROMPT_MAIN` explicitly documents
  `press` as a supported manual battle-navigation path ("press A through
  dialog is expected, not an interrupt") and
  `SYSTEM_PROMPT_BATTLE_INSTRUCTIONS` gives the model the FIGHT/BAG/POKEMON/RUN
  menu layout for exactly this. Confirmed via live `getState()` mid-battle
  that Charmander was undamaged and actually using Scratch (PP ticking down
  35→32), so the manual battle-through was working, just slow (many small
  turns/tokens per battle — expected overhead of a cheap model doing manual
  menu nav rather than the harness's automated battle policy).
- History summarization triggered cleanly at the 30-turn limit (90 messages
  summarized, token usage dropped from ~16.8k back to ~5.3k on the next call,
  run continued without a hitch).

No crashes, no repeated failed tool calls, no stuck loops observed yet.
Continuing to monitor in the background.

### Bug #2 (fixed): `goto` destination schema — small model can't produce the `oneOf` shape

**Symptom:** across the whole run, *every single* `goto` call failed with
`invalid_args`. The model tried four different shapes for `destination`
across two separate turns (a bare location string, an `"x,y"` string, a
`"map,x,y"` string, another bare location string) and never once produced the
documented `{location}` / `{map?,x,y}` nested-object shape. It gave up on
`goto` entirely afterward and fell back to raw `press` for all movement —
which works but can't drive cross-map routing or auto-battle, and turns a
short trip into dozens of individually-billed model turns.

**Root cause:** not a harness bug in the strict sense — the schema
(`DESTINATION_SCHEMA` in `llminteract/toolInterface.js`) is correct and its
error message is clear. But `oneOf`-nested-object tool parameters are a known
soft spot for smaller/cheaper function-calling models
(`google/gemini-3.5-flash` here) — they tend to flatten the value instead of
wrapping it, and once burned, this model didn't recover by retrying the
correct shape; it just avoided the tool.

**Fix:** added `normalizeGotoDestination()` in
`llminteract/toolDispatcher.js`, called at the top of `dispatchGoto`. Coerces
a bare-string `destination` into the documented shape before validation:
`"12,11"` → `{x:12,y:11}`, `"MAP_X,12,11"` → `{map:"MAP_X",x:12,y:11}`,
anything else → `{location: <string>}`. Already-object-shaped input passes
through untouched. Added regression tests in `toolDispatcher.test.js`
covering exactly the three malformed shapes observed live. Full suite green
(40/40 in that file, 14/14 suites overall).

### Bug #3 (fixed, severe): `goto` gets permanently stuck crossing ANY door/warp

**Symptom:** live-testing the Bug #2 fix immediately surfaced a much bigger
problem underneath it. Once `goto {destination: "Pallet Town"}` actually
reached the dispatcher, it walked the player from Oak's Lab's entrance all
the way to the exit door — and then never left. Direct inspection
(`getState()` polled every few steps) showed the player oscillating forever
between `(6,12)` and `(6,11)` — the exact warp tile and the tile behind it —
burning the entire step budget on repeated `budget_exhausted` outcomes across
multiple calls, without ever reaching Pallet Town. This is not a minor
inefficiency: **any goto that has to leave a building — which is most
buildings in the game, Pokécenters/Marts/gyms/houses included — would hang
forever** the same way. This alone would have made a real start-to-Brock run
essentially impossible via `goto`.

**Root cause, confirmed with live experiments (not just code reading):**
- `buildMapLeg`'s warp branch (`skills/crossMapRouter.js`) always calls
  `findPath(map, pos, edge.fromTile, {stopAdjacent: true})` to plan the
  approach to a door tile. When the player is already standing exactly *on*
  the warp tile (which happens after `gotoLive` re-derives mid-transition —
  confirmed the RAM state briefly shows the old map with `controlsLocked`
  during the door's walk-through animation, which `classifyInterrupt`
  correctly-but-incidentally reads as a `DIALOG` interrupt and auto-clears),
  `findPath` with `start === goal` under `stopAdjacent` doesn't recognize
  "already there" — it computes a path that walks *away* one tile and back,
  which **reverses the player's facing** on the final "crossing" press.
- Live-verified directly (bypassing the router, using the same
  `pressButtons`/`executeQueue` primitives): a `down` press onto the door
  tile while *already facing down* (continuing the same direction) triggers
  the warp immediately, every time. But a `down` press immediately after an
  `up` press (the direction the buggy plan produces) does **not** re-trigger
  it — confirmed across a live, repeated, deterministic oscillation, not a
  timing flake. The game's warp trigger apparently needs a continued step in
  the same direction, not a direction reversal.

**Fix:** in `buildMapLeg`'s warp branch (`skills/crossMapRouter.js`), when
`pos` already equals `edge.fromTile` *and* the live facing is known, skip the
walk-away-and-back plan entirely and just re-press the direction already
being faced (0 movement, 1 crossing press) — matching the one case confirmed
to actually fire the warp. Live facing wasn't previously threaded through
`gotoLive` at all (`readCurrent()` only read position, not facing); added
`getPlayerFacingDirection()` to it and passed `current.facing` into
`buildMapLeg`'s `pos`. The pure offline planner (`planCrossMapRoute`, no live
facing available) is unaffected — the new branch only activates when
`pos.facing` is present, so `crossMapRouter.test.js`'s offline coverage still
exercises the original stopAdjacent path.

**Verified live end-to-end** after the fix: reloaded the exact reproduction
checkpoint (`checkpoints/session/oaks_lab_stuck.ss`, Oak still mid-monologue
at the lab's starter table) and called `gotoLive({location: "Pallet Town"})`
fresh — it cleared Oak's dialog, walked to the door, crossed the warp on the
first attempt, and arrived exactly at the target tile `(12,10)` in Pallet
Town, `status: "ok"`, 22 steps total, no oscillation. Saved this state as
`checkpoints/session/pallet_town_post_goto_fix.ss`. Full test suite still
green (14/14 suites) after the change.

This was the highest-impact fix so far — restarting the full `node agent.js`
run now that both `goto` bugs are fixed.

**Follow-up while validating live:** restarted `node agent.js` from the
Pallet Town checkpoint. First `goto` call reused the model's *pre-fix*
memory of failure (chat/summary history persisted across the restart) and it
defaulted back to raw `press`. Archived `chat_history.json` /
`summary_history.json` (both gitignored, regenerable — see `.gitignore`) to
`scratchpad/*.pre-goto-fix.json` and restarted with a clean conversation so
the model isn't biased by stale failures; game progress itself is unaffected
since it lives in the emulator save state, not the chat history.

With a clean history, the model's very next `goto` call was
`{"destination":"MAP_ROUTE1"}` — a bare string again (Bug #2's coercion
handled the shape fine this time), but it failed with `"could not resolve
destination"`: the location registry (`skills/locationGraph.js`) only matched
against a location's friendly `name`/`aliases`, never its canonical `MAP_*`
`id`, even though every `locations.json` entry already carries one. Since the
model has now reached for a raw map id twice (`MAP_OAKS_LAB` pre-fix,
`MAP_ROUTE1` here), added an exact case-insensitive `id` match to
`resolveLocation()` (`skills/locationGraph.js`) — cheap, safe (no fuzzy
matching), and directly targets an observed recurring pattern. Added
regression tests (`locationGraph.test.js`) for `"MAP_ROUTE1"` and
`"map_pallet_town"`. Full suite green. Restarted the run again (clean
history, checkpoint reloaded) to observe with all three fixes in place.

**Confirmed working end-to-end with all three fixes active:** the model's
first two `goto` calls this run were `set_battle_strategy` then
`goto {"destination":"MAP_VIRIDIAN_CITY"}` (bare map-id string again) — and
this time it actually departed Pallet Town, crossed onto Route 1 heading
north, and got auto-engaged in a battle mid-route that the harness's own
battle engine is handling (confirmed live: `battle.active: true` while
`goto` is still in flight, using the `highest_damage` strategy set the turn
before) — exactly the intended `goto`-drives-everything behavior, not manual
press-mashing. This is the first time in the whole session `goto` has done
real, multi-tile, cross-map work. Leaving this run going in the background
and checking back next iteration.

## 2026-07-18 (continued) — ~25 min later check-in

Big jump: quest tracker went from `beat_rival_oaks_lab` (2/8) to
**`got_pokedex` (4/8, progress 0.5)** unattended — the model successfully
routed to Viridian Mart for the parcel, back to Oak's Lab to deliver it
(`goto {"destination":"MAP_PALLET_TOWN_PROFESSOR_OAKS_LAB,5,2"}` — a
`"map,x,y"` string, confirming Bug #2's coercion is holding up across many
varied real calls, not just the one case tested), and received the Pokédex.
Now on Route 1 heading for Viridian City again, next milestone
`defeated_brock`. Charmander level 8, HP fluctuating normally with battles
(75-87%), never in danger. Two more clean 30-turn history summarizations
happened with no issues. No crashes, no repeated failures.

One `goto {"destination":"MAP_PALLET_TOWN_PROFESSOR_OAKS_LAB"}` (no explicit
x,y, just the building) burned the full 400-step budget without arriving,
then recovered fine on the next turn with an explicit-coordinate `goto`. Not
investigating further right now — recovered on its own and the run kept
moving; would only chase this if it recurs and actually stalls something.

**Observation (not fixed, logged for later):** a trainer battle encountered
*while `goto`'s dialog sub-handler was mashing through the trainer's
pre-battle speech* surfaces to the model as `battle_started`
(`msg: "dialog interrupted: battle_started"`) instead of being auto-fought by
`runBattleLive` the way a wild encounter (detected directly in `gotoLive`'s
own press loop) is. Root cause: `gotoLive`'s `autoClearInterrupt` only chains
one interrupt type deep — a DIALOG interrupt hands off to
`advanceDialogLive`, and if *that* sub-handler hits `battle_started`
mid-mash, it correctly escalates (dialog handling isn't equipped to fight)
but `gotoLive` just surfaces it verbatim rather than then handing off to
`runBattleLive` itself. Net effect: trainer battles (which start via NPC
dialog) tend to fall to the model's manual `press` battling; wild encounters
(no intro dialog) get the harness's automated battle policy. Live-observed
this is NOT currently harmful — the model mashes A through it fine, Charmander
stayed healthy — just less efficient/strategic than the automated path. Worth
fixing (chain the escalation: on a dialog-sub-handler battle escalation,
hand off to `runBattle` before giving up) if it turns out to matter more
against tougher trainers/Brock specifically, but not blocking right now.

Letting the run continue; will check again next iteration and revisit the
trainer-battle gap if it causes real trouble (e.g. near Brock, where fights
matter more).

## 2026-07-18 (continued) — ~25 min later check-in, Bug #3 fix was incomplete

Run had pushed on to `defeated_brock` as next target, Charmander leveled to 9,
successfully used `heal {method:"pokecenter"}` earlier. Then it entered
Viridian Forest heading back toward Viridian City and got HP down to 23%
(never fainted, but close to the 20% `HP_LOW` threshold) while `heal` and
`goto` calls both repeatedly hit `budget_exhausted` (400-1000 steps, twice in
a row) without arriving. Live position checks showed the player pinned at a
single tile in the forest for multiple check-ins in a row — a stall, not
just slow going. Paused the run to investigate (saved
`checkpoints/session/forest_stuck.ss` first) rather than let it keep burning
budget doing nothing.

**Bug #3's fix from earlier this session was incomplete.** Root-caused live: this
was the *same* stuck-on-a-warp-tile scenario as Bug #3, but my earlier fix
(re-press whatever direction the player happens to be currently facing) is
wrong in general — it only worked for Oak's Lab by coincidence, because the
player's incidental facing there happened to already match the door's real
orientation. Here the player was standing exactly on the warp tile facing
`left` (irrelevant, just whatever direction they last walked), while the
door's actual entry direction is `down` — so the "fix" pressed `left`,
which is a real, unobstructed walking direction along that row, and walked
the player straight into an unrelated dead-end pocket of the map (confirmed
via the static collision grid: collision-blocked at the pocket's far edge),
completely off the intended route. Not a fluke — reproduced deterministically
every time from the saved checkpoint.

**Corrected fix** (`skills/crossMapRouter.js`, `buildMapLeg`'s warp branch):
the pathfinder's own `findPath(..., stopAdjacent: true)` call already computes
the geometrically correct entry direction as `res.facing` even in the
start===goal case (it's just "the direction from the adjacent tile back
toward the goal," which is orientation-agnostic and was actually already
correct in both the Oak's Lab *and* Viridian Forest cases when checked
directly). The real bug was only ever the wasted, harmful *movement* — walking
away and back reverses facing right before the crossing press and that
reversal is what breaks the live warp trigger, not the direction itself being
wrong. Fix: keep using `res.facing` for the crossing press (not the player's
arbitrary live facing — reverted the facing-plumbing added earlier since it's
no longer needed), but skip the detour's movement entirely (empty
`directions`/`path`, `cost: 0`) when already standing on the tile. One press,
correct direction, no detour.

**Verified against both known reproductions**, from their saved checkpoints:
- Oak's Lab (`checkpoints/session/oaks_lab_stuck.ss`): still `status: "ok"`,
  arrives at Pallet Town `(12,10)` in 22 steps — unchanged, still correct.
- Viridian Forest (`checkpoints/session/forest_stuck.ss`): no longer stuck —
  crossed the first warp into `MAP_ROUTE2_VIRIDIAN_FOREST_SOUTH_ENTRANCE`
  within the first 100-step budget (previously: infinite oscillation, zero
  net progress no matter the budget). Full multi-hop route to Viridian City
  verification in progress.

Full test suite green throughout (14/14 suites). **Lesson for next time**:
verify a "fix the reproduction" patch against more than the one case it was
built from before calling it done — the first fix looked complete because it
matched its own test case, but the underlying assumption (live facing ==
correct entry direction) only happened to hold there by coincidence.

### Final shape of the warp-crossing fix: two-strategy retry + stall guard

The Viridian Forest gatehouse then exposed a THIRD case that contradicted
both single-strategy fixes: Oak's Lab needed NO detour (walk-away-then-back
breaks it), the gatehouse's first door needed the FULL detour (its crossing
direction is walled off when tried directly — walking away is the only way
to get a legal fresh step back onto it). No single rule covers both, and
there's no static signal available to predict which one a given door needs.

**Final design** (`skills/crossMapRouter.js`): `buildMapLeg` takes an
`options.skipWarpDetour` flag and defaults to the ordinary findPath plan
(full detour) when it's not set. `gotoLive` tracks, per stuck tile, how many
distinct strategies it's already tried-and-failed
(`stallKey`/`stallAttempts`/`lastLegWasWarp`): first attempt uses the
default; if re-deriving lands back on the exact same tile with the last leg
having been a warp crossing, the *second* attempt sets `skipWarpDetour` and
tries the other strategy; if that also makes no progress, it bails out with
a `BLOCKED` outcome (not `budget_exhausted`) rather than repeating a doomed
strategy or silently burning the rest of the step budget. `lastLegWasWarp`
gates the counter so an unrelated multi-iteration stall (e.g. several turns
inside one long dialog, which legitimately doesn't move the player either)
never trips it.

**Verified against all three known cases:**
- Oak's Lab (needs strategy 2 / no-detour): `status: "ok"`, reaches Pallet
  Town in 24 steps.
- Viridian Forest's first warp (needs strategy 1 / default detour): crosses
  cleanly, confirmed separately earlier in this log.
- The gatehouse's SECOND door (Route2 South Entrance → Route2, tile
  `(6,10)`/`(7,10)`/`(8,10)`, three-tile-wide): **both strategies still
  fail.** Root cause not fully identified — collision data confirms the row
  immediately south of the door tiles is a real wall (so "press down
  directly" and "walk down from one tile north" both legitimately can't
  progress past it), and even many repeated raw `down` presses from multiple
  approach angles did nothing. This may be a genuinely different kind of
  transition (not a simple walk-through-and-warp door) that needs more
  investigation than there was time for this session. **What matters
  practically: the stall guard makes this fail FAST and VISIBLY** (16 steps,
  clear `BLOCKED` message) instead of the silent 400+ step hang it was
  before — a real improvement even though this specific door isn't fully
  solved.

**Recovered the live run manually**: walked the player back out the door we
know works (Route2 South Entrance → Viridian Forest, `(7,1)`), away from the
broken exit, and checkpointed there
(`checkpoints/session/back_in_forest_safe.ss`) rather than leave the model
stranded against a wall it can't get past automatically. Charmander is at
23% HP with a status condition (`PARALYSIS` — battle-only in these games, it
does not affect overworld walking, so it was a red herring during this
investigation, not the actual cause of any of the movement failures above).
No potions in the bag. This is a real risk the model will need to manage
(the `flee` battle strategy is still set) — resuming the live run from here
and watching closely.

**If this exact gatehouse stall recurs**: don't re-derive the same two
strategies again — worth trying a live-facing-dependent direction (what this
session's very first, discarded fix attempted) as a third fallback, or
investigating whether this door requires a specific number of consecutive
identical presses rather than a single one.

### Resumed live run — model correctly recovers from the stall guard

Resumed `node agent.js` (existing chat/summary history intact — this
restart, unlike the earlier one, didn't need a clean slate) from
`checkpoints/session/back_in_forest_safe.ss`. First action: `heal
{method:"pokecenter", max_steps:1000}` — walked back into the same broken
gatehouse, hit the stall guard, and failed in **17 steps** with the clear
`BLOCKED`/"stalled crossing a warp" message (previously: this exact scenario
burned 400-1000 steps twice in a row with no feedback). The model's very next
action was to fall back to manual `press {buttons:["down"]}`, exactly the
kind of graceful degradation the stall guard is meant to enable — it's now
trying the same door by hand, one press at a time. Manual pressing didn't
succeed for me either during the investigation above, so this may not
resolve automatically, but the model is no longer stuck silently burning
budget while doing it, and it still has the whole rest of the turn budget
available to try something else (a different route, going around, etc.) if
this doesn't pan out.

HP holding steady at 23%, no battle, safe (this room has no wild encounters).
Letting the run continue and will check on both HP and whether it found a
way past this gatehouse next iteration. This is by far the most time this
session has spent on a single bug family — worth revisiting the gatehouse
door mechanic specifically if it keeps coming up, but the stall guard means
it's no longer a run-ending trap either way.

## 2026-07-18 (continued) — ~25 min later check-in: recovered and moving well

Good news across the board:
- Charmander is fully healed (**HP back to 100%**, `PARALYSIS` cured) and
  **leveled up to 10** — the model found a working path to a Pokécenter on
  its own despite the broken gatehouse door (didn't dig into exactly how;
  the important thing is it wasn't stuck).
- `goto {"destination":"MAP_PEWTER_CITY"}` hit the stall guard twice more
  during this stretch (once at a *different* warp near a Viridian building,
  once at the same known-broken gatehouse) — both times failing in single-
  digit-to-low-hundreds steps with the clear message, not the old 400-1000
  step silent hang. Each time, the model adapted (manual `press`, or just
  retrying `goto` again later from a different position) and kept moving.
- Now deep in Viridian Forest heading toward Pewter City, `goto` calls are
  making real multi-tile progress per attempt (162 steps in the last one)
  and correctly auto-fighting trainer battles encountered along the way,
  including a battle that was still active when the model re-called `goto`
  (confirmed live: `gotoLive`'s "already in battle at start" handling kicked
  in and resolved it, matching the F. test case in
  `crossMapRouter.test.js`).
- HP has been trending down through the forest's battles (100% → 68% → 54%
  → 43%) but always recovers between fights and stays well clear of the 20%
  `HP_LOW` threshold — normal wear from a high-encounter-rate area, not a
  danger sign yet. Watching this; if it drops further without healing,
  that's the next thing to check on.

Quest tracker still shows `got_pokedex` (4/8) reached — `defeated_brock` is
the big next milestone (needs Pewter City, then the gym itself), so no new
milestone yet, but this is clearly close to breaking out of Viridian Forest
for good. Letting it continue.

### Stopped by user request

Paused here at user's request. Live state at stop: Viridian Forest, HP 91%,
still `got_pokedex` (4/8), en route to Pewter City via `goto`. One more stall
guard hit in this stretch (`choice_required` after a dialog wouldn't clear in
60 presses — a real yes/no prompt the snapshot can't read, not a bug, per
`docs/state-snapshot.md`'s documented `choice_required` limitation) which the
model correctly worked around with manual `press`.

Saved `checkpoints/session/stopped_here.ss` before killing `node agent.js` so
this progress isn't lost. To resume: `curl -X POST
"http://localhost:5000/core/loadstatefile?path=$(pwd)/checkpoints/session/stopped_here.ss&flags=29"`,
then `node agent.js` (chat/summary history on disk still match this point).

**State of the fixes**: `menu.partyMenuOpen` false-positive, `goto` destination
schema coercion, canonical `MAP_*` id resolution, and the warp-crossing
two-strategy retry + stall guard are all in place and test-covered (14/14
suites green). The one known-unresolved case is the Route 2 South Entrance
gatehouse's second door (`skills/crossMapRouter.js`'s warp branch) — both
retry strategies fail there for a reason not fully root-caused; the stall
guard keeps it from being a run-ending trap but a real fix would need more
investigation (see the "If this exact gatehouse stall recurs" note above).
No milestone progress past `got_pokedex` (4/8) yet — `defeated_brock` and the
final start-to-Brock confirmation run are still open.

### "Start" scope note

There is no pre-existing "true start of game" (title screen / new save)
checkpoint in this repo, and the live save was already at Route 1 (past
`chose_starter` + `beat_rival_oaks_lab`, milestone 2 of 8) when this session
began — there's no in-repo tooling yet for driving the name-entry/intro
screens. Treating "start" pragmatically as this earliest available point for
now; will revisit whether a true power-on run is feasible once the harness is
reliably clearing the rest of the milestones.

## 2026-07-18 (evening) — resumed after user emulator restart; Pewter City reached

User restarted mGBA-http; verified FireRed loaded (`AGB-BPRE`), reloaded
`checkpoints/session/stopped_here.ss`, and resumed `node agent.js` with the
existing chat/summary history. (Note for future ad-hoc `getState()` probes:
must set `POKEMON_GAME_VERSION=FRLG` — a bare `node -e` probe defaults to
EMERALD constants and every pointer read fails; this cost a few minutes of
false alarm.)

Within ~5 minutes of resuming, the model:
- `goto MAP_PEWTER_CITY` three times in a row — first two interrupted by
  trainer battles surfacing as `battle_started` mid-dialog (the known
  one-level-deep `autoClearInterrupt` gap, still non-blocking), third call
  **arrived in Pewter City** (`status: ok`, 119 steps) — first time any run
  has made it here.
- Immediately called `heal {method:"pokecenter"}` and walked itself into the
  Pewter Pokémon Center (confirmed live: `MAP_PEWTER_CITY_POKEMON_CENTER_1F`,
  HP was 23/32 going in).

Next: Brock. Watch items: Charmander is lvl 12 (learns Metal Claw at 13 —
the intended anti-Brock move); Ember is resisted by Rock. The trainer-battle
dialog gap means gym fights will likely fall to the model's manual `press`
battling — this is the exact scenario flagged earlier as "worth fixing if it
matters near Brock." Monitoring the gym attempt closely before deciding
whether to pause and wire the dialog→battle handoff chain.

## 2026-07-18 (late evening) — user-flagged issues: manual-input overuse, potion loop, per-tile movement

User observations on the resumed run: (1) the model manually clicks through
battle sequences instead of using harness utilities; (2) it looped trying to
use a Potion mid-battle; (3) `goto` moves one tile per tap — slow. Paused the
run mid-gym-battle to address all three (checkpoint:
`checkpoints/session/gym_battle_low_hp.ss` — in-battle, 8/32 HP, cursor
parked on BAG; a perfect harness-takeover test case).

### Fix batch (all landed, 14/14 suites green + live-verified):

1. **`fight_battle` tool (tool interface 1.0.0 → 1.1.0).** The model can now
   hand ANY active battle to C3's engine (`{strategy?, max_steps?}`, uses the
   standing policy; precondition_failed when no battle). System prompt updated
   to always prefer it over manual pressing. This directly attacks the
   manual-battling token burn (a full LLM turn per 1-2 A-presses observed).

2. **Dialog→battle chaining in gotoLive.** The known gap where trainer
   battles (which start via NPC dialog) surfaced `battle_started` to the
   model instead of being auto-fought: `autoClearInterrupt` now chains the
   dialog sub-handler's battle_started escalation into `runBattleLive`.
   Regression tests H/I in crossMapRouter.test.js.

3. **In-battle `use_item` message** now actionable: points at fight_battle
   (items path) instead of the terse "overworld-only" the model looped on.

4. **Hold-based continuous movement in gotoLive.** Straight-line stretches
   batch into ONE frame-counted held input (16 frames/tile, cap 12 tiles),
   re-deriving the leg from live position after every held run (undershoot
   from facing-turns/NPC blocks self-corrects). Tests J/K. Live: Pokécenter →
   gym across Pewter City = 56 steps / 13.9s.

### Found + fixed while live-testing fight_battle (three deep battle-engine bugs):

5. **Cursor-position assumption.** Gen-3 battle menus REMEMBER cursor
   position; the engine assumed FIGHT/slot-0. Live failure: cursor left on
   BAG → every blind A opened the bag, 200 steps of nothing. Fix:
   cursor-agnostic navigation (B,B back-out; Left,Up forces top-left; 2x2
   grid layout for moves — the old code also treated the move grid as a
   vertical list).

6. **Menu tap pacing.** At the executor's 1-frame settle default, battle-menu
   navigation landed but the final A confirm was dropped — deterministically
   (0 moves fired across 23 sequences; same sequence at 10-frame settle fired
   every time). `MENU_TAP_SETTLE_FRAMES = 10` for battle menu sequences.

7. **No turn-settle.** The engine re-fired its sequence every ~600ms into the
   turn animation, burning ~14 presses/sec advancing text. Added
   `TURN_SETTLE_FRAMES = 240` (~4s) after each move selection.

   Result: from the stuck checkpoint, `fight_battle` **won the gym-trainer
   battle unattended** (126 steps): Charmander 12→13, auto-learned METAL CLAW
   (empty slot, no forget-prompt risk), 10/34 HP.

### Warp-door root cause FOUND (explains the "unsolved" Route 2 gatehouse door)

`heal {pokecenter}` from inside the gym hit the stall guard on the gym's own
exit. Investigation with the static `behaviorIds` grid (already in A1's data,
never used by the router):

- Multi-tile door mats (gym exits, gatehouse doors) list EVERY mat tile in
  `map.warps`, but only the tile carrying a warp *behavior* actually fires.
  Pewter Gym: (6,14) behavior 101 = MB_SOUTH_ARROW_WARP works, (5,14)/(7,14)
  behavior 0 are DEAD. Route 2 gatehouse south door: identical — only (7,10)
  is functional. The router targeted the nearest listed warp tile → dead mat
  → the old two-strategy oscillation.
- Arrow-warp mats are WALKABLE and fire on stand-ON-tile + press-direction —
  a different procedure from door metatiles (collision-blocked, press INTO
  from adjacent). Live-verified: down-presses on (5,14) do nothing forever;
  a single down on (6,14) warps instantly.

Fix in `buildMapLeg`'s warp branch: behavior-aware retarget within the
same-destination warp cluster + dedicated arrow-warp crossing (route ONTO the
tile, press the arrow direction from `ARROW_WARP_PRESS`). Live: heal from
inside the gym now exits, heals, in 79 steps / 24s.

### Enemy-side battle read (closes C3's `enemy: null` gap)

Added `ENEMY_PARTY_BASE_ADDR` (gEnemyParty: FRLG 0x0202402C, Emerald
0x02024744) + `getEnemyLeadSummary()` in pokemonData.js (reuses the existing
decrypt/unshuffle pipeline; ~5 reads). `runBattleLive` polls it each decision
and passes `{types, level, species}` — type-effectiveness scoring is now LIVE
(verified: vs Brock's Rock/Ground the policy picks METAL_CLAW at 100
effective power over STAB Ember's 15; blind it wrongly picked Ember).
Stale-read guard: 0-HP enemy lead (previous battle's KO lingers in RAM) =
"unknown".

### First full Brock attempt: LOST by a hair (expected-hard, not a harness bug)

Drove the exact model-visible tool calls from the healed checkpoint
(`pre_brock_healed_metalclaw.ss`, lvl 13): goto gym → goto (5,5) → press
right,A → mash A through intro → fight_battle. The engine fought Brock
cleanly (live enemy read: GEODUDE Lv12 31/31), got Onix to a red sliver WITH
a burn ticking… and Charmander fainted first (whiteout text on screen, party
returned healed to Pewter Pokécenter, ₽112 paid). Solo lvl-13 Charmander vs
Brock is genuinely a coin flip; Charmander reached **lvl 14 with full HP**
from the fight's XP. Retrying immediately at 14 — if it fails again, the
model (or a level_grind stint) needs to close the gap, which is gameplay, not
harness.

## 2026-07-19 — catching wired into the battle engine (`catch_all_pokemon`)

Observations from a fresh start→Brock run: the model never caught anything
(always `catch_wild=false`) and never grinded deliberately — it walked straight
to the gym and lost repeatedly until retained XP crept Charmander high enough
to win. Root cause was capability, not model judgment: catching was never wired
end-to-end (the old `catch_wild` flag only picked the weakest MOVE; the ball
throw was punted to `use_item`, which refuses mid-battle), and there's no grind
tool at all.

**Change (per user):** renamed the flag `catch_wild` → **`catch_all_pokemon`**
and made it actually catch. In `runBattleLive` (`skills/battlePolicy.js`): when
the flag is set, chip the target with the weakest move (`decideAction`'s catch
branch, now gated on the flag alone — no longer on an unreadable `isWild`),
then once the live enemy-HP read (`getEnemyLeadSummary`, `currentHP/maxHP`) is
at/below `DEFAULT_CATCH_HP_THRESHOLD` (0.3), throw a ball and repeat until
caught. Ball chosen by `pickCatchBall` (Pokéballs pocket, cheapest-first).
`MAX_CATCH_ATTEMPTS` (8) caps throws so the flag left on during a trainer fight
fails fast with `choice_required` instead of burning the budget; no balls in
bag → `choice_required` too. Grinding is then an emergent loop: set the flag,
`goto` back and forth through grass (e.g. Viridian Forest).

Wild-vs-trainer still isn't readable from the snapshot, so the design makes
toggling the model's job: the system prompt + tool description now tell it the
flag is a STANDING toggle that catches EVERY battle and must be turned OFF
before gyms/trainers. Renamed everywhere (`toolInterface`, `toolDispatcher`,
`crossMapRouter`, CONFIGS system prompt) + tests updated. Full suite green
(799 passed, 0 failed).

**NOT yet live-verified:** the in-battle ball-throw button sequence
(`defaultThrowBallSequence`) is unit-tested only via injection. Its GAPs
(Right advances the *battle* bag's pockets like the field bag; a single A
throws with no confirm prompt) need one live catch to confirm. Couldn't verify
this session — the live save is a solo L6 Charmander on Route 1 with **zero
Poké Balls**; verifying needs balls + a driven wild encounter.

**Related gap surfaced (not addressed):** even after catching a team, the model
has no first-class way to CHOOSE its lead / switch in battle. `set_battle_strategy
{lead}` sets a preference and `decideAction` produces a switch decision, but
`runBattleLive` still surfaces switches as `choice_required` (the "C4 pending"
note) rather than executing them. The primitives exist unused
(`menuMacros.selectPartySlotLive`, `reorderPartyLive`) — wiring them into the
battle engine / exposing a switch tool is the natural follow-up.
