// node --test lib/
import { test } from "node:test";
import assert from "node:assert/strict";
import { refundPlan, refundedPatch } from "./refunds.ts";
import { rec, shipment } from "./fixtures.ts";

test("a refund before shipping puts every record back for sale", () => {
  const records = [rec({ id: 1, sold: true }), rec({ id: 2, sold: true })];
  const plan = refundPlan(records, [shipment({ record_ids: [1, 2] })]); // boxed, no label yet
  assert.deepEqual(plan.relist.map((r) => r.id), [1, 2]);
  assert.deepEqual(plan.keepSold, []);
});

test("a half-shipped order splits: tracked records stay sold", () => {
  const records = [rec({ id: 1, sold: true }), rec({ id: 2, sold: true }), rec({ id: 3, sold: true })];
  const plan = refundPlan(records, [
    shipment({ record_ids: [1], tracking_code: "9400", status: "shipped" }),
    shipment({ record_ids: [2] }),
  ]);
  assert.deepEqual(plan.keepSold.map((r) => r.id), [1]);
  assert.deepEqual(plan.relist.map((r) => r.id), [2, 3]);
});

test("a tracking number mirrored on the record counts as shipped; a refunded parcel doesn't", () => {
  const records = [
    rec({ id: 1, sold: true, tracking_number: "9400" }),
    rec({ id: 2, sold: true }),
  ];
  const plan = refundPlan(records, [
    shipment({ record_ids: [2], tracking_code: "9401", status: "refunded" }),
  ]);
  assert.deepEqual(plan.keepSold.map((r) => r.id), [1]);
  assert.deepEqual(plan.relist.map((r) => r.id), [2]);
});

test("the refunded patch un-sells and drops the dead sale's buyer, price and invoice", () => {
  assert.deepEqual(refundedPatch(), {
    sold: false,
    sold_at: null,
    order_id: null,
    negotiated_price: null,
    picked_at: null,
    sold_price: null,
    buyer_username: "",
    paypal_invoice_id: null,
    tracking_number: "",
  });
});
