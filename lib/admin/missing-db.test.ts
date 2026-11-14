// node --test lib/
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeSupabase } from "./fake-supabase.ts";
import { removeMissing } from "./missing-db.ts";
import { missingPlan } from "./missing.ts";
import { order, rec, shipment } from "./fixtures.ts";

function setup() {
  const o = order({ id: 1, status: "paid", removed_total: 0 });
  const records = [
    rec({ id: 1, sold: true, sold_price: 53, order_id: 1 }),
    rec({ id: 2, sold: true, sold_price: 8, order_id: 1 }),
    rec({ id: 3, sold: true, sold_price: 9, order_id: 1 }),
  ];
  const boxes = [shipment({ id: 22, order_id: 1, record_ids: [1, 2] })];
  const { client, db } = fakeSupabase({
    orders: [{ ...o }],
    records: records.map((r) => ({ ...r })),
    shipments: boxes.map((s) => ({ ...s })),
  });
  return { o, records, boxes, client, db, plan: missingPlan(records[1], records, boxes, o) };
}

test("the record is deleted, leaves its box, and its price lands on the order", async () => {
  const { o, records, client, db, plan } = setup();
  const saved = await removeMissing(client, records[1], o, plan);
  assert.equal(saved.removed_total, 8);
  assert.equal(saved.status, "paid");
  assert.deepEqual(db.tables.records.map((r) => r.id), [1, 3]);
  assert.deepEqual(db.tables.shipments[0].record_ids, [1]);
});

test("nothing is deleted when the order write fails", async () => {
  const { o, records, client, db, plan } = setup();
  db.fail.push({ table: "orders", id: 1, message: 'column "removed_total" does not exist' });
  await assert.rejects(removeMissing(client, records[1], o, plan), /Couldn't update the order/);
  assert.equal(db.tables.records.length, 3);
  assert.deepEqual(db.tables.shipments[0].record_ids, [1, 2]);
});

test("a failed delete puts the order's total back", async () => {
  const { o, records, client, db, plan } = setup();
  db.fail.push({ table: "records", id: 2, message: "nope" });
  await assert.rejects(removeMissing(client, records[1], o, plan), /Couldn't delete the record: nope/);
  assert.equal(db.tables.orders[0].removed_total, 0);
  assert.equal(db.tables.records.length, 3);
});
