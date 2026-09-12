// node --test scripts/
import { test } from "node:test";
import assert from "node:assert/strict";
import { planPrice } from "./price-run.mjs";

// Stone Temple Pilots — Live In New Haven, 1994 (release 33673521), the
// case that exposed the phantom listing: Discogs says lowest_price $8.92 on
// a release whose VG suggestion is $54. Nothing near $9 exists on the sell
// page for a US buyer.
const stp = {
  price: 90,
  suggestion: 54,
  lowest: 8.92,
  forSale: 37,
  want: 714,
  have: 2802,
};

test("a listing under half the suggestion is not comparable and never undercuts", () => {
  const p = planPrice(stp);
  assert.equal(p.lowestPlausible, false);
  assert.equal(p.competitive, null);
  assert.equal(p.tier, "stocked");
  assert.equal(p.target, Math.round(54 * 0.7)); // 38
  assert.equal(p.reason, "stocked");
});

test("a comparable listing caps the target at lowest − 1", () => {
  const p = planPrice({ price: 40, suggestion: 40, lowest: 30, forSale: 12 });
  assert.equal(p.lowestPlausible, true);
  assert.equal(p.target, 29);
  assert.equal(p.reason, "lowest");
});

test("a comparable listing below the tier floor is ignored as noise", () => {
  // normal tier floor = 55% of 40 = 22; lowest 20 → competitive 19 < 22
  const p = planPrice({ price: 40, suggestion: 40, lowest: 20, forSale: 12 });
  assert.equal(p.lowestPlausible, true);
  assert.equal(p.competitive, null);
  assert.equal(p.target, 34);
});

test("only the scarce tier may propose a raise on a priced record", () => {
  // Taylor Swift TTPD on Sept 12: NM $38.50 suggestion, 324 copies, hand-priced $25
  const stocked = planPrice({ price: 25, suggestion: 38.5, lowest: 13, forSale: 324 });
  assert.equal(stocked.target, 25);
  const normal = planPrice({ price: 20, suggestion: 40, forSale: 12 });
  assert.equal(normal.target, 20);
  const scarce = planPrice({ price: 66, suggestion: 77, forSale: 0, want: 900, have: 1000 });
  assert.equal(scarce.target, 77);
  // an unpriced record is always priced
  assert.equal(planPrice({ price: 0, suggestion: 40, forSale: 12 }).target, 34);
});

test("scarce and wanted records ask the full suggestion", () => {
  const p = planPrice({ price: 137, suggestion: 161, forSale: 0, want: 500, have: 600 });
  assert.equal(p.tier, "scarce");
  assert.equal(p.target, 161);
  assert.equal(p.reason, "scarce");
});

test("few copies without demand is not scarce", () => {
  const p = planPrice({ price: 30, suggestion: 30, forSale: 3, want: 10, have: 500 });
  assert.equal(p.tier, "normal");
  assert.equal(p.target, Math.round(30 * 0.85));
});

test("time decay shaves 5% (at least $1) after 30 quiet days, down to the floor", () => {
  const base = { price: 30, suggestion: 30, forSale: 12 };
  // 85% of 30 = 26 < 30, so the market rule already wants a cut: no decay
  assert.equal(planPrice({ ...base, daysListed: 60, daysSinceChange: 20 }).reason, "suggestion");
  // priced at the market target: decay applies
  const d = planPrice({ ...base, price: 26, daysListed: 60, daysSinceChange: 20 });
  assert.equal(d.reason, "decay");
  assert.equal(d.target, 25); // round(24.7) = 25
  // too recent a change: no decay
  assert.equal(planPrice({ ...base, price: 26, daysListed: 60, daysSinceChange: 3 }).target, 26);
  // small prices still step by a dollar
  assert.equal(planPrice({ price: 9, suggestion: 10, forSale: 12, daysListed: 60, daysSinceChange: 20 }).target, 8);
  // never below the floor: stocked floor = 40% of 30 = 12; at $12 decay
  // can't step down and the ratchet keeps the 70% target from raising it
  const atFloor = planPrice({ price: 12, suggestion: 30, forSale: 40, daysListed: 90, daysSinceChange: 30 });
  assert.equal(atFloor.decay, false);
  assert.equal(atFloor.target, 12);
  // one step above the floor lands exactly on it
  assert.equal(planPrice({ price: 13, suggestion: 30, forSale: 40, daysListed: 90, daysSinceChange: 30 }).target, 12);
});

test("eBay exact-match median caps the target but not below the floor", () => {
  const ebay = { exact: true, count: 5, median: 20 };
  assert.equal(planPrice({ price: 40, suggestion: 40, forSale: 12, ebay }).target, 22); // floor 22
  assert.equal(planPrice({ price: 40, suggestion: 40, forSale: 12, ebay: { ...ebay, median: 30 } }).target, 30);
  assert.equal(planPrice({ price: 40, suggestion: 40, forSale: 12, ebay: { ...ebay, exact: false } }).target, 34);
});

test("the comparability bar is half the grade suggestion", () => {
  assert.equal(planPrice({ price: 40, suggestion: 40, lowest: 19, forSale: 12 }).lowestPlausible, false);
  assert.equal(planPrice({ price: 40, suggestion: 40, lowest: 21, forSale: 12 }).lowestPlausible, true);
});
