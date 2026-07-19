// Workstream E1 — QA pairs from the wiki corpus (slim).
//
// Generates a slim SFT dataset of question/answer pairs grounded in A5's wiki
// corpus (`staticdata/corpus/wiki/*.txt`), for distilling into the FreeSolo slim
// model in E4. The "teacher" here only *generates* QA from the passage text —
// the prompt forbids inventing facts not in the passage, so this is grounded
// data generation, NOT distillation of the model's own behavior/knowledge.
// (Behavior distillation is E3's job, later.)
//
// Teacher: Cerebras `gemma-4-31b` (--model / CEREBRAS_MODEL_NAME env / default) —
// the OpenAI-compatible chat-completions client. Cheap and fast for this simple
// grounded-QA task. temperature 0 for reproducibility.
//
// Transcripts are E2's domain; this script reads wiki items only (the wiki
// entries in `staticdata/corpus/index.json`).
//
// Emits (under staticdata/frlg/, mirroring where A1–A4 emit):
//   wiki_qa.jsonl          — one {id,source,title,section,question,answer} per
//                            line. Git-ignored / regenerable (A5 convention: the
//                            corpus body is ignored, a manifest is tracked).
//   wiki_qa_index.json     — tracked manifest (counts, model, prompt hash,
//                            failures).
//   .wiki_qa_cache.json    — git-ignored per-passage cache (sha1(passage) ->
//                            pairs); makes re-runs free + idempotent and
//                            survives a mid-run abort.
//
// Usage:
//   node staticdata/extractWikiQA.js                # full run
//   node staticdata/extractWikiQA.js --dry-run      # chunk + manifest, no API
//   node staticdata/extractWikiQA.js --limit 4      # only first 4 passages
//   node staticdata/extractWikiQA.js --source bulbapedia
//   node staticdata/extractWikiQA.js --concurrency 3 --model gemma-4-31b
// =============================================================================

import "dotenv/config";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import OpenAI from "openai";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CORPUS_DIR = path.resolve(__dirname, "corpus");
const INDEX_PATH = path.join(CORPUS_DIR, "index.json");

// --- CLI ---------------------------------------------------------------------

function parseArgs(argv) {
    const args = {
        out: null,
        limit: 0, // 0 = no limit
        source: null, // bulbapedia | strategywiki
        model: null,
        concurrency: 2,
        dryRun: false,
    };
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--out") args.out = argv[++i];
        else if (a === "--limit") args.limit = parseInt(argv[++i], 10);
        else if (a === "--source") args.source = argv[++i];
        else if (a === "--model") args.model = argv[++i];
        else if (a === "--concurrency") args.concurrency = parseInt(argv[++i], 10);
        else if (a === "--dry-run") args.dryRun = true;
    }
    return args;
}

const cli = parseArgs(process.argv);
const OUT_DIR = path.resolve(__dirname, cli.out || "frlg");
const MODEL = cli.model || process.env.CEREBRAS_MODEL_NAME || "gemma-4-31b";
const MAX_PAIRS_PER_PASSAGE = 10;
const PASSAGE_CHAR_BUDGET = 2000; // split long sections into ~this-sized batches

const SYSTEM_PROMPT = `You generate a supervised fine-tuning dataset for a Pokémon FireRed/LeafGreen gameplay assistant.

From the passage below, produce up to ${MAX_PAIRS_PER_PASSAGE} question/answer pairs.

STRICT GROUNDING RULES:
- Use ONLY facts stated in the passage. Do NOT invent, assume, or import knowledge from outside the passage (even if you know it as Pokémon fact).
- If the passage does not cover a topic, do not produce a question about it.

QUESTIONS:
- Ask the things a player or a gameplay agent would plausibly need to know: where to go next, what to do, what an NPC or item does, type matchups, the sequence of events, battle strategy the passage states.
- Vary difficulty: mix direct factual lookups with "what should I do / where do I go / in what order" procedural questions.

ANSWERS (important):
- 2–4 complete, specific sentences in the voice of a walkthrough guide. Paraphrase the passage; do not add detail it does not contain.
- Be substantive: spell out the sequence of steps, name the specific NPCs/items/buttons/locations, and explain the reason where the passage gives one.
- NEVER merely restate or echo the question. If the passage does not actually state a specific answer, do not produce that question.

Return ONLY a JSON object, no prose, no code fences:
{"pairs":[{"question":"...","answer":"..."}]}`;

// sha1 of the prompt template (system text), recorded in the manifest so a
// prompt change is visible without re-reading the script.
const PROMPT_HASH = crypto.createHash("sha1").update(SYSTEM_PROMPT).digest("hex").slice(0, 16);

// --- Corpus loading ----------------------------------------------------------

