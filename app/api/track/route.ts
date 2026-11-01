import { NextRequest, after } from "next/server";
import { createServerSupabase } from "@/lib/supabase";

// Unauthenticated by design — shoppers log interest events and page visits
// via sendBeacon. Validation here is the abuse guard; RLS only allows anon
// INSERTs.
const EVENTS = new Set(["photo_open", "discogs_click", "bundle_add", "buy_request"]);
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PATH_RE = /^\/records(\/[\w\-./%]*)?$/;
const HOST_RE = /^[a-z0-9.-]{1,100}$/i;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const recordId = body?.record_id;
  const event = body?.event;
  const sessionId = body?.session_id;
  if (event === "visit") return logVisit(body, sessionId);
  if (
    !Number.isInteger(recordId) ||
    recordId <= 0 ||
    typeof event !== "string" ||
    !EVENTS.has(event) ||
    typeof sessionId !== "string" ||
    !UUID_RE.test(sessionId)
  ) {
    return new Response(null, { status: 400 });
  }
  // Respond immediately; the insert runs after the response is sent.
  after(async () => {
    const { error } = await createServerSupabase()
      .from("record_events")
      .insert({ record_id: recordId, event_type: event, session_id: sessionId });
    if (error) console.error("track insert failed:", error.message);
  });
  return new Response(null, { status: 204 });
}

// A shop page load: { event: "visit", path, record_id?, referrer_host? }.
function logVisit(body: Record<string, unknown>, sessionId: unknown) {
  const { path, record_id: recordId, referrer_host: referrerHost } = body;
  if (
    typeof sessionId !== "string" ||
    !UUID_RE.test(sessionId) ||
    typeof path !== "string" ||
    path.length > 200 ||
    !PATH_RE.test(path) ||
    (recordId != null && (!Number.isInteger(recordId) || (recordId as number) <= 0)) ||
    (referrerHost != null &&
      (typeof referrerHost !== "string" || !HOST_RE.test(referrerHost)))
  ) {
    return new Response(null, { status: 400 });
  }
  after(async () => {
    const supabase = createServerSupabase();
    const row = {
      session_id: sessionId,
      path,
      record_id: (recordId as number | undefined) ?? null,
      referrer_host: (referrerHost as string | undefined)?.toLowerCase() ?? null,
    };
    let { error } = await supabase.from("shop_visits").insert(row);
    // A stale or mistyped record id fails the foreign key; keep the visit.
    if (error?.code === "23503") {
      ({ error } = await supabase
        .from("shop_visits")
        .insert({ ...row, record_id: null }));
    }
    if (error) console.error("visit insert failed:", error.message);
  });
  return new Response(null, { status: 204 });
}
