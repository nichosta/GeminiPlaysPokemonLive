# Unified State Snapshot (B1)

**Source of truth:** [`gamestate/getState.js`](../gamestate/getState.js)

`getState(options)` is the single call that consolidates the individual RAM
readers scattered across `gamestate/` (`playerData`, `pokemonData`, `bagData`,
`partyMenu`, `taskStatus`, `mapApi`) into one structured, JSON-serializable
snapshot. It is pure aggregation — no new memory addresses live here; each field
still comes from its existing reader.

## Why one call

Everything downstream binds to this shape:

- **B2** (interrupt detector) polls it and classifies stop conditions directly
  off its fields — the `STOP_REASON` vocabulary in
  [`llminteract/toolInterface.js`](../llminteract/toolInterface.js) maps onto
  them one-to-one (see table below).
- **D2** (agent loop) builds the model prompt from it.
- **D3** (trace logging) records it verbatim as `state_before`.

## Shape

```jsonc
{
  "timestamp": 1730000000000,
  "player": {
    "position": { "x": 12, "y": 8 },
    "facing": "down",
    "elevation": 3,
    "map": { "bank": 3, "number": 0, "name": "PEWTER_CITY" },
    "movement": { "surfing": false, "biking": false, "diving": false },
    "money": 3000,
    "badges": []
  },
  "battle": { "active": false },
  "progress": { "controlsLocked": false },   // script/dialog/cutscene lock
  "menu": {
    "partyMenuOpen": false,
    "partyMenuSlot": 7,                       // 7 == closed / Exit highlighted
    "activeTaskPtr": 0
  },
  "party": {
    "count": 1,
    "pokemon": [
      {
        "slot": 0, "nickname": "…", "species": "CHARMANDER", "level": 5,
        "currentHP": 19, "maxHP": 19, "hpFraction": 1.0, "fainted": false,
        "statusCondition": "NONE", "types": ["FIRE"], "ability": "BLAZE",
        "moves": [ { "name": "SCRATCH", "pp": 35 }, { "name": "GROWL", "pp": 40 } ]
      }
    ],
    "leadHpFraction": 1.0,      // party[0] HP fraction, or null
    "lowestHpFraction": 1.0,    // min HP fraction across the party
    "anyFainted": false
  },
  "bag": { "Items": [ … ], "Poke Balls": [ … ], … },  // only when includeBag
  "map": { … },                                        // only when includeMap
  "errors": {},                // section -> message for any reader that failed
  "ok": true                   // true when errors is empty
}
```

## Options

| option | default | effect |
|--------|---------|--------|
| `includeMap` | `true` | Read the map tile grid + collision (expensive). |
| `mapMode` | `"visibleBackup"` | `"visible"` \| `"visibleBackup"` \| `"full"` map view. |
| `includeBag` | `true` | Read bag contents (moderately expensive). |
| `includeParty` | `true` | Read the full party (needed for HP-based stops). |

The fast poll B2 needs is `getState({ includeMap: false, includeBag: false })` —
it drops the two heavy reads while keeping the battle / dialog / map-id / HP /
menu fields that stop detection depends on.

## Error isolation

A single failing reader degrades **only its own section** (to `null` / a
sensible fallback) and records the message under `errors[section]`; it never
rejects the whole snapshot. This is deliberate: B2 must be able to poll this in a
tight loop without one bad read blanking the state. Check `snapshot.ok` (or the
specific `errors` keys) when a field looks wrong.

## Fields → STOP_REASON

How B2 reads stop conditions off the snapshot. Implemented in
[`gamestate/interruptDetector.js`](../gamestate/interruptDetector.js):
`classifyInterrupt(state, options)` is the pure per-snapshot classifier below;
`watchForInterrupt(options)` wraps it in the actual fast polling loop.

| snapshot field | STOP_REASON |
|----------------|-------------|
| `battle.active` becomes true | `battle_started` |
| `progress.controlsLocked` becomes true | `dialog` |
| `player.map.{bank,number}` changed | `warp_completed` |
| `party.lowestHpFraction` below threshold | `hp_low` |
| `menu.partyMenuOpen` / unexpected `menu.*` | `unexpected_menu` |

`choice_required` (a surfaced yes/no), `about_to_faint`, and `out_of_pp` are
**not** classified by `classifyInterrupt` — they need context this snapshot
doesn't carry (a surfaced prompt, or battle move/matchup data to judge whether
the active battler survives the next hit) and are the C5 dialog handler's and
C3 battle engine's job respectively, not B2's.