function loadWikiItems() {
    const index = JSON.parse(fs.readFileSync(INDEX_PATH, "utf8"));
    return index.items.filter((it) => it.type === "wiki" && it.file);
}

function readWikiText(item) {
    return fs.readFileSync(path.join(CORPUS_DIR, item.file), "utf8");
}

// Split a wiki file into passages by MediaWiki section headers (`==`, `===`,
// `====`). Each passage = {source, title, section, body}. The preamble before
// the first header becomes an "Introduction" section. Sections whose body is
// empty/whitespace-only (e.g. the trailing `== Pokémon found ==` stubs) are
// dropped. Over-long bodies are split into paragraph batches at
// PASSAGE_CHAR_BUDGET so each generation call stays focused.
function splitIntoPassages(text, source, title) {
    const headerRe = /^(={2,})\s*(.+?)\s*\1\s*$/;
    const lines = text.split(/\r?\n/);
    const passages = [];

    let curSection = "Introduction";
    let buf = [];

    const flush = () => {
        const body = buf.join("\n").trim();
        buf = [];
        if (!body) return;
        // Drop table-only / header-only leftovers and trivially short bits.
        const prose = body.replace(/={2,}.*?={2,}/g, " ").trim();
        if (prose.replace(/\s/g, "").length < 80) return;
        for (const batch of splitByBudget(body, PASSAGE_CHAR_BUDGET)) {
            passages.push({ source, title, section: curSection, body: batch });
        }
    };

    for (const line of lines) {
        const m = headerRe.exec(line.trim());
        if (m) {
            flush();
            curSection = m[2].trim();
        } else {
            buf.push(line);
        }
    }
    flush();
    return passages;
}

// Split body into <=budget chunks on paragraph boundaries; a single paragraph
// longer than budget is emitted whole (rare, and gemma handles long input fine).
function splitByBudget(body, budget) {
    const paras = body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
    if (paras.length <= 1) return [body.trim()];
    const batches = [];
    let cur = "";
    for (const p of paras) {
        if (cur && (cur.length + p.length + 2) > budget) {
            batches.push(cur.trim());
            cur = "";
        }
        cur += (cur ? "\n\n" : "") + p;
    }
    if (cur.trim()) batches.push(cur.trim());
    return batches;
}

// --- Robust JSON parse -------------------------------------------------------

function parsePairs(content) {
    if (!content) return null;
    let s = content.trim();
    // Strip markdown code fences if present.
    s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
    // Find the outermost {...} via brace counting (gemma sometimes prepends a
    // sentence or trails commentary).
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
    const jsonText = s.slice(start, end + 1);
    try {
        const obj = JSON.parse(jsonText);
        const pairs = Array.isArray(obj?.pairs) ? obj.pairs : Array.isArray(obj) ? obj : null;
        if (!pairs) return null;
        return pairs
            .filter((p) => p && typeof p.question === "string" && typeof p.answer === "string")
            .map((p) => ({ question: p.question.trim(), answer: p.answer.trim() }))
            .filter((p) => p.question && p.answer)
            .slice(0, MAX_PAIRS_PER_PASSAGE);
    } catch {
        return null;
    }
}

// --- Generation --------------------------------------------------------------

function makeClient() {
    const apiKey = process.env.CEREBRAS_API_KEY;
    if (!apiKey) {
        console.error("Error: CEREBRAS_API_KEY environment variable not set.");
        console.error("(Set it in .env, or pass --dry-run to chunk without calling the API.)");
        process.exit(1);
    }
    return new OpenAI({ apiKey, baseURL: "https://api.cerebras.ai/v1" });
}

async function generateForPassage(client, passage) {
    const result = await client.chat.completions.create({
        model: MODEL,
        temperature: 0,
        messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: passage.body },
        ],
    });
    const content = result.choices?.[0]?.message?.content;
    const pairs = parsePairs(content);
    if (!pairs) return null;
    return pairs;
}

// Simple bounded-concurrency pool. Maps items through an async fn, with at most
// `concurrency` in flight. Returns results in input order; failures -> null.
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

function passageKey(passage) {
    // Fold the prompt hash into the cache key so a SYSTEM_PROMPT change
    // auto-invalidates old cached pairs (the key previously ignored the prompt).
    return crypto.createHash("sha1").update(`${MODEL}\n${PROMPT_HASH}\n${passage.body}`).digest("hex");
}

// --- Dedup -------------------------------------------------------------------

