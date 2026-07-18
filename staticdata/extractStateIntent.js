// Workstream E2 — State→intent pairs from the walkthrough transcripts (slim).
//
// Generates a slim SFT dataset mapping a recent game STATE (a window of
// frame-by-frame descriptions from A5's transcript corpus,
// `staticdata/corpus/transcripts/*.txt`) to the high-level INTENT an agent
// should issue next — a single tool call against the FROZEN D1 tool interface
// (`llminteract/toolInterface.js`, v1.0.0): goto / set_battle_strategy / heal /
// use_item / press. Feeds E4 SFT+RL; the labels are in the same shape E3's
// distillation traces will use.
//
// The "teacher" here only *generates* the intent label from the depicted
// gameplay — grounded in the transcript text, NOT a distillation of what the
// walkthrough player did (behavior distillation is E3's job). This mirrors E1
// (wiki QA): grounded data generation from corpus text. Per the project plan
// E2 "needs A5 + D1" (not B1/D2), so the "state" side is the transcript's
// frame-description text, not a B1 RAM snapshot — D2/D3 reconcile the runtime
// state serialization when the harness prompt is finalized.
//
// Teacher: Cerebras `gemma-4-31b` (`CONFIGS.CEREBRAS_MODEL_NAME`) — the OpenAI-
// compatible chat-completions client already used in `agent.js`/E1. Cheap and
// fast for this grounded-labeling task. temperature 0 for reproducibility.
//
// Windowing: transcripts have no MediaWiki `==` section boundaries like the
// wiki corpus, so a transcript is segmented with a SLIDING EVENT WINDOW — the
// last `--window` consecutive events (default 6) advanced by `--stride`
// (default 3, 50% overlap). Each window = one "state"; the intent is for the
// LATEST event. Transcript 03 mixes frame descriptions with first-person
// narrator commentary; since the cleaned `.txt` does not mark which is which,
// the system prompt instructs the teacher to base intent on depicted gameplay
// and ignore narrator commentary.
//
// Emits (under staticdata/frlg/, mirroring where A1–A4 and E1 emit):
//   state_intent.jsonl       — one {id,source,windowIndex,windowStart,
//                              windowEnd,state,intent,rationale} per line.
//                              Git-ignored / regenerable (A5 convention: the
//                              corpus body is ignored, a manifest is tracked).
//   state_intent_index.json  — tracked manifest (counts, model, prompt hash,
//                              tool-interface version, windowing, failures).
//   .state_intent_cache.json — git-ignored per-window cache (sha1(window) ->
//                              {intent,rationale}); re-runs free + idempotent,
//                              survives a mid-run abort.
//
// Usage:
//   node staticdata/extractStateIntent.js                 # full run
//   node staticdata/extractStateIntent.js --dry-run       # window + manifest, no API
//   node staticdata/extractStateIntent.js --limit 4       # only first 4 windows
//   node staticdata/extractStateIntent.js --source 01_100pct_no_commentary
//   node staticdata/extractStateIntent.js --window 8 --stride 4 --concurrency 3
// =============================================================================

import "dotenv/config";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import OpenAI from "openai";
import {
    TOOLS,
    TOOLS_BY_NAME,
    TOOL_INTERFACE_VERSION,
    BATTLE_STRATEGY,
    HEAL_METHOD,
} from "../llminteract/toolInterface.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CORPUS_DIR = path.resolve(__dirname, "corpus");
const INDEX_PATH = path.join(CORPUS_DIR, "index.json");

// --- CLI ---------------------------------------------------------------------

function parseArgs(argv) {
    const args = {
        out: null,
        limit: 0, // 0 = no limit
        source: null, // transcript source dir name
        model: null,
        concurrency: 2,
        window: 6, // events per state window
        stride: 3, // advance between window starts (overlap = window - stride)
        dryRun: false,
    };
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--out") args.out = argv[++i];
        else if (a === "--limit") args.limit = parseInt(argv[++i], 10);
        else if (a === "--source") args.source = argv[++i];
        else if (a === "--model") args.model = argv[++i];
        else if (a === "--concurrency") args.concurrency = parseInt(argv[++i], 10);
        else if (a === "--window") args.window = parseInt(argv[++i], 10);
        else if (a === "--stride") args.stride = parseInt(argv[++i], 10);
        else if (a === "--dry-run") args.dryRun = true;
    }
    return args;
}

