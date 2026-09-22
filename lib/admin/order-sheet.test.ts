// node --test lib/
import { test } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import { fitOrderSheet, LETTER, orderSheetPdf } from "./order-sheet.ts";
import type { OrderSheetOrder } from "./pack-list.ts";

const order = (i: number, n: number, over: Partial<OrderSheetOrder> = {}): OrderSheetOrder => ({
  key: `order-${i}`,
  buyer: `buyer${i}`,
  shipToName: "Jane Buyer",
  records: Array.from({ length: n }, (_, j) => ({
    artist: `Artist ${j}`,
    title: `Title ${j}`,
    media: "VG+",
    sleeve: "VG",
    boxId: j === 0 ? 40 + i : null,
  })),
  ...over,
});

test("a normal day fits on one Letter page at full size", async () => {
  const orders = Array.from({ length: 15 }, (_, i) => order(i, 3));
  assert.equal(fitOrderSheet(orders).scale, 1);
  const pdf = await PDFDocument.load(await orderSheetPdf(orders));
  assert.equal(pdf.getPageCount(), 1);
  assert.deepEqual(pdf.getPage(0).getSize(), { width: LETTER.width, height: LETTER.height });
});

test("a big day shrinks the type before it spills onto a second page", async () => {
  const bigger = Array.from({ length: 24 }, (_, i) => order(i, 4));
  const fitted = fitOrderSheet(bigger);
  assert.equal(fitted.pages, 1);
  assert.ok(fitted.scale < 1);
  const huge = Array.from({ length: 80 }, (_, i) => order(i, 4));
  assert.ok(fitOrderSheet(huge).pages > 1);
  assert.equal((await PDFDocument.load(await orderSheetPdf(huge))).getPageCount(), fitOrderSheet(huge).pages);
});

test("an order never splits across columns unless it's taller than a column", () => {
  const orders = Array.from({ length: 12 }, (_, i) => order(i, 5));
  const { placed } = fitOrderSheet(orders);
  for (const o of orders) {
    const spots = new Set(
      placed
        .filter((p) => p.line.kind === "order" && p.line.order.key === o.key)
        .map((p) => `${p.page}/${p.col}`)
    );
    assert.equal(spots.size, 1);
  }
  const giant = fitOrderSheet([order(1, 120)]);
  assert.ok(giant.placed.some((p) => p.line.kind === "order" && p.line.cont));
});

test("survives long names, non-Latin text and no ship-to name", async () => {
  const bytes = await orderSheetPdf([
    order(1, 2, { buyer: "a_reddit_handle_that_is_really_quite_long_indeed_and_then_some" }),
    order(2, 1, { shipToName: null, buyer: "" }),
    {
      ...order(3, 1),
      records: [{ artist: "坂本龍一", title: "Björk — Début ".repeat(8), media: "NM", sleeve: "NM", boxId: null }],
    },
  ]);
  assert.equal((await PDFDocument.load(bytes)).getPageCount(), 1);
});

test("no orders is an error", async () => {
  await assert.rejects(orderSheetPdf([]), /No orders/);
});
