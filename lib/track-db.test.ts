// node --test lib/
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeSupabase, type FakeDb } from "./admin/fake-supabase.ts";
import type { TrackHit } from "./track.ts";
import {
  TRACK_KEEP_DAYS,
  TRACK_PER_VISITOR,
  TRACK_WINDOW_SECONDS,
  expireTracking,
  saveTrack,
} from "./track-db.ts";

const SID = "3f2b8c1e-5d47-4a9b-8e21-0c6d9f7a1b23";
const click: TrackHit = { kind: "event", recordId: 118, event: "photo_open", sessionId: SID };
const visit: TrackHit = {
  kind: "visit",
  sessionId: SID,
  path: "/records/r/118-eric-clapton",
  recordId: 118,
  referrerHost: "reddit.com",
};

// A stand-in for the rate_hit() database function: the same counting, in
// one window. Records what it was called with.
function withCounter(db: FakeDb) {
  const hits = new Map<string, number>();
  const calls: Record<string, unknown>[] = [];
  db.rpcs.rate_hit = (args) => {
    calls.push(args);
    const key = `${args.p_scope}:${args.p_visitor}`;
    const n = hits.get(key) ?? 0;
    if (n >= (args.p_max as number)) return { data: false, error: null };
    hits.set(key, n + 1);
    return { data: true, error: null };
  };
  return calls;
}

// A saved row without the columns the database fills in.
const written = (row: Record<string, unknown>) => {
  const copy = { ...row };
  delete copy.id;
  delete copy.created_at;
  return copy;
};

test("save: a click lands in record_events, a page load in shop_visits", async () => {
  const { client, db } = fakeSupabase({ record_events: [], shop_visits: [] });
  const calls = withCounter(db);
  assert.equal(await saveTrack(client, click, "v1"), "saved");
  assert.equal(await saveTrack(client, visit, "v1"), "saved");
  assert.deepEqual(db.tables.record_events.map(written), [
    { record_id: 118, event_type: "photo_open", session_id: SID },
  ]);
  assert.deepEqual(db.tables.shop_visits.map(written), [
    {
      session_id: SID,
      path: "/records/r/118-eric-clapton",
      record_id: 118,
      referrer_host: "reddit.com",
    },
  ]);
  // The visitor's hash is counted, never stored on the tracking rows.
  assert.deepEqual(calls[0], {
    p_scope: "track",
    p_visitor: "v1",
    p_max: TRACK_PER_VISITOR,
    p_window_seconds: TRACK_WINDOW_SECONDS,
  });
  assert.ok(!JSON.stringify(db.tables).includes("v1"));
});

test("per-visitor limit: clicks and visits share it, and the hit past it is dropped silently", async () => {
  const { client, db } = fakeSupabase({ record_events: [], shop_visits: [] });
  withCounter(db);
  for (let i = 0; i < TRACK_PER_VISITOR; i++) {
    assert.equal(await saveTrack(client, i % 2 ? click : visit, "v1"), "saved", `hit ${i + 1}`);
  }
  const errors: unknown[] = [];
  const realError = console.error;
  console.error = (...a: unknown[]) => errors.push(a);
  try {
    assert.equal(await saveTrack(client, click, "v1"), "dropped");
    assert.equal(await saveTrack(client, visit, "v1"), "dropped");
  } finally {
    console.error = realError;
  }
  assert.deepEqual(errors, [], "a dropped hit is not an error");
  assert.equal(db.tables.record_events.length + db.tables.shop_visits.length, TRACK_PER_VISITOR);
  // Somebody else is not held back by it.
  assert.equal(await saveTrack(client, visit, "v2"), "saved");
});

test("limit: before the migration (no rate_hit function yet) hits still save", async () => {
  const { client, db } = fakeSupabase({ record_events: [], shop_visits: [] });
  assert.equal(await saveTrack(client, click, "v1"), "saved");
  assert.equal(db.tables.record_events.length, 1);
});

test("visit: a stale record id keeps the visit without it", async () => {
  const { client, db } = fakeSupabase({ shop_visits: [] });
  withCounter(db);
  db.failInsert.push({
    table: "shop_visits",
    message: "violates foreign key constraint",
    code: "23503",
    when: (row) => row.record_id != null,
  });
  assert.equal(await saveTrack(client, visit, "v1"), "saved");
  assert.equal(db.tables.shop_visits.length, 1);
  assert.equal(db.tables.shop_visits[0].record_id, null);
  assert.equal(db.tables.shop_visits[0].path, "/records/r/118-eric-clapton");
});

test("save: a refused insert is reported, not thrown", async () => {
  const { client, db } = fakeSupabase({ record_events: [], shop_visits: [] });
  withCounter(db);
  db.failInsert.push({ table: "record_events", message: "permission denied" });
  db.failInsert.push({ table: "shop_visits", message: "permission denied" });
  const realError = console.error;
  console.error = () => {};
  try {
    assert.equal(await saveTrack(client, click, "v1"), "failed");
    assert.equal(await saveTrack(client, visit, "v1"), "failed");
  } finally {
    console.error = realError;
  }
  assert.equal(db.tables.record_events.length + db.tables.shop_visits.length, 0);
});

const NOW = Date.parse("2027-12-01T17:00:00Z");
const daysAgo = (d: number) => new Date(NOW - d * 24 * 60 * 60 * 1000).toISOString();
const aged = () => ({
  record_events: [
    { id: 1, created_at: daysAgo(TRACK_KEEP_DAYS + 30) },
    { id: 2, created_at: daysAgo(TRACK_KEEP_DAYS + 1) },
    { id: 3, created_at: daysAgo(TRACK_KEEP_DAYS - 1) },
    { id: 4, created_at: daysAgo(2) },
  ],
  shop_visits: [
    { id: 1, created_at: daysAgo(TRACK_KEEP_DAYS + 200) },
    { id: 2, created_at: daysAgo(59) },
  ],
});

test("expiry: deletes clicks and visits older than a year, keeps the rest", async () => {
  const { client, db } = fakeSupabase(aged());
  const r = await expireTracking(client, { now: NOW });
  assert.deepEqual(r, {
    before: daysAgo(TRACK_KEEP_DAYS),
    record_events: 2,
    shop_visits: 1,
    errors: [],
  });
  assert.deepEqual(db.tables.record_events.map((x) => x.id), [3, 4]);
  assert.deepEqual(db.tables.shop_visits.map((x) => x.id), [2]);
});

test("expiry: a dry run counts the same rows and deletes none", async () => {
  const { client, db } = fakeSupabase(aged());
  const r = await expireTracking(client, { dry: true, now: NOW });
  assert.equal(r.record_events, 2);
  assert.equal(r.shop_visits, 1);
  assert.equal(db.tables.record_events.length, 4);
  assert.equal(db.tables.shop_visits.length, 2);
});

test("expiry: one table failing doesn't stop the other", async () => {
  const { client, db } = fakeSupabase(aged());
  db.fail.push({ table: "record_events", id: 1, message: "timeout" });
  const r = await expireTracking(client, { now: NOW });
  assert.deepEqual(r.errors, ["record_events: timeout"]);
  assert.equal(r.shop_visits, 1);
  assert.equal(db.tables.record_events.length, 4);
  assert.equal(db.tables.shop_visits.length, 1);
});
