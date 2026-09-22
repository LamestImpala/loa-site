// node --test lib/
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeSupabase } from "./fake-supabase.ts";
import { INVOICE_HOLD_UNTIL } from "./records.ts";
import { settlePaidInvoice } from "./sales-db.ts";
import { order, rec } from "./fixtures.ts";

const invoicedSale = () =>
  fakeSupabase({
    orders: [order({ id: 1, status: "invoiced", buyer_username: "amy", paypal_invoice_id: "INV2-A" })],
    records: [
      rec({ id: 10, order_id: 1, price: 30, hold_buyer: "amy", hold_until: INVOICE_HOLD_UNTIL, paypal_invoice_id: "INV2-A" }),
      rec({ id: 11, order_id: 1, price: 40, negotiated_price: 35, hold_buyer: "amy", hold_until: INVOICE_HOLD_UNTIL, paypal_invoice_id: "INV2-A" }),
      rec({ id: 12, price: 20 }), // someone else's shelf
    ],
    order_requests: [
      { id: 5, status: "new", record_ids: [10, 11], created_at: "2026-09-20T00:00:00Z" },
      { id: 6, status: "new", record_ids: [12], created_at: "2026-09-20T00:00:00Z" },
    ],
  });

test("a paid invoice sells its order's records to the buyer at the agreed prices", async () => {
  const { client, db } = invoicedSale();
  const settled = await settlePaidInvoice(client, "INV2-A");
  assert.deepEqual(settled, { kind: "sold", orderId: 1, soldIds: [10, 11], failure: null });
  const [a, b, other] = db.tables.records;
  assert.equal(a.sold, true);
  assert.equal(a.sold_price, 30);
  assert.equal(b.sold_price, 35, "the negotiated price, not the listed one");
  assert.equal(a.buyer_username, "amy");
  assert.equal(a.hold_until, null);
  assert.equal(b.order_id, 1);
  assert.equal(other.sold, false);
  assert.equal(db.tables.orders[0].status, "paid");
  assert.equal(db.tables.order_requests[0].status, "completed");
  assert.equal(db.tables.order_requests[1].status, "new");
});

test("settling again is a no-op", async () => {
  const { client, db } = invoicedSale();
  await settlePaidInvoice(client, "INV2-A");
  const soldAt = db.tables.records[0].sold_at;
  assert.deepEqual(await settlePaidInvoice(client, "INV2-A"), { kind: "none" });
  assert.equal(db.tables.records[0].sold_at, soldAt);
  assert.deepEqual(await settlePaidInvoice(client, "INV2-UNKNOWN"), { kind: "none" });
});

test("a sale that stopped partway is finished by the next settle, in the same order", async () => {
  const { client, db } = invoicedSale();
  db.fail.push({ table: "records", id: 11, message: "network blip" });
  const first = await settlePaidInvoice(client, "INV2-A");
  assert.equal(first.kind, "sold");
  assert.equal(first.kind === "sold" && first.failure, "network blip");
  assert.equal(db.tables.records[1].sold, false);
  assert.equal(db.tables.orders[0].status, "paid");

  const retry = await settlePaidInvoice(client, "INV2-A");
  assert.deepEqual(retry, { kind: "sold", orderId: 1, soldIds: [11], failure: null });
  assert.equal(db.tables.records[1].sold, true);
  assert.equal(db.tables.records[1].order_id, 1);
  assert.equal(db.tables.orders.length, 1, "no second order");
});

test("paid, but every record moved on: the order just closes", async () => {
  const { client, db } = fakeSupabase({
    orders: [order({ id: 1, status: "invoiced", paypal_invoice_id: "INV2-A" })],
    records: [rec({ id: 10, sold: true, order_id: 2 })],
    order_requests: [],
  });
  assert.deepEqual(await settlePaidInvoice(client, "INV2-A"), { kind: "closed", orderId: 1 });
  assert.equal(db.tables.orders[0].status, "paid");
});
