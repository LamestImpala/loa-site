// node --test lib/
import { test } from "node:test";
import assert from "node:assert/strict";
import { pregameEvents } from "./pickem.ts";

const NOW = new Date("2026-10-03T20:00:00Z");

function ev(id: string, commence_time: string) {
  return { id, commence_time };
}

test("pregameEvents keeps only games that have not kicked off", () => {
  const events = [
    ev("live", "2026-10-03T17:00:00Z"),
    ev("kicking-now", "2026-10-03T20:00:00Z"),
    ev("soon", "2026-10-03T20:00:01Z"),
    ev("tonight", "2026-10-03T23:30:00Z"),
  ];
  assert.deepEqual(pregameEvents(events, NOW).map((e) => e.id), ["soon", "tonight"]);
});

test("pregameEvents on an all-live feed returns nothing", () => {
  assert.deepEqual(pregameEvents([ev("a", "2026-10-03T16:00:00Z")], NOW), []);
});
