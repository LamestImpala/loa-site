// node --test lib/
import { test } from "node:test";
import assert from "node:assert/strict";
import { integrityIssues } from "./integrity.ts";
import { DAY, invoice, iso, order, rec, shipment } from "./fixtures.ts";

const NOW = Date.parse("2026-09-22T12:00:00Z");
const empty = { records: [], shipments: [], invoices: [], orders: [] };
const keys = (data: Parameters<typeof integrityIssues>[0]) =>
  integrityIssues(data, NOW).map((i) => i.key);

test("a healthy sale raises nothing", () => {
  assert.deepEqual(
    keys({
      ...empty,
      orders: [order({ id: 1, status: "paid", paypal_invoice_id: "INV-1" })],
      invoices: [invoice({ paypal_invoice_id: "INV-1", paid_at: iso(NOW - DAY) })],
      records: [rec({ id: 5, sold: true, order_id: 1 })],
      shipments: [
        shipment({ id: 9, order_id: 1, record_ids: [5], tracking_code: "9400", sent_at: iso(NOW) }),
      ],
    }),
    []
  );
});

test("an invoiced order PayPal already paid, or with no invoice row", () => {
  assert.deepEqual(
    keys({
      ...empty,
      orders: [
        order({ id: 1, status: "invoiced", paypal_invoice_id: "INV-1" }),
        order({ id: 2, status: "invoiced", paypal_invoice_id: "INV-2" }),
        order({ id: 3, status: "invoiced", paypal_invoice_id: "INV-3" }),
      ],
      invoices: [
        invoice({ paypal_invoice_id: "INV-1", paid_at: iso(NOW) }),
        invoice({ paypal_invoice_id: "INV-3" }), // sent, unpaid — fine
      ],
    }),
    ["paid-unsold-1", "no-invoice-2"]
  );
});

test("a sold record outside a paid or refunded order", () => {
  assert.deepEqual(
    keys({
      ...empty,
      orders: [order({ id: 1, status: "held" }), order({ id: 2, status: "refunded" })],
      records: [
        rec({ id: 1, sold: true }),
        rec({ id: 2, sold: true, order_id: 1 }),
        rec({ id: 3, sold: true, order_id: 2 }),
      ],
    }),
    ["sold-no-order-1", "sold-no-order-2"]
  );
});

test("a record in two live boxes; refunded boxes don't count", () => {
  assert.deepEqual(
    keys({
      ...empty,
      shipments: [
        shipment({ id: 1, record_ids: [7] }),
        shipment({ id: 2, record_ids: [7, 8] }),
        shipment({ id: 3, record_ids: [8], status: "refunded" }),
      ],
    }),
    ["two-boxes-7"]
  );
});

test("relisted but off Discogs, and a labeled box left in the house for days", () => {
  assert.deepEqual(
    keys({
      ...empty,
      records: [
        rec({ id: 1, discogs_removed: true }),
        rec({ id: 2, discogs_removed: true, listed: false }), // hidden: not for sale
      ],
      shipments: [
        shipment({ id: 4, tracking_code: "1", packed_at: iso(NOW - 4 * DAY) }),
        shipment({ id: 5, tracking_code: "2", packed_at: iso(NOW - DAY) }), // too soon to nag
      ],
    }),
    ["off-discogs-1", "unsent"]
  );
});
