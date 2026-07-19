# Saving & loading emulator state (mGBA-http)

This project drives mGBA through the **mGBA-http** HTTP server
(`http://localhost:5000/core`). Everything the harness does — reading RAM,
taking screenshots, saving/loading state — goes through that server. There is
no direct bridge to the mGBA GUI app; the HTTP server *is* the emulator
instance the code talks to.

The savestate transport lives in [`skills/evalHarness.js`](skills/evalHarness.js)
(`saveStateFile` / `loadStateFile` / `saveStateSlot` / `loadStateSlot`).

---

## 0. The one gotcha: load the ROM into the *http* instance, not the GUI

It's easy to end up with two mGBA processes running:

- `mGBA-0.10.5-appimage` — the desktop GUI, with your game loaded, **no HTTP
  server**. The harness cannot reach it.
- `mGBA-http-0.8.2` — the HTTP server on `:5000`. **Must have the ROM loaded
  here**, or every endpoint returns `500`.

Quick health check — if this returns a number, the http instance has a core
loaded and you're good:

```bash
# EWRAM is always mapped once a game is loaded. 500 = no ROM loaded in the http instance.
curl -s "http://localhost:5000/core/read8?address=0x2000000"
```

If you see `500`, start the http instance with the ROM as an argument (the
HTTP API has **no** `loadrom` endpoint — the ROM is supplied at launch or
opened in the http instance's own window):

```bash
cd ~/Desktop
./mGBA-http-0.8.2-linux-x64-self-contained \
  "/home/daniel/Desktop/Pokemon - Fire Red Version [a1] (U) (Squirrels)/1636 - Pokemon Fire Red (U)(Squirrels).gba"
```

Confirm with the `read8` probe above before continuing.

---

## 1. The endpoints

All four are **POST-only** (`Allow: POST`, confirmed via `OPTIONS`). `flags`
is the mGBA SAVESTATE bitmask:

| flag | value | meaning |
|------|-------|---------|
| SCREENSHOT | 1 | embed screenshot |
| SAVEDATA  | 2 | battery/SaveRAM |
| CHEATS    | 4 | cheat list |
| RTC       | 8 | real-time clock |
| METADATA  | 16 | mGBA metadata |
| **ALL**   | **31** | everything |

- **Save** uses `flags=31` (ALL).
- **Load** uses `flags=29` (ALL minus METADATA) — mGBA's own scripting default.

| Endpoint | Purpose |
|----------|---------|
| `POST /core/savestatefile?path=<abs>&flags=<int>` | save state to an absolute file path |
| `POST /core/loadstatefile?path=<abs>&flags=<int>` | load state from an absolute file path |
| `POST /core/savestateslot?slot=<n>&flags=<int>`   | save to mGBA slot `n` (0–9) |
| `POST /core/loadstateslot?slot=<n>&flags=<int>`   | load from mGBA slot `n` (0–9) |

Slot files are written next to the ROM by mGBA (e.g. `1636 - Pokemon Fire Red (U)(Squirrels).ss1` for slot 1). File-based saves go wherever you point `path=`.

---

## 2. From the shell (curl)

```bash
CORE=http://localhost:5000/core

# Save current state to a file
curl -X POST "$CORE/savestatefile?path=$(pwd)/checkpoints/manual.ss&flags=31"

# Load it back later
curl -X POST "$CORE/loadstatefile?path=$(pwd)/checkpoints/manual.ss&flags=29"

# Use mGBA's numbered slots instead (0–9)
curl -X POST "$CORE/savestateslot?slot=0&flags=31"
curl -X POST "$CORE/loadstateslot?slot=0&flags=29"
```

`path` must be **URL-encoded** if it contains spaces, brackets, etc. — the JS
wrappers do this for you; raw curl with the FireRed path above will need
`encodeURIComponent`-style escaping.

---

## 3. From the harness (JS)

```js
import {
  saveStateFile, loadStateFile,
  saveStateSlot, loadStateSlot,
  checkpointPath,
} from "./skills/evalHarness.js";

// File-based
await saveStateFile("/abs/path/checkpoint.ss");
await loadStateFile("/abs/path/checkpoint.ss");

// mGBA slot-based (0–9)
await saveStateSlot(0);
await loadStateSlot(0);
```

`SAVESTATE_FLAGS_SAVE = 31` and `SAVESTATE_FLAGS_LOAD = 29` are exported
from `skills/evalHarness.js` if you need the constants directly. Each wrapper
accepts an optional `io` param (default hits the live server) so tests can
inject a fake transport — no emulator required.

### Milestone checkpoints

`checkpointPath(dir, milestoneIdOrName)` resolves a milestone's savestate path
as `<dir>/<milestone-id>.ss` — the convention the eval harness's
CheckpointManager writes and that E3 loads by milestone id. Use it to load a
known story beat (e.g. just before Brock) for benchmarking:

```js
import { checkpointPath } from "./skills/evalHarness.js";
await loadStateFile(checkpointPath("./checkpoints", "got_boulder_badge"));
```

---

## 4. Where saves live

- **Battery save (`.sav`)** — written by mGBA alongside the ROM:
  `~/Desktop/Pokemon - Fire Red Version [a1] (U) (Squirrels)/1636 - Pokemon Fire Red (U)(Squirrels).sav`
- **Slot savestates (`.ss1` … `.ss9`)** — next to the ROM, one per mGBA slot.
- **File savestates (`.ss`)** — wherever you pass `path=`. The project keeps
  milestone checkpoints under a `checkpoints/` dir (see `checkpointPath`).

As of writing, no `.ss` files exist under the repo — create the `checkpoints/`
dir before your first `saveStateFile` if you point `path=` there.

---

## 5. Troubleshooting

| Symptom | Cause / fix |
|---------|-------------|
| All endpoints return `500` | No ROM loaded in the **http** instance. Launch mGBA-http with the ROM arg (§0). |
| `405 Method Not Allowed` | You used GET. These endpoints are POST-only. |
| `404` on `/core/loadrom` etc. | Expected — mGBA-http has no ROM-load endpoint; load the ROM at launch. |
| `read8` works but savestate `500`s | Unlikely once a core is loaded; if it happens, check the `path=` is absolute and writable, and `flags` is set (don't use `0`). |
| Two mGBA windows open | You're running the GUI app *and* mGBA-http. Close the GUI app and run the game in mGBA-http instead, or the harness will keep talking to the empty http instance. |
