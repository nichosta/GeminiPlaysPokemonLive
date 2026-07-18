// =============================================================================
// D4 eval harness self-test (offline, checked-in milestone data; no emulator)
// =============================================================================
//
//   node skills/evalHarness.test.js
//
// Verifies, with an injected fake readFlag/saveState/clock/readFrame:
//   - the flag-name set covers every milestone's completion + side +
//     item-resolvesTo flags;
//   - readFlagSet swallows a single throwing flag read;
//   - milestone savestates are written exactly once, in story order, as the
//     relevant flags turn set — including the item-tracked parcel (no flag of
//     its own → checkpoints via its resolvesTo flag alongside got_pokedex);
//   - any-mode starter-variant battles checkpoint on any ONE variant;
//   - optional milestones checkpoint too (E3 coverage from side beats);
//   - a savestate write failure is swallowed: no throw, milestone NOT marked
//     checkpointed, retries next poll;
//   - the story DAG gates out-of-order flags (badge set without prereqs does
//     NOT checkpoint the terminal beat);
//   - the terminal milestone finalizes + writes the benchmark report;
//   - benchmark timing: turns/steps/crossings/elapsed frame and report shape;
//   - report builder + validator + JSON round-trip;
//   - closed harness drops further updates;
//   - the savestate transport URL builders carry the right path/slot/flags.
// =============================================================================

import { promises as fs } from "fs";
import path from "path";
import {
    EvalHarness,
    EVAL_SCHEMA_VERSION,
    TERMINAL_MILESTONE,
    allMilestoneFlagNames,
    readFlagSet,
    saveStateFile,
    loadStateFile,
    saveStateSlot,
    loadStateSlot,
    checkpointPath,
    makeBenchmarkReport,
    isValidBenchmarkReport,
    SAVESTATE_FLAGS_SAVE,
    SAVESTATE_FLAGS_LOAD,
} from "./evalHarness.js";
import { milestones, flagBit, resolveMilestone } from "./milestones.js";

let passed = 0;
let failed = 0;
function check(name, cond, detail = "") {
    if (cond) {
        passed++;
        console.log(`  ok   ${name}`);
    } else {
        failed++;
        console.error(`  FAIL ${name} ${detail}`);
    }
}

// --- a fake harness factory --------------------------------------------------
// readFlag is backed by a Set<number> of set bit-offsets; setFlag(name) adds
// the resolved bit-offset for a flag name. clock + readFrame are tick counters
// advanced manually so timings are deterministic.
function makeFakeHarness({ checkpointDir = "/tmp/eval-test-checkpoints", throwOnPath = null } = {}) {
    const setBits = new Set();
    const saved = []; // absPaths written, in order
    let ticks = 0;
    let frames = 0;
    // throwOnPath simulates a TRANSIENT save failure: it throws the first time
    // that path is written, then succeeds on retry (so the harness's "don't
    // mark checkpointed → retry next poll" path is exercisable).
    const thrownOnce = new Set();
    const harness = new EvalHarness({
        checkpointDir,
        reportPath: null, // tests inspect report() directly unless noted
        readFlag: async (bit) => setBits.has(bit),
        saveState: async (absPath) => {
            if (throwOnPath && absPath === throwOnPath && !thrownOnce.has(absPath)) {
                thrownOnce.add(absPath);
                throw new Error(`simulated save failure for ${absPath}`);
            }
            saved.push(absPath);
        },
        clock: () => ticks,
        readFrame: async () => frames,
    });
    function setFlag(name) {
        const bit = flagBit(name);
        if (bit === undefined) throw new Error(`unknown flag ${name}`);
        setBits.add(bit);
    }
    function setFlags(...names) { names.forEach(setFlag); }
    function advance(ms = 1, fr = 1) { ticks += ms; frames += fr; }
    return { harness, setFlag, setFlags, saved, setBits, advance, get ticks() { return ticks; }, get frames() { return frames; } };
}

