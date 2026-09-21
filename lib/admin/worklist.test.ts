// node --test lib/
import { test } from "node:test";
import assert from "node:assert/strict";
import type { OrderRequest } from "../supabase.ts";
import { inboxCount, worklist } from "./worklist.ts";
import { DAY, invoice, iso, order, rec, shipment } from "./fixtures.ts";

const NOW = new Date("2026-09-20T12:00:00.000Z").getTime();

const request = (over: Partial<OrderRequest> = {}): OrderRequest => ({
  id: 1,
  ref_code: "CR-0001",
  buyer_username: "amy",
  record_ids: [],
  items: [],
  subtotal: 0,
  shipping: 0,
  total: 0,
  status: "new",
  created_at: iso(NOW),
  updated_at: iso(NOW),
  ...over,
});

const empty = { records: [], shipments: [], invoices: [], orders: [], orderRequests: [] };

test("nothing to do is all zeros", () => {
  const w = worklist(empty, NOW);
  assert.deepEqual(w, {
    newRequests: 0,
    openOrders: 0,
    expiredHolds: 0,
    staleInvoices: 0,
    toPull: 0,
    toPack: 0,
    needLabels: 0,
    toSync: 0,
    toUnlist: 0,
  });
  assert.equal(inboxCount(w), 0);
});

test("only new requests count, not loaded ones", () => {
  const w = worklist(
    {
      ...empty,
      orderRequests: [request({ id: 1 }), request({ id: 2, status: "loaded" })],
    },
    NOW
  );
  assert.equal(w.newRequests, 1);
});

test("open orders split into expired holds and stale invoices", () => {
  const orders = [
    order({ id: 1, status: "held" }), // hold still running
    order({ id: 2, status: "held" }), // hold lapsed
    order({ id: 3, status: "invoiced", paypal_invoice_id: "INV-3", created_at: iso(NOW - 2 * DAY) }),
    order({ id: 4, status: "invoiced", paypal_invoice_id: "INV-4", created_at: iso(NOW - 3600 * 1000) }),
  ];
  const records = [
    rec({ order_id: 1, hold_buyer: "a", hold_until: iso(NOW + DAY) }),
    rec({ order_id: 2, hold_buyer: "b", hold_until: iso(NOW - DAY) }),
    rec({ order_id: 3 }),
    rec({ order_id: 4 }),
  ];
  const w = worklist({ ...empty, orders, records }, NOW);
  assert.equal(w.openOrders, 4);
  assert.equal(w.expiredHolds, 1);
  assert.equal(w.staleInvoices, 1);
  assert.equal(inboxCount(w), 2);
});

test("pull, pack and label counts follow a paid order through the table", () => {
  const orders = [order({ id: 1, status: "paid" })];
  const records = [
    rec({ id: 1, sold: true, order_id: 1 }),
    rec({ id: 2, sold: true, order_id: 1, picked_at: iso(NOW) }),
    rec({ id: 3, sold: true, order_id: 1, picked_at: iso(NOW) }),
  ];
  const loose = worklist({ ...empty, orders, records }, NOW);
  assert.equal(loose.toPull, 1);
  assert.equal(loose.toPack, 3);
  assert.equal(loose.needLabels, 0);

  const sealed = worklist(
    {
      ...empty,
      orders,
      records,
      shipments: [
        shipment({ order_id: 1, record_ids: [2, 3], status: "draft", packed_at: iso(NOW) }),
      ],
    },
    NOW
  );
  assert.equal(sealed.toPull, 1);
  assert.equal(sealed.toPack, 1);
  assert.equal(sealed.needLabels, 1);

  const shipped = worklist(
    {
      ...empty,
      orders,
      records,
      shipments: [
        shipment({ order_id: 1, record_ids: [1, 2, 3], status: "shipped", tracking_code: "9400" }),
      ],
    },
    NOW
  );
  assert.equal(shipped.toPull, 0);
  assert.equal(shipped.toPack, 0);
  assert.equal(shipped.needLabels, 0);
});

test("a paid invoiced order asks for a sync until its fee is recorded", () => {
  const orders = [order({ id: 1, status: "paid", paypal_invoice_id: "INV-1" })];
  const records = [rec({ id: 1, sold: true, order_id: 1 })];
  assert.equal(worklist({ ...empty, orders, records }, NOW).toSync, 1);
  assert.equal(
    worklist({ ...empty, orders, records, invoices: [invoice()] }, NOW).toSync,
    1
  );
  assert.equal(
    worklist(
      { ...empty, orders, records, invoices: [invoice({ paypal_fee: 1.84 })] },
      NOW
    ).toSync,
    0
  );
});

test("orders without an invoice, and long-fulfilled ones, never ask for a sync", () => {
  const noInvoice = worklist(
    {
      ...empty,
      orders: [order({ id: 1, status: "paid" })],
      records: [rec({ id: 1, sold: true, order_id: 1 })],
    },
    NOW
  );
  assert.equal(noInvoice.toSync, 0);

  const old = worklist(
    {
      ...empty,
      orders: [order({ id: 2, status: "paid", paypal_invoice_id: "INV-2" })],
      records: [rec({ id: 2, sold: true, order_id: 2 })],
      shipments: [
        shipment({
          order_id: 2,
          record_ids: [2],
          status: "shipped",
          tracking_code: "9400",
          updated_at: iso(NOW - 30 * DAY),
        }),
      ],
    },
    NOW
  );
  assert.equal(old.toSync, 0);
});

test("a refunded order stops asking for anything", () => {
  const orders = [order({ id: 1, status: "refunded", paypal_invoice_id: "INV-1" })];
  const records = [rec({ id: 1, sold: true, order_id: 1 })]; // shipped before the refund
  const w = worklist({ ...empty, orders, records }, NOW);
  assert.deepEqual([w.toSync, w.toPull, w.toPack], [0, 0, 0]);
});

test("shipped records still on Discogs are counted once their order is fully tracked", () => {
  const orders = [order({ id: 1, status: "paid" })];
  const records = [rec({ id: 1, sold: true, order_id: 1, discogs_release_id: 10 })];
  const box = shipment({ order_id: 1, record_ids: [1] });
  assert.equal(worklist({ ...empty, orders, records, shipments: [box] }, NOW).toUnlist, 0);
  assert.equal(
    worklist({ ...empty, orders, records, shipments: [{ ...box, tracking_code: "9400" }] }, NOW).toUnlist,
    1
  );
});
