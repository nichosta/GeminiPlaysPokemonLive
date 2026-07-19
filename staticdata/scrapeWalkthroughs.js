// Workstream A5 — Walkthrough and wiki corpus extraction.
//
// Builds an offline corpus from two sources for later finetuning:
// 1. Wiki pages (Bulbapedia parts 1-5, StrategyWiki pages through Misty/Cascade
//    Badge plus the mechanic/reference pages — see STRATEGYWIKI_ALLOWLIST)
// 2. Video transcripts (three playthrough dirs, still truncated at Boulder Badge)
//
// The wiki corpus is scoped through Misty / Cascade Badge (Parts 1-5).
// Generated bulk text is gitignored; the manifest index.json is tracked.
//
// Usage:
//   node staticdata/scrapeWalkthroughs.js
//   node staticdata/scrapeWalkthroughs.js --wiki-only
//   node staticdata/scrapeWalkthroughs.js --transcripts-only
//   node staticdata/scrapeWalkthroughs.js --out staticdata/corpus --urls ~/Desktop/frlg_walkthrough_urls.json

import fs from "fs";
import path from "path";
import os from "os";
import { execFileSync } from "child_process";

// --- CLI / paths -----------------------------------------------------------

function parseArgs(argv) {
  const args = {
    wikiOnly: false,
    transcriptsOnly: false,
    out: null,
    urls: null,
    transcripts: null,
  };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--wiki-only") args.wikiOnly = true;
    else if (argv[i] === "--transcripts-only") args.transcriptsOnly = true;
    else if (argv[i] === "--out") args.out = argv[++i];
    else if (argv[i] === "--urls") args.urls = argv[++i];
    else if (argv[i] === "--transcripts") args.transcripts = argv[++i];
  }
  return args;
}

