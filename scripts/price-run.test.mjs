// node --test scripts/
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyMode, planPrice, releaseDetails } from "./price-run.mjs";
import { releaseDetailsFromDiscogs } from "../lib/record-info.ts";

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

test("a comparable listing sets the target at lowest + 6", () => {
  const p = planPrice({ price: 40, suggestion: 40, lowest: 30, forSale: 12 });
  assert.equal(p.lowestPlausible, true);
  assert.equal(p.target, 36);
  assert.equal(p.reason, "lowest");
});

test("a comparable listing below the tier floor is ignored as noise", () => {
  // scarce tier floor = 85% of 40 = 34; lowest 21 → 27 < 34
  const p = planPrice({ price: 40, suggestion: 40, lowest: 21, forSale: 2, want: 500, have: 600 });
  assert.equal(p.lowestPlausible, true);
  assert.equal(p.competitive, null);
  assert.equal(p.target, 40);
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

// The backfill here and the admin import (lib/record-info.ts) must store the
// same shape, or record pages would render the two kinds of rows differently.
test("release details match the admin import's shape", () => {
  const rel = {
    country: "UK",
    styles: ["Dub"],
    identifiers: [{ type: "Barcode", value: "5 012345 678900" }, { type: "Matrix", value: "X" }],
    tracklist: [
      { type_: "heading", title: "Side One" },
      { type_: "track", position: "A1", title: " Exodus ", duration: "7:40" },
      { type_: "index", title: "Medley", sub_tracks: [{ type_: "track", position: "B1a", title: "Part", duration: "" }] },
      { type_: "track", position: "B2", title: "", duration: "" },
    ],
  };
  assert.deepEqual(releaseDetails(rel), releaseDetailsFromDiscogs(rel));
  assert.deepEqual(releaseDetails({}), releaseDetailsFromDiscogs({}));
});

test("every cut waits for approval; only small raises apply on their own", () => {
  assert.equal(applyMode(30, 30), "none");
  assert.equal(applyMode(0, 34), "auto"); // first price on an unpriced record
  assert.equal(applyMode(30, 29), "queue"); // a $1 cut, even under 5%
  assert.equal(applyMode(26, 25), "queue"); // a decay step
  assert.equal(applyMode(40, 31), "queue"); // a big cut
  assert.equal(applyMode(40, 42), "auto"); // +5% raise
  assert.equal(applyMode(40, 43), "queue"); // +7.5% raise
});

test("an under-priced record climbs weekly toward lowest + 6", () => {
  // lowest $30 → mark $36; priced $20, quiet for 8 days: one 10% step
  const base = { price: 20, suggestion: 40, lowest: 30, forSale: 12, daysListed: 60 };
  const p = planPrice({ ...base, daysSinceChange: 8 });
  assert.equal(p.reason, "climb");
  assert.equal(p.target, 22);
  assert.equal(applyMode(20, p.target, p.reason), "auto");
  // changed within the week: hold
  assert.equal(planPrice({ ...base, daysSinceChange: 3 }).target, 20);
  // cheap records still move a dollar
  assert.equal(planPrice({ ...base, price: 9, daysSinceChange: 8 }).target, 10);
  // bigger records step 10%, and never past the mark
  assert.equal(planPrice({ ...base, lowest: 80, price: 60, suggestion: 100, daysSinceChange: 8 }).target, 66);
  assert.equal(planPrice({ ...base, price: 35, daysSinceChange: 8 }).target, 36);
  // at the mark: no climb, and decay may propose its cut (for approval)
  const atMark = planPrice({ ...base, price: 36, daysSinceChange: 20 });
  assert.equal(atMark.reason, "decay");
  assert.equal(applyMode(36, atMark.target, atMark.reason), "queue");
  // a climbing record never decays
  assert.equal(planPrice({ ...base, daysSinceChange: 20 }).reason, "climb");
});

test("no comparable listing, no climb", () => {
  // the only listing is a junk copy: the ratchet holds as before
  const p = planPrice({ price: 20, suggestion: 40, lowest: 12, forSale: 12, daysSinceChange: 30 });
  assert.equal(p.target, 20);
  assert.notEqual(p.reason, "climb");
});

test("an eBay median below the mark caps the climb", () => {
  const ebay = { exact: true, count: 5, median: 25 };
  const p = planPrice({ price: 24, suggestion: 40, lowest: 30, forSale: 12, ebay, daysSinceChange: 8 });
  assert.equal(p.target, 25);
  assert.equal(p.reason, "climb");
});

test("a record above lowest + 6 gets a cut proposal, never an applied cut", () => {
  const p = planPrice({ price: 50, suggestion: 40, lowest: 30, forSale: 12 });
  assert.equal(p.target, 36);
  assert.equal(applyMode(50, p.target, p.reason), "queue");
});
