// node --test lib/
import { test } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import {
  MANIFEST_ROWS_PER_PAGE,
  packingSlips,
  pdfSafe,
  shipManifest,
  THERMAL,
} from "./packing-slips.ts";
import type { PackingSlip } from "./pack-list.ts";

const slip = (over: Partial<PackingSlip> = {}): PackingSlip => ({
  boxId: 12,
  buyer: "zed",
  shipTo: {
    name: "Jane Buyer",
    line1: "1 Main",
    line2: null,
    city: "Tempe",
    state: "AZ",
    postal_code: "85281",
    country_code: "US",
  },
  boxIndex: 1,
  boxCount: 1,
  packedAt: "2026-09-15T10:00:00Z",
  records: [
    { artist: "Zappa", title: "Hot Rats", pressing: "1969 · Bizarre", media: "VG+", sleeve: "VG" },
  ],
  ...over,
});

test("one 4x6 page per box", async () => {
  const bytes = await packingSlips([slip(), slip({ boxId: 13, boxIndex: 2, boxCount: 2 })]);
  const doc = await PDFDocument.load(bytes);
  assert.equal(doc.getPageCount(), 2);
  for (const page of doc.getPages()) {
    assert.deepEqual(page.getSize(), { width: THERMAL.width, height: THERMAL.height });
  }
});

test("a slip with no address and an unencodable title still renders", async () => {
  const bytes = await packingSlips([
    slip({
      shipTo: null,
      records: [
        { artist: "坂本龍一", title: "Async — “deluxe”", pressing: "", media: "NM", sleeve: "NM" },
        ...Array.from({ length: 6 }, (_, i) => ({
          artist: `Artist with a very long name number ${i}`,
          title: "A title that goes on and on and on and wraps around the slip",
          pressing: "2020 · Some Label · CAT-123 · US",
          media: "VG+",
          sleeve: "VG+",
        })),
      ],
    }),
  ]);
  assert.equal((await PDFDocument.load(bytes)).getPageCount(), 1);
});

test("no boxes is an error", async () => {
  await assert.rejects(packingSlips([]), /No boxes/);
});

test("pdfSafe keeps WinAnsi, folds accents, replaces the rest", () => {
  assert.equal(pdfSafe("Café — “ok” … ñ"), "Café — “ok” … ñ");
  assert.equal(pdfSafe("Björk Ōkami"), "Björk Okami");
  assert.equal(pdfSafe("坂本龍一"), "????");
  assert.equal(pdfSafe("a\tb c"), "a b c");
});

test("manifest fits a full page of boxes on one 4x6 and spills to a second", async () => {
  const many = (n: number) =>
    Array.from({ length: n }, (_, i) => slip({ boxId: 100 + i, buyer: `buyer${i}` }));
  const one = await PDFDocument.load(await shipManifest(many(MANIFEST_ROWS_PER_PAGE)));
  assert.equal(one.getPageCount(), 1);
  assert.deepEqual(one.getPage(0).getSize(), { width: THERMAL.width, height: THERMAL.height });
  const two = await PDFDocument.load(await shipManifest(many(MANIFEST_ROWS_PER_PAGE + 1)));
  assert.equal(two.getPageCount(), 2);
  assert.ok(MANIFEST_ROWS_PER_PAGE >= 10, `only ${MANIFEST_ROWS_PER_PAGE} rows fit`);
});

test("manifest survives a multi-box order, a missing address and a long buyer name", async () => {
  const bytes = await shipManifest([
    slip({ boxIndex: 1, boxCount: 2 }),
    slip({ boxId: 13, boxIndex: 2, boxCount: 2, shipTo: null }),
    slip({ boxId: 14, buyer: "a_reddit_handle_that_is_really_quite_long_indeed", records: [] }),
    slip({ boxId: 15, shipTo: { ...slip().shipTo!, name: "坂本龍一" } }),
  ]);
  assert.equal((await PDFDocument.load(bytes)).getPageCount(), 1);
});

test("manifest with no boxes is an error", async () => {
  await assert.rejects(shipManifest([]), /No boxes/);
});