function expandHome(p) {
  if (!p) return p;
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

const cli = parseArgs(process.argv);
const OUT_DIR = path.resolve(
  expandHome(cli.out || path.join(path.dirname(new URL(import.meta.url).pathname), "corpus"))
);
const URLS_PATH = path.resolve(
  expandHome(cli.urls || path.join(os.homedir(), "Desktop/frlg_walkthrough_urls.json"))
);
const TRANSCRIPTS_DIR = path.resolve(
  expandHome(cli.transcripts || path.join(os.homedir(), "Desktop/pokemon_walkthroughs"))
);

// --- Helpers ---------------------------------------------------------------

function readJSON(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function cleanWikiText(text) {
  // Normalize line endings, trim trailing spaces, collapse 3+ blank lines to 1
  let cleaned = text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
    .join("\n");

  // Collapse 3+ consecutive blank lines to 1
  cleaned = cleaned.replace(/\n\n\n+/g, "\n\n");

  return cleaned.trim();
}

function kebabCase(str) {
  return str
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

function curlJson(url) {
  const ua = "Mozilla/5.0 (X11; Linux x86_64) FRLG-agent-harness/1.0 (research; contact danielrmorgan11@gmail.com)";
  const stdout = execFileSync(
    "curl",
    ["-sS", "--fail", "-m", "30", "-A", ua, url],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }
  );
  return JSON.parse(stdout);
}

// --- Wiki scrape -----------------------------------------------------------

// Scoped through Misty / Cascade Badge (Parts 1-5 on Bulbapedia). Includes the
// pre-Brock pages, the Route 3 / Mt. Moon / Route 4 / Cerulean / 24 / 25 / 5
// pages, and the mechanic/reference pages (Moves, Abilities, Items, ...) which
// are the richest non-walkthrough content. Dial this up to extend further.
const STRATEGYWIKI_ALLOWLIST = new Set([
  // pre-Brock walkthrough
  "Pallet Town",
  "Route 1",
  "Viridian City",
  "Route 22",
  "Route 2",
  "Viridian Forest",
  "Pewter City",
  // post-Brock through Misty
  "Route 3",
  "Mt. Moon",
  "Route 4",
  "Cerulean City",
  "Route 24",
  "Route 25",
  "Route 5",
  // mechanic / reference pages (richest non-walkthrough content)
  "Gameplay",
  "Controls",
  "Raising Champions",
  "Catching Pokémon",
  "Moves",
  "Abilities",
  "Items",
  "Key Items",
  "Poké Balls",
]);

async function fetchWiki() {
  console.log("\n[Wiki] Fetching and cleaning wiki pages...");

  if (!fs.existsSync(URLS_PATH)) {
    console.error(`  ! wiki URLs file not found at: ${URLS_PATH}`);
    return [];
  }

  const urlsData = readJSON(URLS_PATH);
  const wikiItems = [];

  for (const source of urlsData.walkthroughs) {
    const host = new URL(source.source).hostname;
    const isBulbapedia = host.includes("bulbapedia");
    const isStrategyWiki = host.includes("strategywiki");

    if (!isBulbapedia && !isStrategyWiki) continue;

    for (const part of source.parts) {
      let include = false;
      if (isBulbapedia && part.part <= 5) {
        include = true;
      } else if (isStrategyWiki && STRATEGYWIKI_ALLOWLIST.has(part.title)) {
        include = true;
      }

      if (!include) continue;

      const url = part.url;
      const urlObj = new URL(url);
      const pagePath = urlObj.pathname;
      const pageTitle = decodeURIComponent(pagePath.split("/wiki/")[1] || "");

      if (!pageTitle) {
        console.warn(`  ! could not extract page title from ${url}`);
        continue;
      }

      const apiUrl = `https://${host}/w/api.php?action=query&prop=extracts&explaintext=1&redirects=1&format=json&titles=${encodeURIComponent(pageTitle)}`;

      try {
        // Polite delay between requests
        await new Promise((r) => setTimeout(r, 500));

        let data;
        try {
          data = curlJson(apiUrl);
        } catch (err) {
          console.warn(`  ! failed to fetch ${url}: ${err.message}`);
          continue;
        }

        const pages = data.query.pages;
        const pageId = Object.keys(pages)[0];
        const extract = pages[pageId]?.extract;

        if (!extract || extract.trim().length === 0) {
          console.warn(`  ! no content extracted from ${url}`);
          continue;
        }

        const cleaned = cleanWikiText(extract);
        const sourceLabel = isBulbapedia ? "bulbapedia" : "strategywiki";
        const filePrefix = isBulbapedia ? `bulbapedia_part-${part.part}` : `strategywiki_${kebabCase(part.title)}`;
        const filePath = path.join(OUT_DIR, "wiki", `${filePrefix}.txt`);

        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, cleaned + "\n");

        const relFile = path.relative(OUT_DIR, filePath);
        wikiItems.push({
          type: "wiki",
          source: sourceLabel,
          title: part.title,
          url,
          file: relFile,
          chars: cleaned.length,
          fetchedAt: new Date().toISOString(),
        });

        console.log(`  ✓ ${sourceLabel}/${filePrefix} (${cleaned.length} chars)`);
      } catch (err) {
        console.warn(`  ! error fetching ${url}: ${err.message}`);
      }
    }
  }

  return wikiItems;
}

// --- Transcript clean ------------------------------------------------------

// Pre-Brock StrategyWiki allowlist page titles
const PLAYTHROUGH_DIRS = ["01_100pct_no_commentary", "02_full_game_walkthrough", "03_switch2_gameplay_walkthrough"];

function parseTranscriptLine(line, endTime) {
  // Try format 1: "Xs to Ys: text". Require a non-space char after the colon so
  // a bare "Xs to Ys:" parent (which introduces indented "at Xs:" sub-lines)
  // falls through to format 3 instead of being read as an empty-text event.
  const match1 = line.match(/^(\d+(?:\.\d+)?)s\s+to\s+(\d+(?:\.\d+)?)s:\s*(\S.*)$/);
  if (match1) {
    return {
      start: parseFloat(match1[1]),
      end: parseFloat(match1[2]),
      text: match1[3],
      isComment: false,
    };
  }

  // Try format 2: "Transcript (Xs to Ys): text" (commentary)
  const match2 = line.match(/^Transcript\s+\((\d+(?:\.\d+)?)s\s+to\s+(\d+(?:\.\d+)?)s\):\s*(.*)/);
  if (match2) {
    return {
      start: parseFloat(match2[1]),
      end: parseFloat(match2[2]),
      text: match2[3],
      isComment: true,
    };
  }

  // Try format 3: "Xs to Ys:" (no text, expect sub-lines)
  const match3 = line.match(/^(\d+(?:\.\d+)?)s\s+to\s+(\d+(?:\.\d+)?)s:\s*$/);
  if (match3) {
    return {
      start: parseFloat(match3[1]),
      end: parseFloat(match3[2]),
      text: null,
      isComment: false,
      hasSubLines: true,
    };
  }

  return null;
}

function parseSubLine(line) {
  // Format: "  at Xs: text"
  const match = line.match(/^\s+at\s+(\d+(?:\.\d+)?)s:\s*(.*)/);
  if (match) {
    return {
      start: parseFloat(match[1]),
      text: match[2],
    };
  }
  return null;
}

function isNoiseFrame(text) {
  // Frame descriptions: drop if text contains "the frame is black"
  if (text.toLowerCase().includes("the frame is black")) return true;

  // Watermark artifacts: strip non-alphanumerics and check for beardbear/beardbea9/beardbeaя variants
  const stripped = text.replace(/[^a-z0-9]/gi, "").toLowerCase();
  if (
    stripped === "beardbear" ||
    stripped === "beardbea9" ||
    stripped === "beardbeaya" ||
    stripped === "beardbeaa"
  ) {
    return true;
  }

  return false;
}

function shouldTruncateAt(text) {
  // Check if this event contains the Boulder Badge marker
  const normalized = text.replace(/\s+/g, "").toLowerCase();
  return normalized.includes("boulderbadge");
}

function cleanTranscripts() {
  console.log("\n[Transcripts] Cleaning and parsing transcripts...");

  const transcriptItems = [];

  for (const dirName of PLAYTHROUGH_DIRS) {
    const dirPath = path.join(TRANSCRIPTS_DIR, dirName);

    if (!fs.existsSync(dirPath)) {
      console.warn(`  ! transcript dir not found: ${dirPath}`);
      continue;
    }

    const segmentFiles = fs
      .readdirSync(dirPath)
      .filter((f) => f.startsWith("segment_") && f.endsWith(".txt"))
      .sort((a, b) => {
        const numA = parseInt(a.match(/segment_(\d+)/)[1]);
        const numB = parseInt(b.match(/segment_(\d+)/)[1]);
        return numA - numB;
      });

    if (segmentFiles.length === 0) {
      console.warn(`  ! no segment files in ${dirPath}`);
      continue;
    }

    // Concatenate all segments
    let allText = "";
    for (const file of segmentFiles) {
      const content = fs.readFileSync(path.join(dirPath, file), "utf8");
      allText += content + "\n";
    }

    // Parse into events
    const events = [];
    const lines = allText.split("\n");
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];
      i++;

      // Skip empty lines and headers
      if (!line.trim() || line.trim() === "Breakdown:") continue;

      const event = parseTranscriptLine(line, 0);
      if (!event) continue;

      // Handle sub-lines (if hasSubLines is set)
      if (event.hasSubLines) {
        while (i < lines.length && lines[i].startsWith("  at ")) {
          const subLine = parseSubLine(lines[i]);
          i++;
          if (subLine) {
            events.push({
              start: subLine.start,
              end: event.end,
              text: subLine.text,
              isComment: false,
            });
          }
        }
      } else {
        // Normal event
        if (event.text !== null) {
          events.push({
            start: event.start,
            end: event.end,
            text: event.text,
            isComment: event.isComment,
          });
        }
      }
    }

    // Filter noise (frame descriptions only; keep commentary verbatim)
    let filteredEvents = events.filter((e) => {
      if (e.isComment) return true; // Keep all commentary
      return !isNoiseFrame(e.text);
    });

    // Truncate at Boulder Badge marker
    let cutMarker = null;
    for (let j = 0; j < filteredEvents.length; j++) {
      if (shouldTruncateAt(filteredEvents[j].text)) {
        cutMarker = filteredEvents[j].text;
        filteredEvents = filteredEvents.slice(0, j + 1);
        break;
      }
    }

    // Write transcript
    const outPath = path.join(OUT_DIR, "transcripts", `${dirName}.txt`);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });

    const lines2 = filteredEvents.map((e) => `[${e.start}s-${e.end}s] ${e.text}`);
    fs.writeFileSync(outPath, lines2.join("\n") + "\n");

    const relFile = path.relative(OUT_DIR, outPath);
    transcriptItems.push({
      type: "transcript",
      source: dirName,
      path: dirPath,
      file: relFile,
      events: filteredEvents.length,
      chars: filteredEvents.reduce((sum, e) => sum + e.text.length, 0),
      cutMarker,
    });

    console.log(`  ✓ ${dirName} (${filteredEvents.length} events, ${relFile})`);
  }

  return transcriptItems;
}

