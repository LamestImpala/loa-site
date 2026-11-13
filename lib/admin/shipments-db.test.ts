// node --test lib/
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeSupabase } from "./fake-supabase.ts";
import {
  handOverOrder,
  handOverUndoPlan,
  markDroppedOff,
  undoDropOff,
  undoHandOver,
} from "./shipments-db.ts";

test("hand-over: unlabeled boxes marked handed over, loose records boxed the same way", async () => {
  const { client, db } = fakeSupabase({
    shipments: [
      { id: 21, order_id: 28, record_ids: [530], mode: "paypal", carrier: "USPS", status: "draft", sent_at: null },
    ],
  });
  const at = "2026-11-11T23:40:00.000Z";
  const { created, patch } = await handOverOrder(
    client,
    { buyer: "shescake", orderId: 28, invoiceId: null, looseIds: [531], boxIds: [21] },
    at
  );
  assert.deepEqual(patch, { mode: "hand", carrier: "In person", status: "shipped", sent_at: at });
  const [old, made] = db.tables.shipments;
  assert.equal(old.mode, "hand");
  assert.equal(old.sent_at, at);
  assert.equal(old.status, "shipped");
  assert.ok(created);
  assert.deepEqual(made.record_ids, [531]);
  assert.equal(made.order_id, 28);
  assert.equal(made.packed_at, at);
  assert.equal(made.mode, "hand");
  assert.equal(made.tracking_code ?? null, null);
});

test("hand-over with nothing loose makes no new box", async () => {
  const { client, db } = fakeSupabase({
    shipments: [{ id: 21, order_id: 28, record_ids: [530], mode: "paypal", status: "draft" }],
  });
  const { created } = await handOverOrder(client, {
    buyer: "shescake",
    orderId: 28,
    invoiceId: null,
    looseIds: [],
    boxIds: [21],
  });
  assert.equal(created, null);
  assert.equal(db.tables.shipments.length, 1);
});

test("undo hand-over: the box it made is deleted, a box sealed before goes back to waiting on a label", async () => {
  const { client, db } = fakeSupabase({
    shipments: [
      { id: 21, order_id: 28, record_ids: [530], mode: "paypal", carrier: "USPS", status: "draft", packed_at: "2026-11-10T18:00:00.000Z", sent_at: null },
      { id: 22, order_id: 28, record_ids: [529], mode: "manual", carrier: "USPS", status: "draft", packed_at: null, sent_at: null },
      { id: 30, order_id: 99, record_ids: [1], mode: "paypal", status: "shipped", tracking_code: "9400", sent_at: "2026-11-11T00:00:00.000Z" },
    ],
  });
  const at = "2026-11-11T23:40:00.000Z";
  const { created } = await handOverOrder(
    client,
    { buyer: "shescake", orderId: 28, invoiceId: null, looseIds: [531], boxIds: [21, 22] },
    at
  );
  assert.ok(created);
  const handed = db.tables.shipments.filter((s) => s.order_id === 28);
  assert.equal(handed.length, 3);

  const plan = await undoHandOver(client, handed as never);
  assert.deepEqual(plan.deleteIds, [created.id]);
  assert.deepEqual(plan.reverts.map((r) => r.id), [21, 22]);
  const after = db.tables.shipments;
  assert.deepEqual(after.map((s) => s.id), [21, 22, 30], "the box made for the loose record is gone");
  const [sealed, cardMade, other] = after;
  assert.deepEqual(
    [sealed.mode, sealed.carrier, sealed.status, sealed.sent_at],
    ["paypal", "USPS", "draft", null],
    "sealed on the pack page: a PayPal-label box again"
  );
  assert.equal(sealed.packed_at, "2026-11-10T18:00:00.000Z", "still sealed");
  assert.equal(cardMade.mode, "manual", "never sealed: made on the order card");
  assert.equal(other.sent_at, "2026-11-11T00:00:00.000Z", "another order's box is untouched");
});

test("undo hand-over leaves mailed boxes alone and reads timestamps, not their spelling", () => {
  const plan = handOverUndoPlan([
    { id: 1, mode: "paypal", packed_at: "2026-11-10T00:00:00Z", sent_at: "2026-11-11T00:00:00Z" },
    // Postgres spells the same instant differently from Date#toISOString.
    { id: 2, mode: "hand", packed_at: "2026-11-11T23:40:00+00:00", sent_at: "2026-11-11T23:40:00.000Z" },
    { id: 3, mode: "hand", packed_at: "2026-11-10T00:00:00Z", sent_at: "2026-11-11T23:40:00.000Z" },
  ]);
  assert.deepEqual(plan.deleteIds, [2]);
  assert.deepEqual(plan.reverts.map((r) => r.id), [3]);
});

test("drop-off stamps the ticked boxes, and undo clears just the ones handed back", async () => {
  const { client, db } = fakeSupabase({
    shipments: [
      { id: 1, tracking_code: "1", sent_at: null },
      { id: 2, tracking_code: "2", sent_at: null },
      { id: 3, tracking_code: "3", sent_at: null },
    ],
  });
  const at = await markDroppedOff(client, [1, 2], "2026-11-12T17:00:00.000Z");
  assert.equal(at, "2026-11-12T17:00:00.000Z");
  assert.deepEqual(db.tables.shipments.map((s) => s.sent_at), [at, at, null]);
  await undoDropOff(client, [2]);
  assert.deepEqual(db.tables.shipments.map((s) => s.sent_at), [at, null, null]);
});

test("a failed drop-off write says so", async () => {
  const { client, db } = fakeSupabase({ shipments: [{ id: 1, tracking_code: "1", sent_at: null }] });
  db.fail.push({ table: "shipments", id: 1, message: "permission denied" });
  await assert.rejects(markDroppedOff(client, [1]), /Couldn't mark dropped off: permission denied/);
  assert.equal(db.tables.shipments[0].sent_at, null);
});
