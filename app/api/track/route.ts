import { NextRequest, after } from "next/server";
import { clientIp, visitorHash, visitorSecret } from "@/lib/rate-limit";
import { serviceSupabase } from "@/lib/supabase-service";
import { parseTrackBody } from "@/lib/track";
import { saveTrack } from "@/lib/track-db";

// Unauthenticated by design: shoppers log interest clicks and page visits
// via sendBeacon. This route is the only way a hit is saved. The public
// key can't insert into record_events or shop_visits, so every hit passes
// the shape check (parseTrackBody) and the per-visitor limit (saveTrack)
// before the service role writes it.
//
// A well-formed hit is always answered 204, saved or not: over the limit
// it is dropped without a word, because tracking must never show a
// shopper an error. The browser side skips the call entirely when the
// cr_no_track opt-out is set (track / trackVisit in shop-ui.tsx).

export async function POST(req: NextRequest) {
  const hit = parseTrackBody(await req.json().catch(() => null));
  if (!hit) return new Response(null, { status: 400 });
  const ip = clientIp(req.headers);
  // Respond immediately; the limit and the insert run after the response.
  after(async () => {
    try {
      await saveTrack(serviceSupabase(), hit, visitorHash(ip, visitorSecret()));
    } catch (e) {
      // No service key (local dev has none): nothing is saved.
      console.error("track:", e instanceof Error ? e.message : e);
    }
  });
  return new Response(null, { status: 204 });
}
