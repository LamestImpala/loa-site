// node --test lib/
import { test } from "node:test";
import assert from "node:assert/strict";
import { planImport } from "./discogs-import.ts";

const copy = (instance_id: number, release_id: number, date_added?: string) => ({
  instance_id,
  release_id,
  date_added,
});

test("a copy whose release is not in Stock is imported", () => {
  const plan = planImport([copy(1, 100)], [], []);
  assert.deepEqual(plan.toImport.map((c) => c.instance_id), [1]);
  assert.deepEqual(plan.matched, []);
});

test("a copy whose release is already in Stock is matched, not imported", () => {
  const plan = planImport([copy(1, 100)], [], [100]);
  assert.deepEqual(plan.toImport, []);
  assert.deepEqual(plan.matched.map((c) => c.instance_id), [1]);
});

test("a second copy of a release in Stock is imported; the older copy is the match", () => {
  const plan = planImport(
    [copy(2, 100, "2026-11-20T00:00:00-08:00"), copy(1, 100, "2025-01-01T00:00:00-08:00")],
    [],
    [100]
  );
  assert.deepEqual(plan.matched.map((c) => c.instance_id), [1]);
  assert.deepEqual(plan.toImport.map((c) => c.instance_id), [2]);
});

test("a copy seen before is left alone, and its record is not paired twice", () => {
  // Record for release 100 was imported from instance 1; instance 2 is new.
  const plan = planImport([copy(1, 100), copy(2, 100)], [1], [100]);
  assert.deepEqual(plan.matched, []);
  assert.deepEqual(plan.toImport.map((c) => c.instance_id), [2]);
});

test("a deleted draft is not imported again", () => {
  const plan = planImport([copy(1, 100)], [1], []);
  assert.deepEqual(plan, { matched: [], toImport: [] });
});

test("imports come oldest first", () => {
  const plan = planImport(
    [copy(3, 300, "2026-03-01T00:00:00Z"), copy(1, 100, "2026-01-01T00:00:00Z"), copy(2, 200)],
    [],
    []
  );
  assert.deepEqual(plan.toImport.map((c) => c.instance_id), [2, 1, 3]);
});
