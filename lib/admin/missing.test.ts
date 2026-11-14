// node --test lib/
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  missingBlock,
  missingPlan,
  missingSupported,
  photoPaths,
  refundOffSold,
  refundOwed,
} from "./missing.ts";
import { salesStats } from "./stats.ts";
import { order, rec, shipment } from "./fixtures.ts";

const paid = (over = {}) => order({ id: 1, status: "paid", removed_total: 0, ...over });
const sold = (id: number, price: number, over = {}) =>
  rec({ id, sold: true, sold_price: price, order_id: 1, ...over });

test("a loose record on a paid order with other items can go missing", () => {
  const records = [sold(1, 53), sold(2, 8), sold(3, 9)];
  const boxes = [shipment({ id: 22, order_id: 1, record_ids: [1, 3] })];
  assert.equal(missingBlock(records[1], records, boxes, paid()), null);
  assert.deepEqual(missingPlan(records[1], records, boxes, paid()), {
    price: 8,
    removedTotal: 8,
    parcels: [],
  });
});

test("it leaves an untracked box; a box left empty is deleted", () => {
  const records = [sold(1, 53), sold(2, 8), sold(3, 9)];
  const boxes = [
    shipment({ id: 22, order_id: 1, record_ids: [1, 2] }),
    shipment({ id: 23, order_id: 1, record_ids: [3] }),
  ];
  assert.deepEqual(missingPlan(records[1], records, boxes, paid()).parcels, [
    { id: 22, record_ids: [1], remove: false },
  ]);
  assert.deepEqual(missingPlan(records[2], records, boxes, paid()).parcels, [
    { id: 23, record_ids: [], remove: true },
  ]);
});

test("a second missing item adds to what the order already had removed", () => {
  const records = [sold(1, 53), sold(3, 9.5)];
  const plan = missingPlan(records[1], records, [], paid({ removed_total: 8 }));
  assert.deepEqual([plan.price, plan.removedTotal], [9.5, 17.5]);
});

test("not offered: unsold, shipped, the only item, or before the migration", () => {
  const records = [sold(1, 53), sold(2, 8)];
  assert.match(
    missingBlock(rec({ id: 9 }), records, [], paid()) ?? "",
    /isn't on a paid order/
  );
  assert.match(
    missingBlock(records[1], records, [], order({ id: 1, status: "refunded", removed_total: 0 })) ?? "",
    /isn't on a paid order/
  );
  const tracked = [shipment({ order_id: 1, record_ids: [2], tracking_code: "9400" })];
  assert.match(missingBlock(records[1], records, tracked, paid()) ?? "", /already has tracking/);
  const handed = [shipment({ order_id: 1, record_ids: [2], mode: "hand", status: "shipped" })];
  assert.match(missingBlock(records[1], records, handed, paid()) ?? "", /already has tracking/);
  assert.match(
    missingBlock(records[1], [records[1]], [], paid()) ?? "",
    /only item on this order — refund the whole payment/
  );
  const before = order({ id: 1, status: "paid" });
  assert.equal(missingSupported(before), false);
  assert.match(missingBlock(records[1], records, [], before) ?? "", /migration/);
});

test("a refund that pays back a missing item isn't taken off the sold total twice", () => {
  // Sold $53 + $8 + $9; the $8 record couldn't be found and is gone.
  const records = [sold(1, 53), sold(3, 9)];
  const stats = (o: ReturnType<typeof paid>) =>
    salesStats({ records, orders: [o], invoices: [], shipments: [] });
  // Before the refund syncs, and after: $62 either way.
  assert.equal(stats(paid({ removed_total: 8 })).soldTotal, 62);
  const synced = stats(paid({ removed_total: 8, refunded_amount: 8 }));
  assert.deepEqual([synced.soldTotal, synced.refundedTotal], [62, 0]);
  // A refund beyond the missing item (a make-good on top) still counts.
  const more = stats(paid({ removed_total: 8, refunded_amount: 13 }));
  assert.deepEqual([more.soldTotal, more.refundedTotal], [57, 5]);
});

test("refundOwed is what's still to pay back for missing items", () => {
  assert.equal(refundOwed(paid({ removed_total: 8 })), 8);
  assert.equal(refundOwed(paid({ removed_total: 8, refunded_amount: 8 })), 0);
  assert.equal(refundOwed(paid({ removed_total: 8, refunded_amount: 20 })), 0);
  assert.equal(refundOwed(paid({ refunded_amount: 5 })), 0);
  assert.equal(refundOwed(null), 0);
  assert.equal(refundOffSold(order({ status: "paid", refunded_amount: 5 })), 5, "no column yet");
});

test("photoPaths reads storage paths out of public photo URLs", () => {
  assert.deepEqual(
    photoPaths({
      photo_urls: [
        "https://x.supabase.co/storage/v1/object/public/record-photos/368/a%20b.jpg",
        "https://i.discogs.com/cover.jpeg",
      ],
    }),
    ["368/a b.jpg"]
  );
});
