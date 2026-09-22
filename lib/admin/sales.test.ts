// node --test lib/
import { test } from "node:test";
import assert from "node:assert/strict";
import type { OrderRequest } from "../supabase.ts";
import {
  finishedRequests,
  parseMoney,
  saleItem,
  salePrice,
  soldPatch,
  unsellPlan,
} from "./sales.ts";
import { DAY, iso, order, rec, shipment } from "./fixtures.ts";

const NOW = Date.parse("2026-09-13T12:00:00Z");
const at = new Date(NOW);

test("sold patch: desk buyer beats the hold's buyer beats the row's, holds always clear", () => {
  const held = rec({ price: 45, hold_buyer: "holder", hold_until: iso(NOW + DAY), buyer_username: " old " });
  assert.deepEqual(soldPatch(held, "desk", at), {
    sold: true,
    sold_at: at.toISOString(),
    sold_price: 45,
    negotiated_price: null,
    buyer_username: "desk",
    hold_buyer: null,
    hold_until: null,
    picked_at: null,
  });
  assert.equal(soldPatch(held, "", at).buyer_username, "holder");
  assert.equal(soldPatch(rec({ buyer_username: " old " }), "", at).buyer_username, "old");
  assert.equal(soldPatch(rec(), "", at).buyer_username, "");
  assert.equal(soldPatch(rec({ price: "12.5" as unknown as number }), "", at).sold_price, 12.5);
});

test("sold price: the desk's price beats the negotiated price beats the listed price", () => {
  const dealt = rec({ price: 40, negotiated_price: 32 });
  assert.equal(soldPatch(dealt, "", at).sold_price, 32, "a held order's deal lands");
  assert.equal(soldPatch(dealt, "", at, 30).sold_price, 30, "the desk overrides it");
  assert.equal(soldPatch(dealt, "", at, null).sold_price, 32, "null is no override");
  assert.equal(soldPatch(dealt, "", at).negotiated_price, null, "the deal is spent on sale");
  assert.equal(salePrice(rec({ price: 40 })), 40);
  assert.equal(salePrice(rec({ price: 40, negotiated_price: "35" as unknown as number })), 35);
  assert.deepEqual(saleItem(rec({ artist: "A", title: "T", media: "M", sleeve: "S", price: 40 }), 33), {
    artist: "A",
    title: "T",
    media: "M",
    sleeve: "S",
    price: 33,
    listedPrice: 40,
  });
});

test("parseMoney: blank is none, junk is invalid, amounts round to cents", () => {
  assert.equal(parseMoney(""), null);
  assert.equal(parseMoney("   "), null);
  assert.equal(parseMoney("abc"), undefined);
  assert.equal(parseMoney("-5"), undefined);
  assert.equal(parseMoney("0"), 0);
  assert.equal(parseMoney(" $12.345 "), 12.35);
  assert.equal(parseMoney("40"), 40);
});

const request = (id: number, status: OrderRequest["status"], record_ids: number[]): OrderRequest => ({
  id,
  ref_code: `CR-${id}`,
  buyer_username: "b",
  record_ids,
  items: [],
  subtotal: 0,
  shipping: 0,
  total: 0,
  status,
  created_at: "",
  updated_at: "",
});

test("an open request finishes once this sale sells its last record", () => {
  const byId = new Map([
    [1, rec({ id: 1 })],
    [2, rec({ id: 2, sold: true })],
    [3, rec({ id: 3 })],
  ]);
  const requests = [
    request(1, "loaded", [1, 2]),
    request(2, "loaded", [1, 3]),
    request(3, "new", [1]), // never loaded, still closes
    request(4, "loaded", [4]), // record not loaded at all
    request(5, "new", [2]), // already sold before — this sale didn't touch it
    request(6, "dismissed", [1]),
  ];
  const done = finishedRequests(requests, new Set([1]), byId);
  assert.deepEqual(done.map((r) => r.id), [1, 3]);
});

test("un-selling pulls records out of parcels and cancels an order left empty", () => {
  const a = rec({ id: 1, sold: true, order_id: 10 });
  const b = rec({ id: 2, sold: true, order_id: 10 });
  const c = rec({ id: 3, sold: true, order_id: 11, discogs_removed: true });
  const d = rec({ id: 4, order_id: 12 });
  const records = [a, b, c, d];
  const shipments = [
    shipment({ id: 100, record_ids: [1, 2] }),
    shipment({ id: 101, record_ids: [3] }), // untracked, left empty: deleted
    shipment({ id: 102, record_ids: [3], tracking_code: "9400" }), // kept as history
    shipment({ id: 103, record_ids: [3], status: "refunded" }), // left alone
  ];
  const orders = [
    order({ id: 10, status: "paid" }),
    order({ id: 11, status: "paid" }),
    order({ id: 12, status: "invoiced" }),
  ];
  const plan = unsellPlan([a, c, d], records, shipments, orders);
  assert.deepEqual(plan.parcels, [
    { id: 100, record_ids: [2], remove: false },
    { id: 101, record_ids: [], remove: true },
    { id: 102, record_ids: [], remove: false },
  ]);
  // 10 still has record 2; 12 is invoiced — its invoice gets cancelled first.
  assert.deepEqual(plan.cancelOrderIds, [11]);
  assert.deepEqual(plan.offDiscogs.map((r) => r.id), [3]);
});
