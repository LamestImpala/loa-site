import type { SupabaseClient } from "@supabase/supabase-js";
import { hitAllowed } from "./rate-limit.ts";
import type { TrackHit } from "./track.ts";

// Saving shopper tracking (/api/track) and expiring it. The route is the
// only way in: the public key can no longer insert into record_events or
// shop_visits, so every hit passes the shape check in track.ts and the
// per-visitor limit here before the service role writes it. Each table
// also has a backstop trigger that silently drops rows past a shop-wide
// hourly total (see the newest tracking_backstop in supabase/migrations/).

// One visitor (hashed IP, see rate-limit.ts) may log this many clicks and
// page loads together per window. The busiest browser session so far
// logged about 40 in ten minutes, and the whole shop's busiest hour held
// 160, so a real shopper, or a household behind one address, stays far
// under it.
export const TRACK_PER_VISITOR = 120;
export const TRACK_WINDOW_SECONDS = 10 * 60;

// "dropped" is a hit over the visitor's limit: not saved, and not an error.
export type TrackResult = "saved" | "dropped" | "failed";

export async function saveTrack(
  db: SupabaseClient,
  hit: TrackHit,
  visitor: string
): Promise<TrackResult> {
  const allowed = await hitAllowed(db, {
    scope: "track",
    visitor,
    max: TRACK_PER_VISITOR,
    windowSeconds: TRACK_WINDOW_SECONDS,
  });
  if (!allowed) return "dropped";

  if (hit.kind === "event") {
    const { error } = await db.from("record_events").insert({
      record_id: hit.recordId,
      event_type: hit.event,
      session_id: hit.sessionId,
    });
    if (!error) return "saved";
    console.error("track insert failed:", error.message);
    return "failed";
  }

  const row = {
    session_id: hit.sessionId,
    path: hit.path,
    record_id: hit.recordId,
    referrer_host: hit.referrerHost,
  };
  let { error } = await db.from("shop_visits").insert(row);
  // A stale or mistyped record id fails the foreign key; keep the visit.
  if (error?.code === "23503") {
    ({ error } = await db.from("shop_visits").insert({ ...row, record_id: null }));
  }
  if (!error) return "saved";
  console.error("visit insert failed:", error.message);
  return "failed";
}

// Tracking is kept this long. The admin's "Interest by day" reads the last
// 60 days; the per-record "N looked · N asked" counts (record_interest
// view) cover whatever is kept.
export const TRACK_KEEP_DAYS = 365;

const TRACKING_TABLES = ["record_events", "shop_visits"] as const;

export type TrackExpiry = {
  before: string; // rows older than this go
  record_events: number;
  shop_visits: number;
  errors: string[];
};

// Deletes clicks and page loads older than TRACK_KEEP_DAYS, for the daily
// job. `dry` only counts them. One table failing doesn't stop the other.
export async function expireTracking(
  db: SupabaseClient,
  opts: { dry?: boolean; now?: number } = {}
): Promise<TrackExpiry> {
  const before = new Date(
    (opts.now ?? Date.now()) - TRACK_KEEP_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();
  const out: TrackExpiry = { before, record_events: 0, shop_visits: 0, errors: [] };
  for (const table of TRACKING_TABLES) {
    const { count, error } = opts.dry
      ? await db.from(table).select("id", { count: "exact", head: true }).lt("created_at", before)
      : await db.from(table).delete({ count: "exact" }).lt("created_at", before);
    if (error) out.errors.push(`${table}: ${error.message}`);
    else out[table] = count ?? 0;
  }
  return out;
}