// =============================================================================
// 1. Flag-name set completeness
// =============================================================================
{
    const names = new Set(allMilestoneFlagNames());
    check("flagNames: non-empty", names.size > 0);
    check("flagNames: FLAG_SYS_POKEMON_GET (chose_starter)", names.has("FLAG_SYS_POKEMON_GET"));
    check("flagNames: FLAG_BEAT_RIVAL_IN_OAKS_LAB (rival lab, dedicated)", names.has("FLAG_BEAT_RIVAL_IN_OAKS_LAB"));
    check("flagNames: a rival starter variant", names.has("FLAG_DEFEATED_TRAINER_RIVAL_OAKS_LAB_SQUIRTLE"));
    check("flagNames: FLAG_SYS_POKEDEX_GET (pokedex + parcel resolvesTo)", names.has("FLAG_SYS_POKEDEX_GET"));
    check("flagNames: FLAG_DEFEATED_BROCK (brock dedicated)", names.has("FLAG_DEFEATED_BROCK"));
    check("flagNames: FLAG_BADGE01_GET (terminal badge)", names.has("FLAG_BADGE01_GET"));
    check("flagNames: optional route22 variant", names.has("FLAG_DEFEATED_TRAINER_RIVAL_ROUTE22_EARLY_SQUIRTLE"));
    check("flagNames: optional pokeball topup", names.has("FLAG_GOT_POKEBALLS_FROM_OAK_AFTER_22_RIVAL"));
    check("flagNames: chose_starter sideFlag present", names.has("FLAG_PALLET_LADY_NOT_BLOCKING_SIGN"));
}

// =============================================================================
// 2. readFlagSet + error isolation on a throwing flag read
// =============================================================================
{
    const allNames = allMilestoneFlagNames();
    const goodName = "FLAG_SYS_POKEMON_GET";
    const badName = allNames.find((n) => n !== goodName);
    const setBits = new Set([flagBit(goodName)]);
    // readFlag throws for the bad bit but reads the good bit fine.
    const readFlag = async (bit) => {
        if (bit === flagBit(badName)) throw new Error("boom");
        return setBits.has(bit);
    };
    const set = await readFlagSet(readFlag);
    check("readFlagSet: good flag survives a throwing sibling", set.has(goodName));
    check("readFlagSet: throwing flag did not crash the read", !set.has(badName));
}

// =============================================================================
// 3. Full story sequencing — checkpoints written once, in order
// =============================================================================
{
    const { harness, setFlags, saved } = makeFakeHarness();
    await harness.start({ runId: "test-run", model: "test-model" });

    let r;

    r = await harness.update(null);
    check("seq: no checkpoints at start", r.newCheckpoints.length === 0);

    setFlags("FLAG_SYS_POKEMON_GET");
    r = await harness.update(null);
    check("seq: chose_starter checkpointed", r.newCheckpoints[0]?.id === "chose_starter");
    check("seq: path = dir/<id>.ss", r.newCheckpoints[0]?.path.endsWith("chose_starter.ss"));

    setFlags("FLAG_BEAT_RIVAL_IN_OAKS_LAB");
    r = await harness.update(null);
    check("seq: beat_rival_oaks_lab checkpointed", r.newCheckpoints[0]?.id === "beat_rival_oaks_lab");

    // Setting the Pokédex flag completes BOTH got_oaks_parcel (no flag of its
    // own → resolvesTo FLAG_SYS_POKEDEX_GET) and got_pokedex at once.
    setFlags("FLAG_SYS_POKEDEX_GET");
    r = await harness.update(null);
    check("seq: got_oaks_parcel + got_pokedex checkpointed together",
        r.newCheckpoints.map((c) => c.id).join(",") === "got_oaks_parcel,got_pokedex",
        `got ${r.newCheckpoints.map((c) => c.id).join(",")}`);

    setFlags("FLAG_DEFEATED_BROCK");
    r = await harness.update(null);
    check("seq: defeated_brock checkpointed", r.newCheckpoints[0]?.id === "defeated_brock");

    setFlags("FLAG_BADGE01_GET");
    r = await harness.update(null);
    check("seq: got_boulder_badge checkpointed", r.newCheckpoints[0]?.id === "got_boulder_badge");
    check("seq: terminal reached on badge", r.terminal === true);
    check("seq: progress 1.0 at terminal", r.progress === 1);

    // Idempotent: re-poll with no new flags → nothing new written.
    const before = saved.length;
    r = await harness.update(null);
    check("seq: idempotent — no new checkpoints on re-poll", r.newCheckpoints.length === 0);
    check("seq: idempotent — no new savestate writes", saved.length === before);

    // Exactly one savestate per milestone, in story order.
    const expected = ["chose_starter", "beat_rival_oaks_lab", "got_oaks_parcel", "got_pokedex", "defeated_brock", "got_boulder_badge"];
    const writtenIds = saved.map((p) => path.basename(p, ".ss"));
    check("seq: 6 savestates total", saved.length === 6, `got ${saved.length}`);
    check("seq: savestates in story order", writtenIds.join(",") === expected.join(","),
        `got ${writtenIds.join(",")}`);
}

