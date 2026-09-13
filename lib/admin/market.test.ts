// node --test lib/
import { test } from "node:test";
import assert from "node:assert/strict";
import type { MarketSnapshotRow } from "../supabase.ts";
import { latestMarket } from "./market.ts";

const row = (over: Partial<MarketSnapshotRow>): MarketSnapshotRow => ({
  record_id: 1,
  snapped_on: "2026-09-13",
  for_sale: 4,
  want: 10,
  have: 5,
  suggested: 40,
  lowest: 12.5,
  lowest_plausible: true,
  ...over,
});

test("the newest snapshot per record wins and numerics are coerced", () => {
  const market = latestMarket([
    row({ record_id: 1, snapped_on: "2026-09-13", suggested: "41.50" as unknown as number, lowest: "9" as unknown as number }),
    row({ record_id: 1, snapped_on: "2026-09-12", suggested: 40 }),
    row({ record_id: 2, snapped_on: "2026-09-11", for_sale: null, want: null, have: null, suggested: null, lowest: null, lowest_plausible: null }),
    row({ record_id: 3, lowest_plausible: undefined }),
  ]);
  assert.deepEqual(market[1], { forSale: 4, want: 10, have: 5, suggested: 41.5, lowest: 9, lowestPlausible: true });
  assert.deepEqual(market[2], { forSale: null, want: null, have: null, suggested: null, lowest: null, lowestPlausible: null });
  assert.equal(market[3].lowestPlausible, null, "pre-migration rows have no plausibility flag");
  assert.equal(Object.keys(market).length, 3);
});
