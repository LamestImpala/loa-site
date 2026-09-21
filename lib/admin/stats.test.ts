// node --test lib/
import { test } from "node:test";
import assert from "node:assert/strict";
import { salesStats } from "./stats.ts";
import { invoice, order, rec, shipment } from "./fixtures.ts";

test("net is sales + shipping charged − fees − postage, credits off the sold total", () => {
  const s = salesStats({
    records: [
      rec({ id: 1, sold: true, sold_price: 40, order_id: 1 }),
      rec({ id: 2, sold: true, sold_price: 20, order_id: 1 }),
      rec({ id: 3, price: 30 }),
      rec({ id: 4, price: 15, listed: false }),
    ],
    orders: [order({ id: 1, status: "paid", credit: 5, paypal_invoice_id: "INV-1" })],
    invoices: [invoice({ paypal_invoice_id: "INV-1", paypal_fee: 2.5, shipping_charged: 6 })],
    shipments: [shipment({ order_id: 1, postage_cost: 4.5 })],
  });
  assert.equal(s.soldCount, 2);
  assert.equal(s.soldTotal, 55);
  assert.equal(s.netTotal, 55 + 6 - 2.5 - 4.5);
  assert.deepEqual([s.forSaleCount, s.askingTotal, s.hiddenCount, s.hiddenTotal], [1, 30, 1, 15]);
});

test("a refunded order earns nothing but its fee and postage still cost", () => {
  const s = salesStats({
    records: [
      rec({ id: 1, sold: true, sold_price: 40, order_id: 1 }),
      rec({ id: 2, sold: true, sold_price: 25, order_id: 2 }), // shipped, lost, refunded
    ],
    orders: [
      order({ id: 1, status: "paid", paypal_invoice_id: "INV-1" }),
      order({ id: 2, status: "refunded", paypal_invoice_id: "INV-2", refunded_amount: 31, credit: 3 }),
    ],
    invoices: [
      invoice({ paypal_invoice_id: "INV-1", paypal_fee: 2, shipping_charged: 6 }),
      invoice({ paypal_invoice_id: "INV-2", paypal_fee: 1.5, shipping_charged: 6 }),
    ],
    shipments: [shipment({ order_id: 2, postage_cost: 4 })],
  });
  assert.equal(s.soldCount, 1);
  assert.equal(s.soldTotal, 40, "neither the refunded order's records nor its credit or refund count");
  assert.equal(s.shippingCharged, 6);
  assert.equal(s.netTotal, 40 + 6 - 3.5 - 4);
});

test("a partial refund on a paid order comes off the sold total", () => {
  const s = salesStats({
    records: [rec({ id: 1, sold: true, sold_price: 40, order_id: 1 })],
    orders: [order({ id: 1, status: "paid", refunded_amount: 5 })],
    invoices: [],
    shipments: [],
  });
  assert.deepEqual([s.soldTotal, s.refundedTotal, s.netTotal], [35, 5, 35]);
});
