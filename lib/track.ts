// What a shopper's browser may send to /api/track: a click on a record
// (photo opened, Discogs link, added to bundle, request to buy) or a shop
// page load. The shape check here is the first abuse guard; anything that
// doesn't match is answered 400 and never reaches the database.

export const TRACK_EVENTS = ["photo_open", "discogs_click", "bundle_add", "buy_request"] as const;
export type TrackEventType = (typeof TRACK_EVENTS)[number];

export type TrackHit =
  | { kind: "event"; recordId: number; event: TrackEventType; sessionId: string }
  | {
      kind: "visit";
      sessionId: string;
      path: string;
      recordId: number | null;
      referrerHost: string | null;
    };

const EVENTS = new Set<string>(TRACK_EVENTS);
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PATH_RE = /^\/records(\/[\w\-./%]*)?$/;
const HOST_RE = /^[a-z0-9.-]{1,100}$/i;

const positiveInt = (v: unknown): v is number => Number.isInteger(v) && (v as number) > 0;

// The parsed hit, or null when the body isn't one.
export function parseTrackBody(body: unknown): TrackHit | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const sessionId = b.session_id;
  if (typeof sessionId !== "string" || !UUID_RE.test(sessionId)) return null;

  // A shop page load: { event: "visit", path, record_id?, referrer_host? }.
  if (b.event === "visit") {
    const { path, record_id: recordId, referrer_host: referrerHost } = b;
    if (typeof path !== "string" || path.length > 200 || !PATH_RE.test(path)) return null;
    if (recordId != null && !positiveInt(recordId)) return null;
    if (referrerHost != null && (typeof referrerHost !== "string" || !HOST_RE.test(referrerHost))) {
      return null;
    }
    return {
      kind: "visit",
      sessionId,
      path,
      recordId: (recordId as number | null | undefined) ?? null,
      referrerHost: (referrerHost as string | null | undefined)?.toLowerCase() ?? null,
    };
  }

  if (!positiveInt(b.record_id) || typeof b.event !== "string" || !EVENTS.has(b.event)) {
    return null;
  }
  return {
    kind: "event",
    recordId: b.record_id,
    event: b.event as TrackEventType,
    sessionId,
  };
}
