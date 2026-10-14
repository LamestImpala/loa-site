// node --test lib/
import { test } from "node:test";
import assert from "node:assert/strict";
import { assignVariants, dealBatches, dealVariantBatches, fnv1a, HOUSE_PROMPT_VERSION, HOUSE_VARIANTS, houseVariant, type HouseVariant } from "./pickem-variants.ts";

const week = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `evt${i}`, variant: null as string | null }));
const ids = (m: Map<string, HouseVariant>, v: string) => [...m].filter(([, x]) => x.id === v).map(([id]) => id).sort();

test("HOUSE_VARIANTS: control first, ids and prompt versions unique, every version built on HOUSE_PROMPT_VERSION", () => {
  assert.equal(HOUSE_VARIANTS[0].id, "control");
  assert.equal(HOUSE_VARIANTS[0].prompt_version, HOUSE_PROMPT_VERSION);
  assert.equal(HOUSE_VARIANTS[0].system, "");
  assert.equal(HOUSE_VARIANTS[0].feedback, false);
  assert.equal(new Set(HOUSE_VARIANTS.map((v) => v.id)).size, HOUSE_VARIANTS.length);
  assert.equal(new Set(HOUSE_VARIANTS.map((v) => v.prompt_version)).size, HOUSE_VARIANTS.length);
  for (const v of HOUSE_VARIANTS) assert.ok(v.prompt_version.startsWith(HOUSE_PROMPT_VERSION));
  assert.equal(houseVariant("feedback-on")?.feedback, true);
  assert.equal(houseVariant("retired"), undefined);
});

test("fnv1a is the standard 32-bit hash", () => {
  assert.equal(fnv1a(""), 0x811c9dc5);
  assert.equal(fnv1a("a"), 0xe40c292c);
  assert.equal(fnv1a("foobar"), 0xbf9cf968);
});

test("assignVariants: every game gets one, split evenly, the same way every time and in any input order", () => {
  const games = week(41);
  const a = assignVariants("ncaaf", 7, games);
  assert.equal(a.size, 41);
  assert.deepEqual([ids(a, "control").length, ids(a, "feedback-on").length], [21,20]);
  const b = assignVariants("ncaaf", 7, [...games].reverse());
  assert.deepEqual([...a].map(([id, v]) => [id, v.id]).sort(), [...b].map(([id, v]) => [id, v.id]).sort());
});

test("assignVariants: the seed is the league and week, so the split changes week to week", () => {
  const games = week(40);
  const base = ids(assignVariants("ncaaf", 7, games), "control");
  assert.notDeepEqual(ids(assignVariants("ncaaf", 8, games), "control"), base);
  assert.notDeepEqual(ids(assignVariants("nfl", 7, games), "control"), base);
});

test("assignVariants: a game picked under a variant in play keeps it; a retired or missing one is dealt", () => {
  const games = week(10);
  const fresh = assignVariants("nfl", 6, games);
  // Flip every game's stored variant: each keeps what it was picked under.
  const flipped = games.map((g) => ({ ...g, variant: fresh.get(g.id)!.id === "control" ? "feedback-on" : "control" }));
  for (const [id, v] of assignVariants("nfl", 6, flipped)) assert.notEqual(v.id, fresh.get(id)!.id);
  // A variant no longer in the map falls back to the deal.
  const retired = games.map((g) => ({ ...g, variant: "retired" }));
  assert.deepEqual([...assignVariants("nfl", 6, retired)].map(([id, v]) => [id, v.id]), [...fresh].map(([id, v]) => [id, v.id]));
});

test("assignVariants: a gap-filling run over the same week gives the same game the same variant", () => {
  // Tuesday picks half the week; Saturday's run sees the rest still unpicked and those picked with their variants.
  const games = week(30);
  const tuesday = assignVariants("ncaaf", 7, games);
  const saturday = assignVariants(
    "ncaaf",
    7,
    games.map((g, i) => ({ ...g, variant: i % 2 ? tuesday.get(g.id)!.id : null }))
  );
  for (const [id, v] of saturday) assert.equal(v.id, tuesday.get(id)!.id);
});

test("assignVariants: with one variant every game is control", () => {
  const only = [HOUSE_VARIANTS[0]];
  assert.ok([...assignVariants("ncaaf", 1, week(5), only).values()].every((v) => v.id === "control"));
});

test("dealBatches spreads items round-robin into batches of at most size", () => {
  assert.deepEqual(dealBatches([1, 2, 3, 4, 5, 6, 7, 8], 3), [[1, 4, 7], [2, 5, 8], [3, 6]]);
  assert.deepEqual(dealBatches([], 7), []);
});

test("dealVariantBatches: one variant per batch, alternating, at most size games each, every game once", () => {
  const games = week(60).map((g) => g.id);
  const assigned = assignVariants("ncaaf", 7, week(60));
  const batches = dealVariantBatches(games, (id) => assigned.get(id)!, 7);
  assert.equal(batches.length, 10); // 30 + 30 is 5 + 5: why BATCH_CONCURRENCY is 10
  assert.deepEqual(batches.slice(0, 4).map((b) => b.variant.id), ["control", "feedback-on", "control", "feedback-on"]);
  for (const b of batches) {
    assert.ok(b.games.length <= 7);
    assert.ok(b.games.every((id) => assigned.get(id)!.id === b.variant.id));
  }
  assert.deepEqual(batches.flatMap((b) => b.games).sort(), [...games].sort());
});
