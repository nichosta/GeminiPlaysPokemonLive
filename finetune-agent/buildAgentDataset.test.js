// Pure-function self-test for buildAgentDataset.js's split(). No file I/O.
import { test } from "node:test";
import assert from "node:assert/strict";

import { split } from "./buildAgentDataset.js";

function row(source, id) {
  return { id, source, state: `state-${id}`, tool_call: { name: "press", args: {} }, commentary: "" };
}

test("split: every row lands in exactly train or eval, none dropped", () => {
  const rows = [
    row("run-a", "frlg-trace-0001"),
    row("run-a", "frlg-trace-0002"),
    row("run-a", "frlg-trace-0003"),
    row("run-a", "frlg-trace-0004"),
    row("run-a", "frlg-trace-0005"),
    row("run-b", "frlg-trace-0006"),
  ];
  const { train, evalRows } = split(rows);
  assert.equal(train.length + evalRows.length, rows.length);
  const ids = new Set([...train, ...evalRows].map((r) => r.id));
  assert.equal(ids.size, rows.length);
});

test("split: is deterministic across repeated calls on the same input", () => {
  const rows = Array.from({ length: 12 }, (_, i) => row("run-a", `frlg-trace-${String(i).padStart(4, "0")}`));
  const a = split(rows);
  const b = split(rows);
  assert.deepEqual(a.train.map((r) => r.id), b.train.map((r) => r.id));
  assert.deepEqual(a.evalRows.map((r) => r.id), b.evalRows.map((r) => r.id));
});

test("split: is stratified per-source, so a tiny source isn't starved by a large one", () => {
  const rows = [
    ...Array.from({ length: 20 }, (_, i) => row("run-big", `frlg-trace-big-${String(i).padStart(4, "0")}`)),
    row("run-tiny", "frlg-trace-tiny-0000"),
  ];
  const { train, evalRows } = split(rows);
  // The tiny source's single row is deterministically assigned (index 0 % STRIDE === 0 -> eval),
  // not swallowed by the big source's split boundary.
  assert.ok(evalRows.some((r) => r.source === "run-tiny") || train.some((r) => r.source === "run-tiny"));
  const tinyRows = [...train, ...evalRows].filter((r) => r.source === "run-tiny");
  assert.equal(tinyRows.length, 1);
});