// =============================================================================
// 4. any-mode starter variants — each single variant completes the beat
// =============================================================================
{
    for (const variant of [
        "FLAG_DEFEATED_TRAINER_RIVAL_OAKS_LAB_SQUIRTLE",
        "FLAG_DEFEATED_TRAINER_RIVAL_OAKS_LAB_BULBASAUR",
        "FLAG_DEFEATED_TRAINER_RIVAL_OAKS_LAB_CHARMANDER",
    ]) {
        const { harness, setFlags } = makeFakeHarness();
        await harness.start();
        setFlags("FLAG_SYS_POKEMON_GET"); // prereq
        await harness.update(null);
        setFlags(variant);
        const r = await harness.update(null);
        check(`any-mode: ${variant} → beat_rival_oaks_lab checkpointed`,
            r.newCheckpoints.some((c) => c.id === "beat_rival_oaks_lab"),
            `got ${r.newCheckpoints.map((c) => c.id).join(",")}`);
    }
}

// =============================================================================
// 5. Optional milestones checkpoint (E3 coverage from side beats)
// =============================================================================
{
    const { harness, setFlags } = makeFakeHarness();
    await harness.start();
    setFlags("FLAG_SYS_POKEMON_GET", "FLAG_BEAT_RIVAL_IN_OAKS_LAB", "FLAG_SYS_POKEDEX_GET");
    await harness.update(null); // through got_pokedex

    // Optional: Route 22 rival (one variant) + the Oak ball top-up.
    setFlags("FLAG_DEFEATED_TRAINER_RIVAL_ROUTE22_EARLY_SQUIRTLE",
        "FLAG_GOT_POKEBALLS_FROM_OAK_AFTER_22_RIVAL");
    const r = await harness.update(null);
    const ids = new Set(r.newCheckpoints.map((c) => c.id));
    check("optional: route22 rival checkpointed", ids.has("beat_route22_rival"));
    check("optional: pokeball topup checkpointed", ids.has("got_pokeballs_topup"));
}

// =============================================================================
// 6. all-mode — chose_starter needs its single flag
// =============================================================================
{
    const { harness, setFlags } = makeFakeHarness();
    await harness.start();
    let r = await harness.update(null);
    check("all-mode: chose_starter not complete with no flags", r.newCheckpoints.length === 0);
    setFlags("FLAG_SYS_POKEMON_GET");
    r = await harness.update(null);
    check("all-mode: chose_starter complete with its flag", r.newCheckpoints[0]?.id === "chose_starter");
}

// =============================================================================
// 7. Out-of-order — badge without prereqs does NOT checkpoint the terminal
// =============================================================================
{
    const { harness, setFlags, saved } = makeFakeHarness();
    await harness.start();
    setFlags("FLAG_BADGE01_GET"); // terminal flag, but no prereqs
    const r = await harness.update(null);
    check("ofo: no checkpoints with only the badge flag", r.newCheckpoints.length === 0);
    check("ofo: not terminal", r.terminal === false);
    check("ofo: reached is null (prereqs not done)", r.reached === null);
    check("ofo: no savestate written", saved.length === 0);
}

// =============================================================================
// 8. Savestate write failure is swallowed — not marked, retries next poll
// =============================================================================
{
    const dir = "/tmp/eval-test-throw";
    const badPath = path.join(dir, "got_oaks_parcel.ss");
    const { harness, setFlags, saved } = makeFakeHarness({ checkpointDir: dir, throwOnPath: badPath });
    // Silence the expected console.error so test output stays clean.
    const origErr = console.error;
    console.error = () => {};
    try {
        await harness.start();
        setFlags("FLAG_SYS_POKEMON_GET", "FLAG_BEAT_RIVAL_IN_OAKS_LAB", "FLAG_SYS_POKEDEX_GET");
        const r = await harness.update(null);
        // got_oaks_parcel save throws → skipped; got_pokedex still writes.
        const ids = r.newCheckpoints.map((c) => c.id);
        check("fail: got_pokedex still checkpointed despite parcel throw", ids.includes("got_pokedex"));
        check("fail: got_oaks_parcel NOT in newCheckpoints (save threw)", !ids.includes("got_oaks_parcel"));
        check("fail: update did not throw", true);
    } finally {
        console.error = origErr;
    }
    check("fail: no parcel savestate on disk", !saved.includes(badPath));

    // Retry: a working save on the next poll checkpoints the parcel.
    const r2 = await harness.update(null);
    check("fail: parcel retries + checkpoints on next poll", r2.newCheckpoints.some((c) => c.id === "got_oaks_parcel"));
}

