// node --test lib/
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bundleKindSummary,
  itemPath,
  itemSpecLine,
  itemSpecShort,
  itemSubtitle,
  kindOf,
  posterYear,
  shippingFor,
  shippingNote,
  shippingSummary,
} from "./items.ts";
import { gear, poster, rec } from "./admin/fixtures.ts";

test("kindOf: rows without a kind are records", () => {
  assert.equal(kindOf({}), "record");
  assert.equal(kindOf({ kind: null }), "record");
  assert.equal(kindOf({ kind: "poster" }), "poster");
});

test("itemPath: records keep /r/, posters get /p/, gear /e/", () => {
  assert.equal(itemPath(rec({ id: 7, artist: "Black Pumas", title: "Chronicles" })), "/r/7-black-pumas-chronicles");
  assert.equal(itemPath(poster({ id: 8, title: "Wrigley Night 1" })), "/p/8-pearl-jam-wrigley-night-1");
  assert.equal(itemPath(gear({ id: 9, title: "SL-1200" })), "/e/9-technics-sl-1200");
});

test("spec lines: records unchanged, posters and gear use the condition word", () => {
  const r = rec({ media: "NM", sleeve: "VG+" });
  assert.equal(itemSpecLine(r), "Media: NM / Sleeve: VG+");
  assert.equal(itemSpecShort(r), "NM/VG+");
  const p = poster({ condition: "Excellent", details: { dimensions: "18 × 24 in", edition: "142/300" } });
  assert.equal(itemSpecLine(p), "Cond: Excellent · 18 × 24 in · 142/300");
  assert.equal(itemSpecShort(p), "Excellent");
  assert.equal(itemSpecLine(poster({ condition: "Mint", details: {} })), "Cond: Mint", "blank fields drop out");
  assert.equal(itemSpecLine(gear({ condition: "Good" })), "Cond: Good");
});

test("subtitles: pressing, show, category", () => {
  assert.equal(itemSubtitle(rec({ pressing: "2020 · Label (3) CAT-1 · US" })), "2020 · Label CAT-1 · US");
  const p = poster({ details: { venue: "Wrigley Field", city: "Chicago", show_date: "2016-08-20" } });
  assert.equal(itemSubtitle(p), "Wrigley Field · Chicago · 2016");
  assert.equal(posterYear(p), 2016);
  assert.equal(posterYear(poster({ details: {} })), null);
  assert.equal(itemSubtitle(gear({ details: { category: "Turntable" } })), "Turntable");
});

test("shippingFor: records keep the Media Mail rule", () => {
  assert.equal(shippingFor([rec()]).shipping, 6);
  assert.equal(shippingFor([rec(), rec()]).shipping, 6);
  assert.equal(shippingFor([rec(), rec(), rec()]).shipping, 0);
  assert.equal(shippingSummary(shippingFor([rec(), rec(), rec()])), "free on 3+ records");
});

test("shippingFor: any number of posters is one tube", () => {
  assert.equal(shippingFor([poster()]).shipping, 12);
  assert.equal(shippingFor([poster(), poster(), poster(), poster(), poster()]).shipping, 12);
  assert.equal(shippingSummary(shippingFor([poster()])), "$12 poster tube");
});

test("shippingFor: gear is quoted later, not charged", () => {
  const q = shippingFor([gear()]);
  assert.equal(q.shipping, 0);
  assert.equal(q.gearQuoted, true);
  assert.match(shippingNote(q) ?? "", /quoted separately/);
  assert.equal(shippingNote(shippingFor([rec()])), null);
});

test("shippingFor: mixed bundles sum per kind", () => {
  const two = shippingFor([rec(), rec(), poster()]);
  assert.equal(two.shipping, 18);
  assert.equal(shippingSummary(two), "$6 records + $12 poster tube");
  assert.equal(shippingFor([rec(), rec(), rec(), poster()]).shipping, 12);
  const withGear = shippingFor([rec(), gear()]);
  assert.equal(withGear.shipping, 6);
  assert.equal(withGear.gearQuoted, true);
});

test("bundleKindSummary", () => {
  assert.equal(bundleKindSummary([rec(), rec(), poster()]), "2 records + 1 poster");
  assert.equal(bundleKindSummary([gear()]), "1 piece of equipment");
});