const cli = parseArgs(process.argv);
const OUT_DIR = path.resolve(__dirname, cli.out || "frlg");
// The SFT-prep lane still uses the Cerebras teacher (cheap + fast for grounded
// labeling; the .env carries CEREBRAS_API_KEY). D2's CONFIGS rework moved the
// live agent to OpenRouter and dropped the CEREBRAS_MODEL_NAME constant, so
// resolve the teacher model here without depending on CONFIGS.
const MODEL = cli.model || process.env.CEREBRAS_MODEL_NAME || "gemma-4-31b";
const WINDOW_SIZE = Math.max(2, cli.window | 0);
const STRIDE = Math.max(1, cli.stride | 0);

// The button enum lives inside the press schema; pull it out so the prompt +
// validator stay in sync with D1 without hardcoding the list.
const PRESS_BUTTONS = TOOLS_BY_NAME.press.parameters.properties.buttons.items.enum;

// Render a compact reference of the frozen tools directly from `TOOLS`, so the
// prompt auto-tracks D1 (a new tool / enum added there shows up here for free).
function renderToolReference() {
    return TOOLS.map((t) => {
        const props = t.parameters.properties || {};
        const req = t.parameters.required || [];
        const fields = Object.entries(props)
            .map(([name, schema]) => {
                const reqMark = req.includes(name) ? " (required)" : "";
                const enumTxt = schema.enum ? ` enum:${JSON.stringify(schema.enum)}` : "";
                const itemsEnum = schema.items?.enum ? ` enum:${JSON.stringify(schema.items.enum)}` : "";
                return `    ${name}${reqMark} — ${schema.type || "object"}${enumTxt}${itemsEnum}`;
            })
            .join("\n");
        return `- ${t.name}: ${t.description}\n  args:\n${fields || "    (none)"}`;
    }).join("\n");
}

const SYSTEM_PROMPT = `You generate a supervised fine-tuning dataset for a slim Pokémon FireRed agent.

You are given a WINDOW of recent gameplay — a chronological list of frame-by-frame descriptions from a FireRed playthrough, each prefixed with its timestamp. The LAST frame is the current game state. Decide the SINGLE next high-level intent an agent should issue from the current state.

The intent must be ONE tool call against this frozen interface (D1 v${TOOL_INTERFACE_VERSION}):

${renderToolReference()}

STRICT RULES:
- Use ONLY the tools above. Do NOT invent tool names or args not listed.
- Base the intent on the DEPICTED GAMEPLAY in the window. IGNORE any first-person narrator commentary (e.g. "I don't care", "let's go", "oh nostalgia") — that is a human talking over the video, not game state.
- Do not invent facts not visible in the frames. If a needed arg value (e.g. a location name) is not implied by the gameplay, omit the arg rather than guessing — but never omit a required field; if you cannot fill a required field, choose a different tool.
- A BATTLE is underway ONLY when the battle UI is shown — HP bars at the top of the screen, or the FIGHT/BAG/POKEMON/RUN menu. Pokémon merely appearing in an intro cutscene, title screen, or Professor Oak's lab is NOT a battle; for those, use press (advance) or goto as appropriate.
- Choose the most specific applicable tool:
  * goto when the player is in the overworld (routes, towns, caves) and should head somewhere — navigation is the DEFAULT for overworld movement. Prefer a named location (e.g. "Pewter City", "Viridian Forest", "Pewter Gym", "nearest Pokecenter") when one is implied; otherwise use {x,y} on the current map.
  * set_battle_strategy ONLY when the battle UI (HP bars / FIGHT-BAG-POKEMON-RUN) is shown or about to be.
  * heal when the party is low on HP or status-afflicted and not mid-battle.
  * use_item when the gameplay shows using a specific bag item.
  * press (escape hatch) for dialogs/cutscenes/menus/naming screens with no higher-level tool — e.g. advance text with ["a"], back out of a menu with ["b"].
- One intent per window. Keep args minimal and valid.
- The destination arg of goto MUST be an object, never a bare string: {"location":"Pewter City"} or {"x":3,"y":4}.

Examples (note the exact arg shapes):
- Dialog text on screen: {"intent":{"name":"press","args":{"buttons":["a"]}},"rationale":"A text box is open; press A to advance."}
- Overworld, walking a route toward a town: {"intent":{"name":"goto","args":{"destination":{"location":"Viridian City"}}},"rationale":"On a route heading north; navigate to Viridian City."}
- Battle UI shown: {"intent":{"name":"set_battle_strategy","args":{"strategy":"type_effective"}},"rationale":"A wild battle started; use super-effective moves."}
- Low HP outside battle: {"intent":{"name":"heal","args":{"method":"pokecenter"}},"rationale":"Lead is low; head to the Pokécenter."}

Return ONLY a JSON object, no prose, no code fences:
{"intent":{"name":"...","args":{...}},"rationale":"one short sentence grounded in the frames"}`;

