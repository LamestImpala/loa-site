// node --test lib/
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  openParcels,
  packList,
  packProgress,
  slipsForParcels,
  sortByPackOrder,
} from "./pack-list.ts";
import { order, rec, shipment } from "./fixtures.ts";

const shipTo = {
  name: "Jane Buyer",
  line1: "1 Main",
  line2: null,
  city: "Tempe",
  state: "AZ",
  postal_code: "85281",
  country_code: "US",
};

test("paid, unfinished orders only; loose records in shelf order with the pulled count", () => {
  const orders = [
    order({ id: 1, status: "paid", buyer_username: "zed", ship_to: shipTo }),
    order({ id: 2, status: "invoiced", buyer_username: "amy" }),
    order({ id: 3, status: "paid", buyer_username: "bob" }),
  ];
  const records = [
    rec({ id: 1, sold: true, order_id: 1, artist: "Zappa", picked_at: "2026-09-15T00:00:00Z" }),
    rec({ id: 2, sold: true, order_id: 1, artist: "Beatles" }),
    rec({ id: 3, sold: true, order_id: 2 }),
    rec({ id: 4, sold: true, order_id: 3 }),
  ];
  const shipments = [shipment({ order_id: 3, record_ids: [4], tracking_code: "9400" })];
  const list = packList(records, shipments, orders);
  assert.deepEqual(
    list.map((o) => [o.key, o.buyer, o.loose.map((r) => r.id), o.pulled]),
    [["order-1", "zed", [2, 1], 1]]
  );
  assert.equal(list[0].shipTo?.name, "Jane Buyer");
});

test("an order with everything boxed but a box untracked stays on the table", () => {
  const orders = [order({ id: 1, status: "paid" })];
  const records = [rec({ id: 1, sold: true, order_id: 1 })];
  const shipments = [
    shipment({ id: 7, order_id: 1, record_ids: [1], packed_at: "2026-09-15T00:00:00Z", status: "draft" }),
  ];
  const list = packList(records, shipments, orders);
  assert.equal(list.length, 1);
  assert.deepEqual(list[0].loose, []);
  assert.deepEqual(list[0].parcels.map((s) => s.id), [7]);
  assert.deepEqual(packProgress(list), { orders: 1, loose: 0, boxes: 1 });
});

test("pack order: sealed boxes by packed_at, unsealed parcels after, ties by id", () => {
  const sorted = sortByPackOrder([
    shipment({ id: 3, packed_at: null }),
    shipment({ id: 2, packed_at: "2026-09-15T10:00:00Z" }),
    shipment({ id: 9, packed_at: "2026-09-15T09:00:00Z" }),
    shipment({ id: 1, packed_at: null }),
  ]);
  assert.deepEqual(sorted.map((s) => s.id), [9, 2, 1, 3]);
});

test("slips: box position among the order's boxes, parcel snapshot beats the order's ship-to", () => {
  const o = order({ id: 1, status: "paid", buyer_username: "zed", ship_to: shipTo });
  const r1 = rec({ id: 1, artist: "Zappa", title: "Hot Rats" });
  const r2 = rec({ id: 2, artist: "Beatles", title: "Revolver" });
  const all = [
    shipment({ id: 5, order_id: 1, record_ids: [1], packed_at: "2026-09-15T10:00:00Z" }),
    shipment({
      id: 4,
      order_id: 1,
      record_ids: [2],
      packed_at: "2026-09-15T09:00:00Z",
      to_address: { ...shipTo, name: "Jane At Work" },
    }),
    shipment({ id: 6, order_id: 1, record_ids: [], status: "refunded" }),
  ];
  const slips = slipsForParcels(
    [all[0], all[1]],
    all,
    new Map([[1, r1], [2, r2]]),
    new Map([[1, o]])
  );
  assert.deepEqual(
    slips.map((s) => [s.boxId, s.boxIndex, s.boxCount, s.shipTo?.name, s.records.map((r) => r.title)]),
    [
      [4, 1, 2, "Jane At Work", ["Revolver"]],
      [5, 2, 2, "Jane Buyer", ["Hot Rats"]],
    ]
  );
  assert.equal(slips[0].buyer, "zed");
});

test("open parcels: untracked and not refunded, sealed ones first, card-made ones after", () => {
  const open = openParcels([
    shipment({ id: 3, packed_at: null, tracking_code: null, status: "draft" }),
    shipment({ id: 1, packed_at: "2026-09-15T10:00:00Z", tracking_code: null, status: "draft" }),
    shipment({ id: 2, packed_at: "2026-09-15T09:00:00Z", tracking_code: "9400", status: "shipped" }),
    shipment({ id: 4, packed_at: "2026-09-15T08:00:00Z", tracking_code: null, status: "refunded" }),
  ]);
  assert.deepEqual(open.map((s) => s.id), [1, 3]);
});