// =============================================================================
// 9. Benchmark timing — turns/steps/crossings/elapsed + report shape
// =============================================================================
{
    const { harness, setFlags, advance } = makeFakeHarness();
    await harness.start({ runId: "bm-run", model: "bm-model" });
    const startedAt = harness._startedAtMs;
    const startFrame = harness._startFrame;
    check("bench: start stamps time", typeof startedAt === "number");
    check("bench: start stamps frame", typeof startFrame === "number");

    // 3 model turns, 7 tool-steps.
    harness.markTurn();
    advance(10, 100);
    harness.markTurn();
    advance(10, 100);
    harness.markTurn();
    harness.markSteps(7);

    setFlags("FLAG_SYS_POKEMON_GET");
    advance(5, 50);
    const r = await harness.update(null);
    check("bench: crossing recorded for chose_starter", r.newCheckpoints[0]?.id === "chose_starter");
    const crossing = harness._crossings.get("chose_starter");
    check("bench: crossing turn = 3 (after 3 markTurns)", crossing.turn === 3, `got ${crossing.turn}`);
    check("bench: crossing frame advanced", crossing.frame > startFrame);

    const report = harness.report();
    check("bench: report turns = 3", report.turns === 3);
    check("bench: report steps = 7", report.steps === 7);
    check("bench: report reached = chose_starter", report.reached_milestone === "chose_starter");
    check("bench: report not terminal yet", report.terminal === false);
    check("bench: report milestones includes the crossing", report.milestones.some((m) => m.id === "chose_starter"));
    check("bench: report progress > 0", report.progress > 0);
    // elapsed_ms is null until finished_at_ms is set (close/terminal).
    check("bench: elapsed_ms null before finish", report.elapsed_ms === null);
}

// =============================================================================
// 10. makeBenchmarkReport + validator + JSON round-trip
// =============================================================================
{
    const crossings = new Map([
        ["chose_starter", { atMs: 100, turn: 1, frame: 60 }],
        ["got_pokedex", { atMs: 500, turn: 9, frame: 540 }],
    ]);
    const report = makeBenchmarkReport({
        runId: "r1",
        model: "m1",
        startedAtMs: 0,
        finishedAtMs: 1000,
        turns: 9,
        steps: 23,
        startFrame: 0,
        endFrame: 6000,
        reached: "got_pokedex",
        terminal: false,
        progress: 0.5,
        crossings,
        finalStateSummary: { map: "MAP_PALLET_TOWN" },
        note: "test",
    });
    check("report: schema_version stamped", report.schema_version === EVAL_SCHEMA_VERSION);
    check("report: elapsed_ms = finished - started", report.elapsed_ms === 1000);
    check("report: frames = end - start", report.frames === 6000);
    check("report: milestones in story order (chose_starter before got_pokedex)",
        report.milestones[0].id === "chose_starter" && report.milestones[1].id === "got_pokedex");
    check("report: final_state carried", report.final_state?.map === "MAP_PALLET_TOWN");
    check("report: note carried", report.note === "test");
    check("report: validator accepts well-formed", isValidBenchmarkReport(report));

    // JSON round-trip preserves validity.
    check("report: JSON round-trip preserves validity",
        isValidBenchmarkReport(JSON.parse(JSON.stringify(report))));

    // Corrupt shapes rejected.
    check("report: rejects null", !isValidBenchmarkReport(null));
    check("report: rejects wrong schema_version",
        !isValidBenchmarkReport({ ...report, schema_version: "eval/9.9" }));
    check("report: rejects non-number turns",
        !isValidBenchmarkReport({ ...report, turns: "3" }));
    check("report: rejects non-boolean terminal",
        !isValidBenchmarkReport({ ...report, terminal: "yes" }));
    check("report: rejects non-array milestones",
        !isValidBenchmarkReport({ ...report, milestones: {} }));
}

// =============================================================================
// 11. Closed harness drops further updates + finalizes a report
// =============================================================================
{
    const tmp = path.join(process.cwd(), "tmp-eval-test-report.json");
    const { harness, setFlags } = makeFakeHarness();
    harness.reportPath = tmp;
    await harness.start({ runId: "close-run", model: "m" });
    setFlags("FLAG_SYS_POKEMON_GET");
    let r = await harness.update(null);
    check("closed: pre-close update checkpoints normally", r.newCheckpoints.length === 1);

    const report = await harness.close();
    check("closed: close returns a valid report", isValidBenchmarkReport(report));
    let onDiskOk = false;
    try { await fs.access(tmp); onDiskOk = true; } catch { onDiskOk = false; }
    check("closed: report written to disk", onDiskOk);
    const onDisk = JSON.parse(await fs.readFile(tmp, "utf8"));
    check("closed: on-disk report is valid", isValidBenchmarkReport(onDisk));
    check("closed: on-disk report carries run id", onDisk.run_id === "close-run");

    // After close, update drops.
    setFlags("FLAG_BEAT_RIVAL_IN_OAKS_LAB");
    r = await harness.update(null);
    check("closed: post-close update drops new checkpoints", r.newCheckpoints.length === 0);
    harness.markTurn(); // no-op after close (checked via not throwing)
    check("closed: markTurn after close is a no-op (no throw)", harness.report().turns === 1);

    await fs.unlink(tmp).catch(() => {});
}

