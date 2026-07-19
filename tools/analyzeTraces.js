// =============================================================================
// TRACE ANALYZER — manual-input vs harness-utility usage per run
// =============================================================================
//
//   node tools/analyzeTraces.js [traces/trace-run-xxxx.jsonl ...]
//
// No args: analyzes every traces/*.jsonl, newest last. Reads the D3 trace
// records (one JSON object per line, see llminteract/traceLogger.js) and
// reports, per run:
//   - tool-call mix (counts + share), escape-hatch (press) share
//   - manual-battle indicator: longest/total consecutive-press streaks
//   - outcome status mix per tool (ok / interrupted / failed / budget)
//   - steps executed by the harness vs model turns spent
//   - story-progress transitions ("Story:" line of state_before) with the
//     turn number where each new stage first appears
//
// Motivation (run-improvement-log.md): every press turn costs a full LLM
// round-trip; the point of the macro tools is to keep that number near zero.
// This makes the drift measurable so fixes can be verified instead of eyeballed.
// =============================================================================

import { readFileSync, readdirSync } from "fs";
import { join, basename } from "path";

const files = process.argv.slice(2).length > 0
    ? process.argv.slice(2)
    : readdirSync("traces")
        .filter((f) => f.endsWith(".jsonl"))
        .sort()
        .map((f) => join("traces", f));

function pct(n, d) {
    return d > 0 ? ((100 * n) / d).toFixed(1) + "%" : "-";
}

for (const file of files) {
    let lines;
    try {
        lines = readFileSync(file, "utf8").split("\n").filter(Boolean);
    } catch (e) {
        console.error(`skip ${file}: ${e.message}`);
        continue;
    }
    const records = [];
    for (const line of lines) {
        try { records.push(JSON.parse(line)); } catch { /* torn line (live run) */ }
    }
    if (records.length === 0) continue;

    const byTool = new Map(); // name -> { calls, statuses: Map, steps }
    let escapeHatch = 0;
    let pressStreak = 0;
    let longestPressStreak = 0;
    let pressStreakTurns = 0; // turns spent inside streaks of >= 3 (mashing)
    let curStreakLen = 0;
    let totalSteps = 0;
    const storyTransitions = []; // { turn, stage }
    let lastStage = null;

    for (const r of records) {
        const name = r.tool_call?.name ?? "(none)";
        const t = byTool.get(name) ?? { calls: 0, statuses: new Map(), steps: 0 };
        t.calls++;
        const status = r.outcome?.status ?? "(none)";
        t.statuses.set(status, (t.statuses.get(status) ?? 0) + 1);
        t.steps += r.outcome?.steps_used ?? 0;
        byTool.set(name, t);
        totalSteps += r.outcome?.steps_used ?? 0;
        if (r.is_escape_hatch || name === "press") {
            escapeHatch++;
            curStreakLen++;
            longestPressStreak = Math.max(longestPressStreak, curStreakLen);
            if (curStreakLen === 3) pressStreakTurns += 3;
            else if (curStreakLen > 3) pressStreakTurns++;
        } else {
            curStreakLen = 0;
        }
        const stage = /Story: ([^\n]+)/.exec(r.state_before ?? "")?.[1] ?? null;
        if (stage && stage !== lastStage) {
            storyTransitions.push({ turn: r.turn, stage });
            lastStage = stage;
        }
    }

    const turns = records.length;
    console.log(`\n=== ${basename(file)} — ${turns} model turns, ${totalSteps} harness steps ===`);
    console.log(`escape-hatch (press) share: ${escapeHatch}/${turns} (${pct(escapeHatch, turns)}) | longest press streak: ${longestPressStreak} | turns in mash-streaks (>=3): ${pressStreakTurns} (${pct(pressStreakTurns, turns)})`);
    const sorted = [...byTool.entries()].sort((a, b) => b[1].calls - a[1].calls);
    for (const [name, t] of sorted) {
        const st = [...t.statuses.entries()].map(([s, c]) => `${s}:${c}`).join(" ");
        console.log(`  ${name.padEnd(20)} ${String(t.calls).padStart(4)} calls (${pct(t.calls, turns).padStart(6)})  steps ${String(t.steps).padStart(5)}  [${st}]`);
    }
    if (storyTransitions.length > 0) {
        console.log("  story progress:");
        for (const s of storyTransitions) console.log(`    turn ${String(s.turn).padStart(4)}: ${s.stage}`);
    }
}