// --- Manifest & docs -------------------------------------------------------

async function generateManifest(wikiItems, transcriptItems) {
  console.log("\n[Manifest] Writing index.json...");

  const manifest = {
    note: "Walkthrough corpus (wiki scoped through Misty/Cascade Badge: Bulbapedia Parts 1-5 + StrategyWiki route/city + mechanic pages; transcripts truncated at Boulder Badge). Used for LLM finetuning.",
    generatedAt: new Date().toISOString(),
    items: [...wikiItems, ...transcriptItems],
  };

  const indexPath = path.join(OUT_DIR, "index.json");
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(indexPath, JSON.stringify(manifest, null, 2) + "\n");

  console.log(`  ✓ index.json (${wikiItems.length} wiki + ${transcriptItems.length} transcript items)`);
}

// --- Main ------------------------------------------------------------------

async function main() {
  const startTime = Date.now();

  console.log("=== Workstream A5: Walkthrough/wiki corpus ===");
  console.log(`Output: ${OUT_DIR}`);
  console.log(`URLs: ${URLS_PATH}`);
  console.log(`Transcripts: ${TRANSCRIPTS_DIR}`);

  const wikiItems = !cli.transcriptsOnly ? await fetchWiki() : [];
  const transcriptItems = !cli.wikiOnly ? cleanTranscripts() : [];

  if (!cli.wikiOnly && !cli.transcriptsOnly) {
    await generateManifest(wikiItems, transcriptItems);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\nDone in ${elapsed}s`);
}

main().catch((err) => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});
