// node --test lib/
import { test } from "node:test";
import assert from "node:assert/strict";
import { bundleBreakdown } from "./records.ts";

const item = (price: number, listed?: number) => ({
  artist: "A",
  title: `T${price}`,
  media: "NM",
  sleeve: "VG+",
  price,
  listedPrice: listed,
});

test("bundle breakdown: listed price shown only when the sale price differs", () => {
  const b = bundleBreakdown([item(30, 40), item(20, 20), item(15)]);
  assert.equal(b.lines[0], "1. A — T30 — Media: NM / Sleeve: VG+ — $30 (listed $40)");
  assert.equal(b.lines[1], "2. A — T20 — Media: NM / Sleeve: VG+ — $20");
  assert.equal(b.lines[2], "3. A — T15 — Media: NM / Sleeve: VG+ — $15");
  assert.equal(b.subtotal, 65);
  assert.equal(b.credit, 0);
  assert.equal(b.shipping, 0, "free on three");
  assert.equal(b.total, 65);
});

test("bundle breakdown: a credit comes off the subtotal, never past it or below zero", () => {
  const two = [item(30), item(20)];
  assert.equal(bundleBreakdown(two).total, 56, "$50 + $6 shipping");
  const dealt = bundleBreakdown(two, 10);
  assert.equal(dealt.credit, 10);
  assert.equal(dealt.total, 46);
  assert.equal(bundleBreakdown(two, 80).credit, 50, "capped at the subtotal");
  assert.equal(bundleBreakdown(two, 80).total, 6, "shipping still due");
  assert.equal(bundleBreakdown(two, -5).credit, 0);
});
