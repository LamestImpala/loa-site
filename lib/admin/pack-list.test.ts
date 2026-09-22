// node --test lib/
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  awaitingDropOff,
  manifestRows,
  openParcels,
  orderSheet,
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

test("manifest: open orders' boxes in pack order, labeled or not, then unboxed orders; done orders drop", () => {
  const orders = [
    order({ id: 1, status: "paid", buyer_username: "zed", ship_to: shipTo, paypal_invoice_id: "INV-1" }),
    order({ id: 2, status: "paid", buyer_username: "amy" }),
    order({ id: 3, status: "paid", buyer_username: "bob", paypal_invoice_id: "INV-3" }),
    order({ id: 4, status: "invoiced", buyer_username: "cal" }),
  ];
  const records = [
    rec({ id: 1, sold: true, order_id: 1 }),
    rec({ id: 2, sold: true, order_id: 1 }),
    rec({ id: 3, sold: true, order_id: 2 }),
    rec({ id: 4, sold: true, order_id: 3 }),
    rec({ id: 5, sold: true, order_id: 4 }),
  ];
  const shipments = [
    // zed: two boxes, both labeled, manual mode so they wait on "push"
    shipment({ id: 7, order_id: 1, record_ids: [1], tracking_code: "9400111", paypal_invoice_id: "INV-1", packed_at: "2026-09-15T10:00:00Z" }),
    shipment({ id: 8, order_id: 1, record_ids: [2], tracking_code: "9400222", paypal_invoice_id: "INV-1", packed_at: "2026-09-15T09:00:00Z" }),
    // bob: labeled, PayPal-bought (no push needed), fee synced → done
    shipment({ id: 9, order_id: 3, record_ids: [4], tracking_code: "9400333", mode: "paypal", paypal_invoice_id: "INV-3" }),
  ];
  const rows = manifestRows(records, shipments, orders, [
    { paypal_invoice_id: "INV-1", paypal_fee: null },
    { paypal_invoice_id: "INV-3", paypal_fee: 1.5 },
  ]);
  assert.deepEqual(
    rows.map((r) => [r.boxId, r.buyer, r.boxIndex, r.boxCount, r.tracking, r.records]),
    [
      [8, "zed", 1, 2, "9400222", 1],
      [7, "zed", 2, 2, "9400111", 1],
      [null, "amy", 1, 1, null, 1],
    ]
  );
  assert.equal(rows[0].shipTo?.name, "Jane Buyer");
});

test("order sheet: every paid order with a record not yet dropped off, labeled or not", () => {
  const orders = [
    order({ id: 1, status: "paid", buyer_username: "amy", ship_to: shipTo }),
    order({ id: 2, status: "paid", buyer_username: "bob" }),
    order({ id: 3, status: "paid", buyer_username: "cal" }),
    order({ id: 4, status: "invoiced", buyer_username: "dee" }),
  ];
  const records = [
    rec({ id: 1, sold: true, order_id: 1, artist: "Zappa" }),
    rec({ id: 2, sold: true, order_id: 1, artist: "Beatles" }),
    rec({ id: 3, sold: true, order_id: 1, artist: "Abba" }),
    rec({ id: 4, sold: true, order_id: 1, artist: "Cream" }),
    rec({ id: 5, sold: true, order_id: 2 }),
    rec({ id: 6, sold: true, order_id: 3, artist: "Can" }),
    rec({ id: 7, sold: true, order_id: 4 }),
  ];
  const shipments = [
    shipment({ id: 7, order_id: 1, record_ids: [3], packed_at: "2026-09-15T00:00:00Z", status: "draft" }),
    shipment({ id: 8, order_id: 1, record_ids: [4], packed_at: "2026-09-15T01:00:00Z", tracking_code: "9400", status: "shipped" }),
    shipment({ id: 9, order_id: 2, record_ids: [5], tracking_code: "9401", status: "shipped", sent_at: "2026-09-16T00:00:00Z" }),
    shipment({ id: 10, order_id: 3, record_ids: [6], tracking_code: "9402", status: "shipped" }),
  ];
  const sheet = orderSheet(records, shipments, orders);
  assert.deepEqual(
    sheet.map((o) => [o.buyer, o.shipToName, o.records.map((r) => [r.artist, r.boxId, r.labeled])]),
    [
      ["amy", "Jane Buyer", [["Beatles", null, false], ["Zappa", null, false], ["Abba", 7, false], ["Cream", 8, true]]],
      ["cal", null, [["Can", 10, true]]],
    ]
  );
});

test("awaiting drop-off: labeled, not sent, not refunded, in pack order", () => {
  const list = awaitingDropOff([
    shipment({ id: 3, tracking_code: "1", packed_at: "2026-09-15T02:00:00Z" }),
    shipment({ id: 1, tracking_code: null }),
    shipment({ id: 2, tracking_code: "2", sent_at: "2026-09-16T00:00:00Z" }),
    shipment({ id: 4, tracking_code: "3", status: "refunded" }),
    shipment({ id: 5, tracking_code: "4", packed_at: "2026-09-15T01:00:00Z" }),
  ]);
  assert.deepEqual(list.map((s) => s.id), [5, 3]);
});
