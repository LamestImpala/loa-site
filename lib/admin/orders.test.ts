// node --test lib/
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Order, OrderRequest } from "../supabase.ts";
import {
  advanceStatus,
  fallbackBuyer,
  openOrders,
  pickOrder,
  requestForOrder,
} from "./orders.ts";
import { DAY, invoice, iso, order, rec } from "./fixtures.ts";

const NOW = Date.parse("2026-09-13T12:00:00Z");

test("an order only moves forward", () => {
  assert.equal(advanceStatus("held", "invoiced"), "invoiced");
  assert.equal(advanceStatus("invoiced", "held"), "invoiced");
  assert.equal(advanceStatus("invoiced", "paid"), "paid");
  assert.equal(advanceStatus("paid", "held"), "paid");
});

test("a sale continues in the one open order its records share, for the same buyer", () => {
  const orders = new Map<number, Order>([
    [1, order({ id: 1, buyer_username: "Amy", status: "held" })],
    [2, order({ id: 2, buyer_username: "bob", status: "invoiced" })],
    [3, order({ id: 3, buyer_username: "cal", status: "paid" })],
    [4, order({ id: 4, buyer_username: "dee", status: "cancelled" })],
  ]);
  const held = rec({ order_id: 1 });
  assert.equal(pickOrder([held, rec()], "amy ", orders)?.id, 1, "case-insensitive; unlinked records join");
  assert.equal(pickOrder([held], "", orders)?.id, 1, "blank buyer defers to the order's");
  assert.equal(pickOrder([held], "zed", orders), null, "a different buyer starts a new order");
  assert.equal(pickOrder([rec({ order_id: 2 })], "bob", orders)?.id, 2);
  assert.equal(pickOrder([rec({ order_id: 3 })], "cal", orders), null, "paid orders are closed");
  assert.equal(pickOrder([rec({ order_id: 4 })], "dee", orders), null, "so are cancelled ones");
  assert.equal(pickOrder([held, rec({ order_id: 2 })], "", orders), null, "records from two orders");
  assert.equal(pickOrder([rec(), rec()], "amy", orders), null, "nothing to continue");
  assert.equal(pickOrder([rec({ order_id: 9 })], "amy", orders), null, "unknown order");
});

test("a blank desk buyer falls back to a hold, then the row's last buyer", () => {
  assert.equal(fallbackBuyer([rec(), rec({ hold_buyer: " holder " })]), "holder");
  assert.equal(fallbackBuyer([rec({ buyer_username: "old" }), rec({ hold_buyer: "h" })]), "old");
  assert.equal(fallbackBuyer([rec()]), "");
});

const request = (id: number, status: OrderRequest["status"], record_ids: number[]): OrderRequest => ({
  id,
  ref_code: `CR-${id}`,
  buyer_username: null,
  record_ids,
  items: [],
  subtotal: 0,
  shipping: 0,
  total: 0,
  status,
  created_at: "",
  updated_at: "",
});

test("an order fulfils the first open request whose records it covers", () => {
  const requests = [
    request(1, "completed", [1, 2]),
    request(2, "loaded", [1, 2, 3]),
    request(3, "new", [1, 2]),
    request(4, "loaded", []),
  ];
  assert.equal(requestForOrder([1, 2], requests)?.id, 3);
  assert.equal(requestForOrder([1, 2, 3], requests)?.id, 2);
  assert.equal(requestForOrder([5], requests), null);
});

test("open orders: held ones need a live hold, invoiced ones outlive their records", () => {
  const records = [
    rec({ id: 1, order_id: 10, hold_buyer: "amy", hold_until: iso(NOW + DAY) }),
    rec({ id: 2, order_id: 10, hold_until: iso(NOW + 2 * DAY) }),
    rec({ id: 3, order_id: 10, sold: true }),
    rec({ id: 4, order_id: 11, hold_until: iso(NOW - 1) }), // lapsed hold
    rec({ id: 5, order_id: 12, sold: true }), // invoiced order, all sold
    rec({ id: 6, order_id: 13 }), // paid order
    rec({ id: 7, order_id: 14, hold_until: iso(NOW - DAY) }), // invoiced, hold expired
    rec({ id: 8 }),
  ];
  const orders = [
    order({ id: 10, buyer_username: " amy ", status: "held", created_at: "2026-09-10T00:00:00Z" }),
    order({ id: 11, buyer_username: "bob", status: "held", created_at: "2026-09-11T00:00:00Z" }),
    order({ id: 12, buyer_username: "cal", status: "invoiced", paypal_invoice_id: "INV-C", created_at: "2026-09-12T00:00:00Z" }),
    order({ id: 13, buyer_username: "dee", status: "paid", created_at: "2026-09-13T00:00:00Z" }),
    order({ id: 14, buyer_username: "eve", status: "invoiced", paypal_invoice_id: "INV-E", created_at: "2026-09-09T00:00:00Z" }),
    order({ id: 15, buyer_username: "fay", status: "held", created_at: "2026-09-08T00:00:00Z" }), // no records at all
    order({ id: 16, buyer_username: "gus", status: "cancelled", created_at: "2026-09-14T00:00:00Z" }),
  ];
  const open = openOrders(orders, records, [invoice({ paypal_invoice_id: "INV-E" })], NOW);
  assert.deepEqual(
    open.map((o) => [o.order.id, o.buyer, o.recs.map((r) => r.id), o.expired, o.invoice?.paypal_invoice_id ?? null]),
    [
      [12, "cal", [], false, null],
      [11, "bob", [4], true, null],
      [10, "amy", [1, 2], false, null],
      [14, "eve", [7], false, "INV-E"],
    ],
    "newest first; sold members drop off; lapsed holds are flagged, not hidden"
  );
  const amy = open[2];
  assert.equal(amy.holdUntil, NOW + 2 * DAY, "latest expiry among members");
  assert.equal(amy.totals.total, 66, "two records: $60 plus $6 shipping");
  assert.equal(open[1].holdUntil, NOW - 1);
});

test("open order totals use negotiated prices and take the order's credit off", () => {
  const records = [
    rec({ id: 1, order_id: 20, price: 40, negotiated_price: 30, hold_until: iso(NOW + DAY) }),
    rec({ id: 2, order_id: 20, price: 20, hold_until: iso(NOW + DAY) }),
  ];
  const [o] = openOrders(
    [order({ id: 20, buyer_username: "amy", status: "held", credit: 10, credit_note: "make-good" })],
    records,
    [],
    NOW
  );
  assert.equal(o.totals.subtotal, 50, "$30 agreed plus $20 listed");
  assert.equal(o.totals.credit, 10);
  assert.equal(o.totals.total, 46, "$50 − $10 credit + $6 shipping");
  assert.match(o.totals.lines[0], /\$30 \(listed \$40\)$/);
  assert.doesNotMatch(o.totals.lines[1], /listed/);
});
