// node --test lib/
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  byLetter,
  byOrder,
  orderCounts,
  pickList,
  pickPatch,
  pickProgress,
} from "./pick-list.ts";
import { order, rec, shipment } from "./fixtures.ts";

const ids = (rows: { record: { id: number } }[]) => rows.map((r) => r.record.id);

test("only sold records in paid orders make the list", () => {
  const orders = [
    order({ id: 1, status: "paid", buyer_username: "amy" }),
    order({ id: 2, status: "held", buyer_username: "bob" }),
    order({ id: 3, status: "invoiced", buyer_username: "cat" }),
    order({ id: 4, status: "cancelled", buyer_username: "dan" }),
  ];
  const records = [
    rec({ id: 1, sold: true, order_id: 1 }),
    rec({ id: 2, sold: false, order_id: 1 }), // still held on a paid order — not sold
    rec({ id: 3, sold: true, order_id: 2 }),
    rec({ id: 4, sold: true, order_id: 3 }),
    rec({ id: 5, sold: true, order_id: 4 }),
  ];
  const rows = pickList(records, [], orders);
  assert.deepEqual(ids(rows), [1]);
  assert.equal(rows[0].buyer, "amy");
  assert.equal(rows[0].orderKey, "order-1");
});

test("tracked parcels hide their records; draft parcels and unassigned records stay", () => {
  const orders = [order({ id: 1, status: "paid" })];
  const records = [
    rec({ id: 1, sold: true, order_id: 1 }),
    rec({ id: 2, sold: true, order_id: 1 }),
    rec({ id: 3, sold: true, order_id: 1 }),
  ];
  const shipments = [
    shipment({ order_id: 1, record_ids: [1], tracking_code: "9400" }),
    shipment({ order_id: 1, record_ids: [2], tracking_code: null, status: "draft" }),
  ];
  assert.deepEqual(ids(pickList(records, shipments, orders)), [2, 3]);
});

test("packed but untracked parcels hide their records too", () => {
  const orders = [order({ id: 1, status: "paid" })];
  const records = [
    rec({ id: 1, sold: true, order_id: 1 }),
    rec({ id: 2, sold: true, order_id: 1 }),
  ];
  const shipments = [
    shipment({
      order_id: 1,
      record_ids: [1],
      tracking_code: null,
      status: "draft",
      packed_at: "2026-09-15T00:00:00Z",
    }),
  ];
  assert.deepEqual(ids(pickList(records, shipments, orders)), [2]);
});

test("a fully shipped order yields nothing", () => {
  const orders = [order({ id: 1, status: "paid" })];
  const records = [rec({ id: 1, sold: true, order_id: 1 }), rec({ id: 2, sold: true, order_id: 1 })];
  const shipments = [shipment({ order_id: 1, record_ids: [1, 2], tracking_code: "9400" })];
  assert.deepEqual(pickList(records, shipments, orders), []);
});

test("a refunded parcel with tracking does not hide its record", () => {
  const orders = [order({ id: 1, status: "paid" })];
  const records = [rec({ id: 1, sold: true, order_id: 1 })];
  const shipments = [
    shipment({ order_id: 1, record_ids: [1], tracking_code: "9400", status: "refunded" }),
  ];
  assert.deepEqual(ids(pickList(records, shipments, orders)), [1]);
});

test("sold records without an order group by buyer and count as paid", () => {
  const records = [
    rec({ id: 1, sold: true, buyer_username: "Zed" }),
    rec({ id: 2, sold: true, buyer_username: "zed " }),
  ];
  const rows = pickList(records, [], []);
  assert.deepEqual(ids(rows), [1, 2]);
  assert.equal(rows[0].order, null);
  assert.equal(rows[0].orderKey, rows[1].orderKey);
});

test("shelf order: artist then title, case-insensitive; digits land in #", () => {
  const orders = [order({ id: 1, status: "paid" })];
  const records = [
    rec({ id: 1, sold: true, order_id: 1, artist: "zappa", title: "Hot Rats" }),
    rec({ id: 2, sold: true, order_id: 1, artist: "Beatles", title: "Revolver" }),
    rec({ id: 3, sold: true, order_id: 1, artist: "Beatles", title: "Abbey Road" }),
    rec({ id: 4, sold: true, order_id: 1, artist: "10cc", title: "Sheet Music" }),
  ];
  const rows = pickList(records, [], orders);
  assert.deepEqual(ids(rows), [4, 3, 2, 1]);
  assert.deepEqual(
    byLetter(rows).map(([letter, rs]) => [letter, ids(rs)]),
    [["#", [4]], ["B", [3, 2]], ["Z", [1]]]
  );
});

test("by order: alphabetical by buyer, same-buyer orders stay apart, rows keep shelf order", () => {
  const orders = [
    order({ id: 1, status: "paid", buyer_username: "zed" }),
    order({ id: 2, status: "paid", buyer_username: "Amy" }),
    order({ id: 3, status: "paid", buyer_username: "amy" }),
  ];
  const records = [
    rec({ id: 1, sold: true, order_id: 1, artist: "B", picked_at: "2026-09-13T00:00:00Z" }),
    rec({ id: 2, sold: true, order_id: 2, artist: "Z" }),
    rec({ id: 3, sold: true, order_id: 2, artist: "A", picked_at: "2026-09-13T00:00:00Z" }),
    rec({ id: 4, sold: true, order_id: 3, artist: "C" }),
  ];
  const rows = pickList(records, [], orders);
  const groups = byOrder(rows);
  assert.deepEqual(
    groups.map((g) => [g.key, ids(g.rows), g.picked]),
    [["order-2", [3, 2], 1], ["order-3", [4], 0], ["order-1", [1], 1]]
  );
  assert.deepEqual([...orderCounts(rows)], [["order-2", 2], ["order-1", 1], ["order-3", 1]]);
  assert.deepEqual(pickProgress(rows), { picked: 2, total: 4 });
});

test("pick patch toggles picked_at", () => {
  const at = new Date("2026-09-13T12:00:00Z");
  assert.deepEqual(pickPatch(rec(), at), { picked_at: at.toISOString() });
  assert.deepEqual(pickPatch(rec({ picked_at: "2026-09-12T00:00:00Z" }), at), { picked_at: null });
});
