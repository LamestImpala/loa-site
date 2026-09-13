// node --test lib/
import { test } from "node:test";
import assert from "node:assert/strict";
import type { PendingPriceChange, PriceRun } from "../supabase.ts";
import { forSaleById, isActionable } from "./pricing.ts";

const run = (id: number, summary: { record_id: number; for_sale?: number | null }[]): PriceRun => ({
  id,
  ran_at: `2026-09-${String(id).padStart(2, "0")}T06:00:00Z`,
  checked: 0,
  auto_applied: 0,
  flagged: 0,
  errors: 0,
  summary: summary.map((s) => ({ artist: "", title: "", old_price: 0, new_price: 0, pct: 0, action: "flagged" as const, ...s })),
});

const change = (record_id: number, pct_change: number): PendingPriceChange => ({
  id: record_id,
  record_id,
  old_price: 100,
  suggested_price: Math.round(100 * (1 + pct_change)),
  pct_change,
  status: "pending",
  created_at: "2026-09-13T06:00:00Z",
});

test("copies for sale come from the newest run that reported them", () => {
  const m = forSaleById([
    run(13, [{ record_id: 1, for_sale: 40 }, { record_id: 2, for_sale: null }]),
    run(12, [{ record_id: 1, for_sale: 7 }, { record_id: 2, for_sale: 3 }, { record_id: 3 }]),
  ]);
  assert.equal(m.get(1), 40, "runs arrive newest first");
  assert.equal(m.get(2), 3, "a null in the newest run falls through to an older count");
  assert.equal(m.has(3), false);
});

test("actionable cuts: modest with competition, or anything on a stocked release", () => {
  const copies = new Map([
    [1, 3],
    [2, 2],
    [3, 30],
    [4, 29],
  ]);
  assert.equal(isActionable(change(1, -0.3), copies), true, "30% cut, 3 copies — boundary in");
  assert.equal(isActionable(change(1, -0.31), copies), false, "past 30% needs a stocked release");
  assert.equal(isActionable(change(2, -0.1), copies), false, "2 copies is not competition");
  assert.equal(isActionable(change(3, -0.8), copies), true, "30+ copies: any cut");
  assert.equal(isActionable(change(4, -0.8), copies), false);
  assert.equal(isActionable(change(4, -0.2), copies), true);
  assert.equal(isActionable(change(3, 0.2), copies), false, "raises are never actionable");
  assert.equal(isActionable(change(3, 0), copies), false);
  assert.equal(isActionable(change(99, -0.1), copies), false, "unknown stock counts as none");
});