const PROMPT_HASH = crypto.createHash("sha1").update(SYSTEM_PROMPT).digest("hex").slice(0, 16);

// --- Transcript loading ------------------------------------------------------

function loadTranscriptItems() {
    const index = JSON.parse(fs.readFileSync(INDEX_PATH, "utf8"));
    return index.items.filter((it) => it.type === "transcript" && it.file);
}

// Parse one `[<start>s-<end>s] <text>` line into {start, end, text}. Lines that
// don't match (blank, stray header) are dropped.
const LINE_RE = /^\[(\d+(?:\.\d+)?)s-(\d+(?:\.\d+)?)s\]\s*(.*)$/;
function parseTranscriptLine(line) {
    const m = LINE_RE.exec(line);
    if (!m) return null;
    const text = m[3].trim();
    if (!text) return null;
    return { start: parseFloat(m[1]), end: parseFloat(m[2]), text };
}

function readTranscriptEvents(item) {
    const raw = fs.readFileSync(path.join(CORPUS_DIR, item.file), "utf8");
    return raw.split(/\r?\n/).map(parseTranscriptLine).filter(Boolean);
}

// --- Windowing ---------------------------------------------------------------

// Slide a window of `size` consecutive events over `events`, advancing `stride`
// each step. The last window with fewer than 2 events (the tail) is dropped so
// we never emit a degenerate single-frame "state". Returns windows in order.
export function buildWindows(events, size = WINDOW_SIZE, stride = STRIDE) {
    const windows = [];
    for (let i = 0; i + 1 < events.length; i += stride) {
        const slice = events.slice(i, i + size);
        if (slice.length < 2) break;
        windows.push({
            events: slice,
            startIndex: i,
            windowStart: slice[0].start,
            windowEnd: slice[slice.length - 1].end,
        });
    }
    return windows;
}

// Render a window's events as the "state" text the model sees: one line per
// event, prefixed with its start timestamp. Newest event is last.
function buildStateText(window) {
    return window.events.map((e) => `[${e.start}s] ${e.text}`).join("\n");
}

// --- Intent validation against D1 --------------------------------------------

