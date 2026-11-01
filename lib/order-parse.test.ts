// node --test lib/
import { test } from "node:test";
import assert from "node:assert/strict";
import { matchLines, parseOrderText } from "./order-parse.ts";
import { poster, rec } from "./admin/fixtures.ts";

test("parse: a record line keeps media and sleeve", () => {
  const [l] = parseOrderText("1. Can — Ege Bamyasi — Media: NM / Sleeve: VG+ — $30");
  assert.equal(l.artist, "Can");
  assert.equal(l.title, "Ege Bamyasi");
  assert.equal(l.media, "NM");
  assert.equal(l.sleeve, "VG+");
  assert.equal(l.price, 30);
});

test("parse: a poster or gear line keeps its Cond: segment out of the title", () => {
  const text = [
    "2. Pearl Jam — Wrigley Field 2016 Night 1 — Cond: Excellent · 18 × 24 in · 142/300 — $120",
    "3. Technics — SL-1200 MK2 — Cond: Very Good — $400",
    "",
    "Subtotal: $550",
    "Shipping: $12 (one tube, any number of posters)",
    "Equipment shipping is quoted separately before the invoice.",
    "Total: $562",
  ].join("\n");
  const lines = parseOrderText(text);
  assert.equal(lines.length, 2, "totals and the equipment note are skipped");
  assert.deepEqual(
    lines.map((l) => [l.artist, l.title, l.spec, l.price]),
    [
      ["Pearl Jam", "Wrigley Field 2016 Night 1", "Cond: Excellent · 18 × 24 in · 142/300", 120],
      ["Technics", "SL-1200 MK2", "Cond: Very Good", 400],
    ]
  );
});

test("match: a poster line finds the poster", () => {
  const p = poster({ id: 9, artist: "Pearl Jam", title: "Wrigley Field 2016 Night 1", price: 120 });
  const lines = parseOrderText("1. Pearl Jam — Wrigley Field 2016 Night 1 — Cond: Excellent — $120");
  const [m] = matchLines(lines, [rec({ id: 1 }), p]);
  assert.equal(m.status, "matched");
  assert.equal(m.match?.id, 9);
});
