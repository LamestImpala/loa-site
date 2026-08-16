import { NextRequest, after } from "next/server";
import { createServerSupabase } from "@/lib/supabase";

// Unauthenticated by design — shoppers log interest events via sendBeacon.
// Validation here is the abuse guard; RLS only allows anon INSERTs.
const EVENTS = new Set(["photo_open", "discogs_click", "bundle_add", "buy_request"]);
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const recordId = body?.record_id;
  const event = body?.event;
  const sessionId = body?.session_id;
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