// Pragmatic validation of a teacher-produced {name, args} intent against the
// frozen D1 schemas. Not a full JSON-Schema validator — just enough to reject
// malformed teacher output (wrong tool name, missing required fields, bad enum
// values) so a broken label can't enter the SFT set. Returns {ok, reason}.
export function validateIntent(intent) {
    if (!intent || typeof intent !== "object") return { ok: false, reason: "intent not an object" };
    const { name, args } = intent;
    if (typeof name !== "string") return { ok: false, reason: "name not a string" };
    const tool = TOOLS_BY_NAME[name];
    if (!tool) return { ok: false, reason: `unknown tool "${name}"` };
    if (!args || typeof args !== "object" || Array.isArray(args))
        return { ok: false, reason: "args not an object" };

    const required = tool.parameters.required || [];
    for (const r of required) {
        if (!(r in args)) return { ok: false, reason: `missing required arg "${r}" for ${name}` };
    }

    // Per-tool enum / shape checks.
    if (name === "set_battle_strategy") {
        if (!BATTLE_STRATEGY.includes(args.strategy))
            return { ok: false, reason: `bad strategy "${args.strategy}"` };
    } else if (name === "heal") {
        if ("method" in args && !HEAL_METHOD.includes(args.method))
            return { ok: false, reason: `bad heal method "${args.method}"` };
    } else if (name === "press") {
        const b = args.buttons;
        if (!Array.isArray(b) || b.length < 1 || b.length > 32)
            return { ok: false, reason: "buttons must be a 1..32 array" };
        for (const x of b) if (!PRESS_BUTTONS.includes(x)) return { ok: false, reason: `bad button "${x}"` };
    } else if (name === "goto") {
        const d = args.destination;
        if (!d || typeof d !== "object") return { ok: false, reason: "destination missing" };
        const hasLoc = typeof d.location === "string" && d.location.trim();
        const hasXY = Number.isInteger(d.x) && Number.isInteger(d.y);
        if (!hasLoc && !hasXY) return { ok: false, reason: "destination needs location or x,y" };
    } else if (name === "use_item") {
        if (typeof args.item !== "string" || !args.item.trim())
            return { ok: false, reason: "item must be a non-empty string" };
        if ("target_slot" in args && !(Number.isInteger(args.target_slot) && args.target_slot >= 0 && args.target_slot <= 5))
            return { ok: false, reason: "target_slot must be int 0..5" };
        if ("quantity" in args && !(Number.isInteger(args.quantity) && args.quantity >= 1 && args.quantity <= 99))
            return { ok: false, reason: "quantity must be int 1..99" };
    }
    return { ok: true };
}

// --- Robust JSON parse -------------------------------------------------------

// Extract the teacher's `{intent, rationale}` object via brace counting (gemma
// sometimes prepends a sentence or trails commentary). Strips code fences first.
function parseIntentObj(content) {
    if (!content) return null;
    let s = content.trim();
    s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
    const start = s.indexOf("{");
    if (start < 0) return null;
    let depth = 0;
    let end = -1;
    for (let i = start; i < s.length; i++) {
        const c = s[i];
        if (c === "{") depth++;
        else if (c === "}") {
            depth--;
            if (depth === 0) {
                end = i;
                break;
            }
        }
    }
    if (end < 0) return null;
    try {
        const obj = JSON.parse(s.slice(start, end + 1));
        if (!obj || typeof obj.intent !== "object") return null;
        return {
            intent: obj.intent,
            rationale: typeof obj.rationale === "string" ? obj.rationale.trim() : "",
        };
    } catch {
        return null;
    }
}

// --- Generation --------------------------------------------------------------

function makeClient() {
    const apiKey = process.env.CEREBRAS_API_KEY;
    if (!apiKey) {
        console.error("Error: CEREBRAS_API_KEY environment variable not set.");
        console.error("(Set it in .env, or pass --dry-run to window without calling the API.)");
        process.exit(1);
    }
    return new OpenAI({ apiKey, baseURL: "https://api.cerebras.ai/v1" });
}

async function generateForWindow(client, stateText) {
    const result = await client.chat.completions.create({
        model: MODEL,
        temperature: 0,
        messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: stateText },
        ],
    });
    const content = result.choices?.[0]?.message?.content;
    return parseIntentObj(content);
}