// =============================================================================
// 12. Benchmark-only mode (no checkpointDir) tracks crossings without writing
// =============================================================================
{
    const { harness, setFlags, saved } = makeFakeHarness({ checkpointDir: undefined });
    // checkpointDir undefined → constructor sets null. Bypass the factory default:
    harness.checkpointDir = null;
    await harness.start();
    setFlags("FLAG_SYS_POKEMON_GET");
    const r = await harness.update(null);
    check("bench-only: crossing recorded without a dir", r.newCheckpoints[0]?.id === "chose_starter");
    check("bench-only: crossing path is null (no file)", r.newCheckpoints[0]?.path === null);
    check("bench-only: no savestate written", saved.length === 0);
    check("bench-only: crossing still tracked", harness._crossings.has("chose_starter"));
}

// =============================================================================
// 13. Savestate transport URL builders (path/slot + flags)
// =============================================================================
{
    const calls = [];
    const fakeIo = { post: async (url) => { calls.push(url); } };

    await saveStateFile("/abs/path/mine.ss", fakeIo);
    check("transport: saveStateFile hits /core/savestatefile", calls[0].includes("/core/savestatefile"));
    check("transport: saveStateFile encodes path", calls[0].includes(encodeURIComponent("/abs/path/mine.ss")));
    check("transport: saveStateFile flags = 31 (ALL)", calls[0].includes(`flags=${SAVESTATE_FLAGS_SAVE}`));

    await loadStateFile("/abs/path/mine.ss", fakeIo);
    check("transport: loadStateFile hits /core/loadstatefile", calls[1].includes("/core/loadstatefile"));
    check("transport: loadStateFile flags = 29", calls[1].includes(`flags=${SAVESTATE_FLAGS_LOAD}`));

    await saveStateSlot(3, fakeIo);
    check("transport: saveStateSlot hits /core/savestateslot", calls[2].includes("/core/savestateslot"));
    check("transport: saveStateSlot slot=3", calls[2].includes("slot=3"));

    await loadStateSlot(3, fakeIo);
    check("transport: loadStateSlot hits /core/loadstateslot", calls[3].includes("/core/loadstateslot"));
}

// =============================================================================
// 14. checkpointPath resolves by id / name / alias, unknown → null
// =============================================================================
{
    const dir = "/tmp/eval-cp";
    check("cpPath: by id", checkpointPath(dir, "got_boulder_badge")?.endsWith("got_boulder_badge.ss"));
    check("cpPath: by name (case-insensitive)", checkpointPath(dir, "Received Boulder Badge")?.endsWith("got_boulder_badge.ss"));
    check("cpPath: unknown → null", checkpointPath(dir, "nope") === null);
}

// =============================================================================
// 15. Terminal milestone + report path written on disk
// =============================================================================
{
    const tmp = path.join(process.cwd(), "tmp-eval-terminal-report.json");
    const dir = path.join(process.cwd(), "tmp-eval-terminal-checkpoints");
    const { harness, setFlags } = makeFakeHarness({ checkpointDir: dir });
    harness.reportPath = tmp;
    await harness.start({ runId: "term-run", model: "m" });
    setFlags(
        "FLAG_SYS_POKEMON_GET",
        "FLAG_BEAT_RIVAL_IN_OAKS_LAB",
        "FLAG_SYS_POKEDEX_GET",
        "FLAG_DEFEATED_BROCK",
        "FLAG_BADGE01_GET",
    );
    const r = await harness.update(null);
    check("terminal: terminal=true on boulder badge", r.terminal === true);
    check("terminal: reached terminal id", r.reached === TERMINAL_MILESTONE);
    const onDisk = JSON.parse(await fs.readFile(tmp, "utf8"));
    check("terminal: report on disk is valid", isValidBenchmarkReport(onDisk));
    check("terminal: on-disk report terminal=true", onDisk.terminal === true);
    check("terminal: on-disk report reached terminal beat", onDisk.reached_milestone === "got_boulder_badge");
    check("terminal: elapsed_ms set on finish", typeof onDisk.elapsed_ms === "number");
    // cleanup
    await fs.unlink(tmp).catch(() => {});
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
