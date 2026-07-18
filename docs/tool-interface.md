# Tool Interface Spec (D1 — FROZEN)

**Version:** 1.0.0 &nbsp;·&nbsp; **Status:** frozen &nbsp;·&nbsp; **Source of truth:**
[`llminteract/toolInterface.js`](../llminteract/toolInterface.js)

This is the contract the model uses to play. It is frozen *early and on paper*
(per the plan's D1) because everything downstream binds to it:

- Workstream **C** (skills/macros) implements each tool behind this signature.
- **D2** (agent loop) dispatches on these names and args.
- **D3** (trace logging) records every model call as a `(state, tool_call,
  outcome)` tuple in exactly this shape.
- **E3** (distillation traces) are only reusable if the interface they were
  collected against does not move.

> **Change policy:** do not rename a tool, change its args, or alter the outcome
> envelope without bumping `TOOL_INTERFACE_VERSION`. Any traces collected under
> an older version must be re-tagged or discarded. Adding a *new* tool is a minor
> bump; changing or removing an existing one is a major bump.

The schema module is authoritative — if this doc and the code disagree, the code
wins and this doc is the bug.

---

## Design principles

1. **High-level intent, not inputs.** The model says *where* and *what*, never
   *which tile* or *which button* (except through the `press` escape hatch). The
   harness owns pathfinding, battles, menus, and dialog.
2. **Constrained args.** Closed enums and bounded integers everywhere. A small,
   closed action space is what makes the FreeSolo SLM learnable and keeps traces
   clean.
3. **Every tool is budgeted.** Long-running macros (`goto`, `heal`, `press`)
   take a `max_steps` budget so the model can never lose control indefinitely.
4. **One uniform outcome envelope.** Every call resolves to the same shape, so
   the loop is event-driven and traces are homogeneous.
5. **Escalate, don't guess.** When a macro hits a state it should not decide on
   its own (a choice, a near-faint, an unknown screen), it stops and returns
   control with a precise `stop_reason` rather than improvising.

---

## The outcome envelope

Every tool call resolves to exactly this object (built via `makeOutcome`):

```jsonc
{
  "status":       "ok" | "interrupted" | "failed" | "budget_exhausted",
  "stop_reason":  "<STOP_REASON>",   // why control returned; "none" on clean ok
  "steps_used":   0,                  // steps consumed against the tool's budget
  "message":      "",                 // short summary for the model + logs
  "state_delta":  null | { ... }      // compact before→after (pos, hp, flags…)
}
```

`stop_reason` draws from a **single enum shared with the B2 interrupt detector**
(`STOP_REASON` in the module). The detector's stop conditions and a tool's
`stop_reason` are the same vocabulary, so a trace never has to guess why control
came back:

`none`, `battle_started`, `dialog`, `choice_required`, `warp_completed`,
`hp_low`, `out_of_pp`, `about_to_faint`, `blocked`, `unexpected_menu`,
`unknown_state`, `budget_exhausted`, `invalid_args`, `precondition_failed`.

The agent loop (D2) calls the model again only when a tool returns an envelope —
i.e. on macro completion or interrupt — never on a fixed timer.

---

## Tools

### `goto`

Navigate to a destination. The harness handles within-map A\* (C1), cross-map
routing over warps/connections (C2), trainer-sightline avoidance (A2), and live
NPC dodging (B1). Returns on arrival **or** the first interrupt.

| arg | type | default | notes |
|-----|------|---------|-------|
| `destination` | `{location}` **or** `{map?, x, y}` | — | named registry location or map-local coords |
| `avoid_trainers` | boolean | `true` | route around sightline tiles when possible |
| `max_steps` | int 1–2000 | 400 | one step ≈ one tile move |

Typical stops: `warp_completed`, `battle_started`, `dialog`, `blocked`,
`budget_exhausted`.

### `set_battle_strategy`

Set the standing policy for the C3 battle engine. **Does not** start or advance a
battle and consumes no step budget — it only updates policy. The engine still
escalates to the model on `out_of_pp` / `about_to_faint` / `unknown_state`
regardless of the strategy.

| arg | type | default | notes |
|-----|------|---------|-------|
| `strategy` | enum | — | `default`, `highest_damage`, `type_effective`, `conserve_pp`, `level_grind`, `flee` |
| `lead` | string | — | nickname/species to keep active when possible |
| `catch_wild` | boolean | `false` | weaken-and-catch wild encounters instead of KO/flee |

### `heal`

Restore the party (HP, PP, status). Routes to the nearest Pokécenter (reusing
`goto`/C2) or applies bag items via C4 menu macros, per `method`.

| arg | type | default | notes |
|-----|------|---------|-------|
| `method` | enum | `auto` | `pokecenter`, `items`, `auto` (harness picks) |
| `max_steps` | int 1–2000 | 400 | budget for routing when a Pokécenter is used |

### `use_item`

Use one bag item, in the overworld or in battle. The harness opens the bag,
selects it, and applies it to the target via C4 macros.

| arg | type | default | notes |
|-----|------|---------|-------|
| `item` | string | — | exact bag name, e.g. `Potion`, `Antidote`, `Poke Ball`, `Oak's Parcel` |
| `target_slot` | int 0–5 | — | party slot when the item targets a Pokémon |
| `quantity` | int 1–99 | 1 | how many to use |

### `press` — escape hatch

Raw button sequence for states no higher-level tool covers (odd menus, cutscene
prompts, minigames). **Prefer the structured tools.** Every `press` call is a
signal for a missing macro and is flagged as such in traces.

| arg | type | default | notes |
|-----|------|---------|-------|
| `buttons` | string[1–32] | — | ordered taps from `a b l r start select up down left right` |
| `max_steps` | int 1–32 | `buttons.length` | cap on presses actually sent |

---

## What is intentionally *not* a tool

Kept out to hold the action space small and the traces learnable:

- **No `talk`/`interact`.** Advancing dialog and surfacing yes/no choices is the
  C5 dialog handler's job — it happens automatically inside a macro and surfaces
  as a `choice_required` interrupt, not a separate model tool.
- **No raw movement (`move up`, …).** That is what `goto` replaces; raw input
  survives only through `press`.
- **No `save`/`load`/`menu`.** Harness-side concerns (eval checkpoints in D4),
  not model actions.

New tools are added only when a real state proves un-handleable by the five
above — and adding one is a versioned change (see the change policy at top).

---

## Relationship to the rest of the plan

- **B2** owns the `STOP_REASON` enum; this interface re-exports and reuses it so
  detector and tool outcomes speak one language.
- **C1–C5** are the implementations behind these five signatures.
- **D2** imports `TOOLS` / `toOpenAITools()` to advertise tools and
  `TOOLS_BY_NAME` to dispatch.
- **D3** logs `(state_before, {name, args}, outcome)` — all three already fully
  specified here.