// Bounded-concurrency pool. Maps items through an async fn, at most
// `concurrency` in flight. Results in input order; thrown errors -> {__error}.
async function runPool(items, concurrency, fn, onProgress) {
    const results = new Array(items.length);
    let next = 0;
    let done = 0;
    async function worker() {
        while (true) {
            const i = next++;
            if (i >= items.length) return;
            try {
                results[i] = await fn(items[i], i);
            } catch (e) {
                results[i] = { __error: e?.message || String(e) };
            }
            done++;
            onProgress?.(done, items.length, items[i]);
        }
    }
    const n = Math.max(1, Math.min(concurrency, items.length));
    await Promise.all(Array.from({ length: n }, () => worker()));
    return results;
}

// --- Cache -------------------------------------------------------------------

function loadCache(cachePath) {
    if (!fs.existsSync(cachePath)) return {};
    try {
        return JSON.parse(fs.readFileSync(cachePath, "utf8"));
    } catch {
        return {};
    }
}

function saveCache(cachePath, cache) {
    fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2));
}

function windowKey(stateText) {
    return crypto.createHash("sha1").update(`${MODEL}\n${stateText}`).digest("hex");
}

// --- Dedup -------------------------------------------------------------------

// Collapse only EXACT-duplicate (state, intent) pairs. Overlapping windows
// differ in their state text, so this won't merge distinct supervision — it
// only drops the rare identical window re-emitted under the same label.
function dedupKey(stateText, intent) {
    const normState = stateText.toLowerCase().replace(/\s+/g, " ").trim();
    return crypto
        .createHash("sha1")
        .update(`${normState}\n${JSON.stringify(intent)}`)
        .digest("hex");
}

// --- Main --------------------------------------------------------------------

