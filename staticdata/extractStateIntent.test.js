// =============================================================================
// E2 state→intent generator self-test (offline; no API, no corpus).
// =============================================================================
//
//   node staticdata/extractStateIntent.test.js
//
// Verifies the pure offline logic: `buildWindows` (window size, stride,
// overlap, tail-clipping, counts) and `validateIntent` against the frozen D1
// schemas (each of the 5 tools: required fields present, enums honored, and
// rejection of malformed teacher output). Mirrors the hand-rolled `check`
// style used by the skills/ and gamestate/ self-tests.
// =============================================================================

import { buildWindows, validateIntent } from "./extractStateIntent.js";

let passed = 0;
let failed = 0;
function check(name, cond, detail = "") {
    if (cond) {
        passed++;
    } else {
        failed++;
        console.log(`  FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
    }
}

function ev(start, end, text) {
    return { start, end, text };
}

// --- buildWindows -----------------------------------------------------------
{
    const events = Array.from({ length: 10 }, (_, i) => ev(i, i + 1, `frame ${i}`));

    // window=6 stride=3 over 10 events: starts 0,3,6 -> last full-ish window
    // begins at 6 with 4 events (>=2 so kept). starts 0,3,6 -> 3 windows.
    const w = buildWindows(events, 6, 3);
    check("window=6 stride=3 over 10 events -> 3 windows", w.length === 3, `got ${w.length}`);
    check("first window starts at index 0", w[0].startIndex === 0);
    check("first window has 6 events", w[0].events.length === 6);
    check("second window starts at index 3", w[1].startIndex === 3);
    check("window overlap: second window first frame is frame 3", w[1].events[0].text === "frame 3");
    check("last window starts at index 6", w[2].startIndex === 6);
    check("last window clipped to remaining 4 events", w[2].events.length === 4);
    check("windowStart = first event start", w[0].windowStart === 0);
    check("windowEnd = last event end", w[0].windowEnd === 6);

    // Non-overlapping (stride == window): starts 0,6 -> 2 windows (index 6 has 4 events).
    const w2 = buildWindows(events, 6, 6);
    check("window=6 stride=6 -> 2 windows", w2.length === 2, `got ${w2.length}`);

    // Stride > window leaves gaps but still walks.
    const w3 = buildWindows(events, 3, 5);
    check("window=3 stride=5 -> 2 windows (starts 0,5)", w3.length === 2, `got ${w3.length}`);

    // Tail with < 2 events is dropped: 11 events -> starts 0..9 (slice 9.. has 2),
    // 12 -> starts 0..9 (slice 9 has 3? no). Use a case where the very last partial
    // window would have only 1 event.
    const tail = Array.from({ length: 7 }, (_, i) => ev(i, i + 1, `f${i}`));
    const wt = buildWindows(tail, 3, 3); // starts 0,3,6 -> at 6 slice has 1 event -> dropped
    check("tail window with <2 events is dropped", wt.length === 2, `got ${wt.length}`);

    // Degenerate inputs.
    check("empty events -> no windows", buildWindows([], 6, 3).length === 0);
    check("single event -> no windows", buildWindows([ev(0, 1, "only")], 6, 3).length === 0);
}

// --- validateIntent: goto ---------------------------------------------------
{
    check("goto: named location ok", validateIntent({ name: "goto", args: { destination: { location: "Pewter City" } } }).ok);
    check("goto: coords ok", validateIntent({ name: "goto", args: { destination: { x: 3, y: 4 } } }).ok);
    check("goto: coords + map ok", validateIntent({ name: "goto", args: { destination: { map: "PALLET_TOWN", x: 0, y: 0 } } }).ok);
    check("goto: avoid_trainers optional ok", validateIntent({ name: "goto", args: { destination: { location: "Viridian Mart" }, avoid_trainers: false } }).ok);
    check("goto: missing destination rejected", !validateIntent({ name: "goto", args: {} }).ok);
    check("goto: destination with neither loc nor xy rejected", !validateIntent({ name: "goto", args: { destination: { foo: 1 } } }).ok);
    check("goto: destination not object rejected", !validateIntent({ name: "goto", args: { destination: "Pewter" } }).ok);
}

// --- validateIntent: set_battle_strategy -----------------------------------
{
    check("sbs: valid strategy ok", validateIntent({ name: "set_battle_strategy", args: { strategy: "type_effective" } }).ok);
    check("sbs: with lead + catch_all_pokemon ok", validateIntent({ name: "set_battle_strategy", args: { strategy: "flee", lead: "Charmander", catch_all_pokemon: true } }).ok);
    check("sbs: missing strategy rejected", !validateIntent({ name: "set_battle_strategy", args: {} }).ok);
    check("sbs: bad strategy enum rejected", !validateIntent({ name: "set_battle_strategy", args: { strategy: "ultra_damage" } }).ok);
}

// --- validateIntent: heal ---------------------------------------------------
{
    check("heal: no args ok", validateIntent({ name: "heal", args: {} }).ok);
    check("heal: method=items ok", validateIntent({ name: "heal", args: { method: "items" } }).ok);
    check("heal: bad method rejected", !validateIntent({ name: "heal", args: { method: "sleep" } }).ok);
}

// --- validateIntent: use_item -----------------------------------------------
{
    check("use_item: item ok", validateIntent({ name: "use_item", args: { item: "Potion" } }).ok);
    check("use_item: item + target_slot + quantity ok", validateIntent({ name: "use_item", args: { item: "Poke Ball", target_slot: 0, quantity: 5 } }).ok);
    check("use_item: missing item rejected", !validateIntent({ name: "use_item", args: {} }).ok);
    check("use_item: empty item rejected", !validateIntent({ name: "use_item", args: { item: "" } }).ok);
    check("use_item: target_slot out of range rejected", !validateIntent({ name: "use_item", args: { item: "Potion", target_slot: 9 } }).ok);
    check("use_item: quantity out of range rejected", !validateIntent({ name: "use_item", args: { item: "Potion", quantity: 100 } }).ok);
}

// --- validateIntent: press --------------------------------------------------
{
    check("press: single button ok", validateIntent({ name: "press", args: { buttons: ["a"] } }).ok);
    check("press: sequence ok", validateIntent({ name: "press", args: { buttons: ["up", "up", "a"] } }).ok);
    check("press: missing buttons rejected", !validateIntent({ name: "press", args: {} }).ok);
    check("press: empty array rejected", !validateIntent({ name: "press", args: { buttons: [] } }).ok);
    check("press: bad button enum rejected", !validateIntent({ name: "press", args: { buttons: ["x"] } }).ok);
    check("press: >32 buttons rejected", !validateIntent({ name: "press", args: { buttons: Array(33).fill("a") } }).ok);
}

// --- validateIntent: general shape ------------------------------------------
{
    check("unknown tool rejected", !validateIntent({ name: "fly", args: {} }).ok);
    check("non-object intent rejected", !validateIntent("goto").ok);
    check("args not an object rejected", !validateIntent({ name: "goto", args: [] }).ok);
    check("null intent rejected", !validateIntent(null).ok);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