function normQ(q) {
    return q.toLowerCase().replace(/\s+/g, " ").replace(/[^a-z0-9 ?'-]/g, "").trim();
}

// --- Main --------------------------------------------------------------------

async function main() {
    const startMs = Date.now();
    console.log("=== Workstream E1: Wiki QA pairs (slim) ===");
    console.log(`Output dir: ${OUT_DIR}`);
    console.log(`Model: ${MODEL}  (dry-run: ${cli.dryRun})`);

    fs.mkdirSync(OUT_DIR, { recursive: true });

    let items = loadWikiItems();
    if (cli.source) items = items.filter((it) => it.source === cli.source);
    console.log(`Wiki items: ${items.length}`);

    // Build the passage list across all selected wiki files.
    let passages = [];
    for (const it of items) {
        const text = readWikiText(it);
        passages.push(...splitIntoPassages(text, it.source, it.title));
    }
    console.log(`Passages: ${passages.length}`);

    if (cli.limit) {
        passages = passages.slice(0, cli.limit);
        console.log(`--limit ${cli.limit} -> using ${passages.length} passage(s)`);
    }

    const cachePath = path.join(OUT_DIR, ".wiki_qa_cache.json");
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
            passages,
            cli.concurrency,
            async (passage, i) => {
                const key = passageKey(passage);
                if (cache[key]) {
                    fromCache++;
                    return cache[key];
                }
                asked++;
                const pairs = await generateForPassage(client, passage);
                if (!pairs) {
                    return { __parseFail: true, passageIndex: i };
                }
                cache[key] = pairs;
                return pairs;
            },
            (done, total, passage) => {
                process.stdout.write(`\r  [${done}/${total}] ${passage.source}:${passage.section.slice(0, 30).padEnd(30)}`);
            }
        );
        process.stdout.write("\n");
        saveCache(cachePath, cache);

        for (let i = 0; i < passages.length; i++) {
            const r = results[i];
            const passage = passages[i];
            if (!r) {
                failures.push({ passageIndex: i, source: passage.source, section: passage.section, reason: "no result" });
            } else if (r.__error) {
                failures.push({ passageIndex: i, source: passage.source, section: passage.section, reason: r.__error });
            } else if (r.__parseFail) {
                failures.push({ passageIndex: i, source: passage.source, section: passage.section, reason: "unparseable model output" });
            } else {
                for (const p of r) {
                    records.push({
                        source: passage.source,
                        title: passage.title,
                        section: passage.section,
                        question: p.question,
                        answer: p.answer,
                    });
                }
            }
        }
    }

    // Dedup by normalized question.
    const seen = new Set();
    const deduped = [];
    let dupes = 0;
    for (const r of records) {
        const k = normQ(r.question);
        if (seen.has(k)) {
            dupes++;
            continue;
        }
        seen.add(k);
        deduped.push(r);
    }

    // Assign ids and write JSONL.
    deduped.forEach((r, i) => {
        r.id = `frlg-wiki-${String(i + 1).padStart(4, "0")}`;
    });
    const jsonlPath = path.join(OUT_DIR, "wiki_qa.jsonl");
    const jsonlText = deduped.map((r) => JSON.stringify(r)).join("\n") + (deduped.length ? "\n" : "");
    fs.writeFileSync(jsonlPath, jsonlText);

    // Manifest (tracked).
    const pairsBySource = {};
    for (const r of deduped) {
        pairsBySource[r.source] = (pairsBySource[r.source] || 0) + 1;
    }
    const manifest = {
        note:
            "Pre-Brock wiki QA SFT pairs (slim). Grounded in A5's wiki corpus; the teacher only " +
            "generates Q/A from the passage text (no invented facts). Feeds E4 SFT+RL. The " +
            "wiki_qa.jsonl body is git-ignored/regenerable; this manifest is tracked.",
        generatedAt: new Date().toISOString(),
        model: MODEL,
        temperature: 0,
        promptHash: PROMPT_HASH,
        grounding: "STRICT — pairs must use only facts stated in the source passage; teacher does not distill its own knowledge.",
        wikiItemsUsed: items.length,
        passages: passages.length,
        passagesAsked: asked,
        passagesFromCache: fromCache,
        totalPairs: deduped.length,
        duplicatesDropped: dupes,
        pairsBySource,
        failures,
        output: "wiki_qa.jsonl",
    };
    const manifestPath = path.join(OUT_DIR, "wiki_qa_index.json");
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

    const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
    console.log(
        `\nWrote ${deduped.length} QA pairs (${dupes} dupes dropped, ${failures.length} failed passages) ` +
        `to ${path.relative(process.cwd(), jsonlPath)}.`
    );
    console.log(`Manifest: ${path.relative(process.cwd(), manifestPath)}`);
    console.log(`Cache: ${path.relative(process.cwd(), cachePath)} (${fromCache} hits, ${asked} asked)`);
    console.log(`Done in ${elapsed}s`);
}

main().catch((err) => {
    console.error("Fatal error:", err.message);
    process.exit(1);
});