async function main() {
    const startMs = Date.now();
    console.log("=== Workstream E2: State→intent pairs (slim) ===");
    console.log(`Output dir: ${OUT_DIR}`);
    console.log(`Model: ${MODEL}  tool interface: v${TOOL_INTERFACE_VERSION}  (dry-run: ${cli.dryRun})`);
    console.log(`Window: ${WINDOW_SIZE} events  stride: ${STRIDE}  concurrency: ${cli.concurrency}`);

    fs.mkdirSync(OUT_DIR, { recursive: true });

    let items = loadTranscriptItems();
    if (cli.source) items = items.filter((it) => it.source === cli.source);
    console.log(`Transcript items: ${items.length}`);

    // Build windows across all selected transcripts, tagging each with its source.
    let windows = [];
    const perTranscript = [];
    for (const it of items) {
        const events = readTranscriptEvents(it);
        const ws = buildWindows(events);
        for (const w of ws) w.source = it.source;
        windows.push(...ws);
        perTranscript.push({ source: it.source, events: events.length, windows: ws.length });
        console.log(`  ${it.source}: ${events.length} events -> ${ws.length} windows`);
    }
    console.log(`Total windows: ${windows.length}`);

    if (cli.limit) {
        windows = windows.slice(0, cli.limit);
        console.log(`--limit ${cli.limit} -> using ${windows.length} window(s)`);
    }

    const cachePath = path.join(OUT_DIR, ".state_intent_cache.json");
    const cache = cli.dryRun ? {} : loadCache(cachePath);
    const records = [];
    const failures = [];
    let fromCache = 0;
    let asked = 0;

    if (cli.dryRun) {
        console.log("\n[dry-run] Skipping API calls; writing manifest skeleton only.");
    } else {
        const client = makeClient();
        const results = await runPool(
            windows,
            cli.concurrency,
            async (w, i) => {
                const stateText = buildStateText(w);
                const key = windowKey(stateText);
                if (cache[key]) {
                    fromCache++;
                    return cache[key];
                }
                asked++;
                const out = await generateForWindow(client, stateText);
                if (!out) return { __parseFail: true, windowIndex: i };
                const v = validateIntent(out.intent);
                if (!v.ok) return { __invalid: true, windowIndex: i, reason: v.reason, raw: out };
                cache[key] = out;
                return out;
            },
            (done, total, w) => {
                process.stdout.write(`\r  [${done}/${total}] ${w.source.slice(0, 30).padEnd(30)}`);
            }
        );
        process.stdout.write("\n");
        saveCache(cachePath, cache);

        for (let i = 0; i < windows.length; i++) {
            const r = results[i];
            const w = windows[i];
            if (!r) {
                failures.push({ windowIndex: i, source: w.source, reason: "no result" });
            } else if (r.__error) {
                failures.push({ windowIndex: i, source: w.source, reason: r.__error });
            } else if (r.__parseFail) {
                failures.push({ windowIndex: i, source: w.source, reason: "unparseable model output" });
            } else if (r.__invalid) {
                failures.push({ windowIndex: i, source: w.source, reason: `invalid intent: ${r.reason}` });
            } else {
                records.push({
                    source: w.source,
                    windowIndex: w.startIndex,
                    windowStart: w.windowStart,
                    windowEnd: w.windowEnd,
                    state: buildStateText(w),
                    intent: r.intent,
                    rationale: r.rationale,
                });
            }
        }
    }

    // Dedup exact (state, intent) duplicates.
    const seen = new Set();
    const deduped = [];
    let dupes = 0;
    for (const r of records) {
        const k = dedupKey(r.state, r.intent);
        if (seen.has(k)) {
            dupes++;
            continue;
        }
        seen.add(k);
        deduped.push(r);
    }

    // Assign ids and write JSONL (id added last, mirroring E1's record order).
    deduped.forEach((r, i) => {
        r.id = `frlg-intent-${String(i + 1).padStart(4, "0")}`;
    });
    const jsonlPath = path.join(OUT_DIR, "state_intent.jsonl");
    const jsonlText = deduped.map((r) => JSON.stringify(r)).join("\n") + (deduped.length ? "\n" : "");
    fs.writeFileSync(jsonlPath, jsonlText);

    // Manifest (tracked).
    const pairsBySource = {};
    for (const r of deduped) pairsBySource[r.source] = (pairsBySource[r.source] || 0) + 1;
    const manifest = {
        note:
            "Pre-Brock state→intent SFT pairs (slim). State = a sliding window of A5 transcript " +
            "frame-description text; intent = a teacher-generated D1 tool call grounded in the depicted " +
            "gameplay (NOT distilled from the walkthrough player's actions). Feeds E4 SFT+RL; labels share " +
            "D1's shape so E3 distillation traces compose. The state_intent.jsonl body is git-ignored/" +
            "regenerable; this manifest is tracked.",
        generatedAt: new Date().toISOString(),
        model: MODEL,
        temperature: 0,
        promptHash: PROMPT_HASH,
        toolInterfaceVersion: TOOL_INTERFACE_VERSION,
        grounding:
            "STRICT — intent must be a tool call against the frozen D1 interface and grounded in the window's " +
            "depicted gameplay; teacher ignores narrator commentary and does not invent tools/args.",
        windowSize: WINDOW_SIZE,
        stride: STRIDE,
        transcriptsUsed: items.length,
        perTranscript,
        windows: windows.length,
        windowsAsked: asked,
        windowsFromCache: fromCache,
        totalPairs: deduped.length,
        duplicatesDropped: dupes,
        pairsBySource,
        failures,
        output: "state_intent.jsonl",
    };
    const manifestPath = path.join(OUT_DIR, "state_intent_index.json");
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

    const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
    console.log(
        `\nWrote ${deduped.length} state→intent pairs (${dupes} dupes dropped, ${failures.length} failed windows) ` +
        `to ${path.relative(process.cwd(), jsonlPath)}.`
    );
    console.log(`Manifest: ${path.relative(process.cwd(), manifestPath)}`);
    console.log(`Cache: ${path.relative(process.cwd(), cachePath)} (${fromCache} hits, ${asked} asked)`);
    console.log(`Done in ${elapsed}s`);
}

// Only run the generation pipeline when this module is the entry point — its
// `buildWindows` / `validateIntent` exports are also exercised by the sibling
// self-test, which must not trigger a full API run as an import side effect.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main().catch((err) => {
        console.error("Fatal error:", err.message);
        process.exit(1);
    });
}
