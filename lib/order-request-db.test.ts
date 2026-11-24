// node --test lib/
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeSupabase } from "./admin/fake-supabase.ts";
import type { OrderRequestBody } from "./order-request.ts";
import { PER_EMAIL_DAY, PER_VISITOR_HOUR, saveOrderRequest } from "./order-request-db.ts";

const NOW = Date.parse("2026-11-24T12:00:00Z");
const minsAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();

const email = (addr = "jane@example.com"): OrderRequestBody => ({
  channel: "email",
  recordIds: [3, 1],
  buyerName: "Jane",
  buyerEmail: addr,
  message: "Can you hold till Friday?",
});
const reddit: OrderRequestBody = {
  channel: "reddit",
  recordIds: [7],
  buyerUsername: "vinyl_fan",
  refCode: "CR-AB23",
};

// A saved row without the columns the database fills in.
const written = (row: Record<string, unknown>) => {
  const copy = { ...row };
  delete copy.id;
  delete copy.created_at;
  return copy;
};

// Earlier requests already in the table.
const sent = (n: number, over: Record<string, unknown>) =>
  Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    ref_code: `CR-OLD${i}`,
    created_at: minsAgo(10 + i),
    ...over,
  }));

test("save: an email request lands with its contact details and the visitor's hash", async () => {
  const { client, db } = fakeSupabase({ order_requests: [] });
  const r = await saveOrderRequest(client, email(), { refCode: "CR-XY45", visitor: "v1", now: NOW });
  assert.deepEqual(r, { ok: true });
  assert.equal(db.tables.order_requests.length, 1);
  assert.deepEqual(written(db.tables.order_requests[0]), {
    ref_code: "CR-XY45",
    record_ids: [3, 1],
    channel: "email",
    buyer_name: "Jane",
    buyer_email: "jane@example.com",
    message: "Can you hold till Friday?",
    ip_hash: "v1",
  });
});

test("save: a Reddit request goes through the same route with the DM's ref code", async () => {
  const { client, db } = fakeSupabase({ order_requests: [] });
  const r = await saveOrderRequest(client, reddit, { refCode: "CR-AB23", visitor: "v1", now: NOW });
  assert.deepEqual(r, { ok: true });
  assert.deepEqual(written(db.tables.order_requests[0]), {
    ref_code: "CR-AB23",
    record_ids: [7],
    channel: "reddit",
    buyer_username: "vinyl_fan",
    ip_hash: "v1",
  });
});

test("per-visitor limit: the sixth request in an hour is refused, either channel", async () => {
  const { client, db } = fakeSupabase({ order_requests: [] });
  for (let i = 0; i < PER_VISITOR_HOUR; i++) {
    // Different addresses each time: this is the visitor limit, not the email one.
    const body = i % 2 ? reddit : email(`buyer${i}@example.com`);
    const r = await saveOrderRequest(client, body, { refCode: `CR-A${i}`, visitor: "v1", now: NOW });
    assert.equal(r.ok, true, `request ${i + 1}`);
  }
  for (const body of [email("fresh@example.com"), reddit]) {
    const r = await saveOrderRequest(client, body, { refCode: "CR-ZZZZ", visitor: "v1", now: NOW });
    assert.deepEqual(r, {
      ok: false,
      status: 429,
      error: "Too many requests right now — please try again in a bit.",
    });
  }
  assert.equal(db.tables.order_requests.length, PER_VISITOR_HOUR, "nothing saved past the limit");
  // Someone else is unaffected: one sender can't switch ordering off for the shop.
  const other = await saveOrderRequest(client, email("fresh@example.com"), { refCode: "CR-BBBB", visitor: "v2", now: NOW });
  assert.equal(other.ok, true);
});

test("per-visitor limit: only the last hour counts", async () => {
  const { client } = fakeSupabase({
    order_requests: sent(PER_VISITOR_HOUR, { ip_hash: "v1", created_at: minsAgo(61) }),
  });
  const r = await saveOrderRequest(client, reddit, { refCode: "CR-AB23", visitor: "v1", now: NOW });
  assert.equal(r.ok, true);
});

test("per-email limit: an address gets three confirmations a day, whoever asks", async () => {
  const { client, db } = fakeSupabase({
    // Three earlier requests naming this address, each from a different visitor.
    order_requests: sent(PER_EMAIL_DAY, { buyer_email: "victim@example.com" }).map((r, i) => ({
      ...r,
      ip_hash: `other${i}`,
      created_at: minsAgo(60 * (i + 2)),
    })),
  });
  const refused = await saveOrderRequest(client, email("victim@example.com"), { refCode: "CR-CCCC", visitor: "new", now: NOW });
  assert.equal(refused.ok, false);
  assert.equal(!refused.ok && refused.status, 429);
  assert.equal(db.tables.order_requests.length, PER_EMAIL_DAY);
  // A different address from the same visitor is fine…
  assert.equal((await saveOrderRequest(client, email("someone@example.com"), { refCode: "CR-DDDD", visitor: "new", now: NOW })).ok, true);
  // …and the Reddit channel sends no email, so it has no email limit.
  assert.equal((await saveOrderRequest(client, reddit, { refCode: "CR-AB23", visitor: "new", now: NOW })).ok, true);
});

test("per-email limit: yesterday's requests don't count", async () => {
  const { client } = fakeSupabase({
    order_requests: sent(PER_EMAIL_DAY, { buyer_email: "jane@example.com", created_at: minsAgo(24 * 60 + 1) }),
  });
  assert.equal((await saveOrderRequest(client, email(), { refCode: "CR-EEEE", visitor: "v1", now: NOW })).ok, true);
});

test("save: the trigger's refusals keep their answers", async () => {
  const cases: [string, number, string][] = [
    ["rate limited", 429, "Too many requests right now — please try again in a bit."],
    ["no valid records", 409, "Those records are no longer available."],
    ["email required", 400, "Enter a valid email address"],
    ["duplicate key value violates unique constraint", 502, "Couldn't save the request"],
  ];
  for (const [message, status, error] of cases) {
    const { client, db } = fakeSupabase({ order_requests: [] });
    db.failInsert.push({ table: "order_requests", message });
    const r = await saveOrderRequest(client, email(), { refCode: "CR-XY45", visitor: "v1", now: NOW });
    assert.deepEqual(r, { ok: false, status, error }, message);
  }
});

test("save: before the migration (no ip_hash column) the request still saves, without the hash", async () => {
  const { client, db } = fakeSupabase({ order_requests: [] });
  db.failInsert.push({
    table: "order_requests",
    message: "Could not find the 'ip_hash' column of 'order_requests' in the schema cache",
    code: "PGRST204",
    when: (row) => "ip_hash" in row,
  });
  const r = await saveOrderRequest(client, reddit, { refCode: "CR-AB23", visitor: "v1", now: NOW });
  assert.deepEqual(r, { ok: true });
  assert.equal(db.tables.order_requests.length, 1);
  assert.ok(!("ip_hash" in db.tables.order_requests[0]));
});
