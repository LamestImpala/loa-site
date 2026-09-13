// node --test lib/
import { test } from "node:test";
import assert from "node:assert/strict";
import type { RecordEventRow } from "../supabase.ts";
import { bucketEventsByDay, dayLabel, localDayKey, recentDays } from "./interest.ts";

// Local-time construction keeps these tests independent of the machine's
// timezone — the buckets are local days by design.
const local = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h);
const ev = (
  at: Date,
  session_id: string,
  event_type: RecordEventRow["event_type"] = "photo_open",
  record_id = 1
): RecordEventRow => ({ record_id, event_type, session_id, created_at: at.toISOString() });

test("day keys and labels use the local calendar", () => {
  assert.equal(localDayKey(local(2026, 9, 3, 23)), "2026-09-03");
  assert.equal(localDayKey(local(2026, 9, 3, 0)), "2026-09-03");
  assert.equal(dayLabel("2026-09-03"), local(2026, 9, 3).toLocaleDateString(undefined, { month: "short", day: "numeric" }));
});

test("events bucket per local day: raw clicks, distinct lookers, distinct askers", () => {
  const days = bucketEventsByDay([
    ev(local(2026, 9, 10, 9), "s1"),
    ev(local(2026, 9, 10, 10), "s1", "discogs_click"),
    ev(local(2026, 9, 10, 11), "s2", "bundle_add"),
    ev(local(2026, 9, 10, 12), "s2", "buy_request"),
    ev(local(2026, 9, 10, 13), "s2", "buy_request"),
    ev(local(2026, 9, 11, 23), "s3"),
    ev(local(2026, 9, 12, 0), "s3"),
  ]);
  assert.deepEqual(
    days.map((d) => [d.key, d.clicks, d.looked, d.asked]),
    [
      ["2026-09-12", 1, 1, 0],
      ["2026-09-11", 1, 1, 0],
      ["2026-09-10", 3, 2, 1],
    ],
    "newest first; buy requests don't count as clicks"
  );
  assert.equal(days[2].label, dayLabel("2026-09-10"));
});

test("the two-week strip is contiguous, zero-filled, oldest first, ending today", () => {
  const now = local(2026, 9, 13, 15);
  const strip = recentDays([ev(local(2026, 9, 5), "s1"), ev(local(2026, 8, 20), "s1")], 14, now);
  assert.equal(strip.length, 14);
  assert.equal(strip[0].key, "2026-08-31");
  assert.equal(strip.at(-1)!.key, "2026-09-13");
  assert.deepEqual(strip.filter((d) => d.clicks > 0).map((d) => d.key), ["2026-09-05"], "older activity is cut off");
  assert.deepEqual(strip[3], { key: "2026-09-03", label: dayLabel("2026-09-03"), clicks: 0, looked: 0, asked: 0 });
  assert.equal(recentDays([], 3, local(2026, 3, 1)).map((d) => d.key).join(","), "2026-02-27,2026-02-28,2026-03-01", "crosses a month boundary");
});
