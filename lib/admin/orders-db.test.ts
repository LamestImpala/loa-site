// node --test lib/
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeSupabase } from "./fake-supabase.ts";
import { setOrderCompleted } from "./orders-db.ts";
import { order } from "./fixtures.ts";

test("mark done stamps the order and leaves its status alone; reopen clears the stamp", async () => {
  const { client, db } = fakeSupabase({
    orders: [
      order({ id: 1, status: "paid", completed_at: null }),
      order({ id: 2, status: "paid", completed_at: null }),
    ],
  });
  const at = "2026-11-12T20:00:00.000Z";
  const done = await setOrderCompleted(client, 1, at);
  assert.equal(done.completed_at, at);
  assert.equal(done.status, "paid");
  assert.equal(db.tables.orders[1].completed_at, null, "only the order asked for");

  const reopened = await setOrderCompleted(client, 1, null);
  assert.equal(reopened.completed_at, null);
});

test("a failed write names what was being done", async () => {
  const { client, db } = fakeSupabase({ orders: [order({ id: 1, status: "paid", completed_at: null })] });
  db.fail.push({ table: "orders", id: 1, message: 'column "completed_at" does not exist' });
  await assert.rejects(
    setOrderCompleted(client, 1, "2026-11-12T20:00:00.000Z"),
    /Couldn't mark the order done: column "completed_at" does not exist/
  );
  db.fail.push({ table: "orders", id: 1, message: "nope" });
  await assert.rejects(setOrderCompleted(client, 1, null), /Couldn't reopen the order: nope/);
});
