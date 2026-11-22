// node --test lib/
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeSupabase } from "./fake-supabase.ts";
import { combineOrders, setOrderCompleted, splitOrders } from "./orders-db.ts";
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

test("combine points the plan's orders at the sale's first order; split clears it", async () => {
  const { client, db } = fakeSupabase({
    orders: [
      order({ id: 27, status: "paid", combined_into: null }),
      order({ id: 29, status: "paid", combined_into: null }),
      order({ id: 31, status: "paid", combined_into: null }),
    ],
  });
  const saved = await combineOrders(client, { rootId: 27, ids: [29, 31] });
  assert.deepEqual(saved.map((o) => [o.id, o.combined_into]), [[29, 27], [31, 27]]);
  assert.equal(db.tables.orders[0].combined_into, null, "the first order itself is untouched");
  assert.equal(saved[0].status, "paid");

  const split = await splitOrders(client, [29]);
  assert.deepEqual(split.map((o) => [o.id, o.combined_into]), [[29, null]]);
  assert.equal(db.tables.orders[2].combined_into, 27, "only the order asked for");
});

test("a failed combine or split says so", async () => {
  const { client, db } = fakeSupabase({ orders: [order({ id: 29, status: "paid" })] });
  db.fail.push({ table: "orders", id: 29, message: 'column "combined_into" does not exist' });
  await assert.rejects(
    combineOrders(client, { rootId: 27, ids: [29] }),
    /Couldn't combine the orders: column "combined_into" does not exist/
  );
  db.fail.push({ table: "orders", id: 29, message: "nope" });
  await assert.rejects(splitOrders(client, [29]), /Couldn't split the orders: nope/);
});
