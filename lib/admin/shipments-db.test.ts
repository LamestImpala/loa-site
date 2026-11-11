// node --test lib/
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeSupabase } from "./fake-supabase.ts";
import { handOverOrder } from "./shipments-db.ts";

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
