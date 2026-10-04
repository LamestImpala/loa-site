import type { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "@/lib/supabase";
import { PICKEM_SEASON } from "@/lib/pickem";
import { parseSlip, SLIP_MEDIA_TYPES, type SlipMediaType } from "@/lib/pickem-server";
import { reviewSlip, type SlipGame } from "@/lib/pickem-slip";

// Reads a player's bet slip screenshot. Claude turns the image into bets and
// ties each leg to a game on the board; the reply is that reading, checked
// against the board, for the player to confirm. Nothing is saved here (the
// browser saves through pickem_import_bet once the player confirms), and the
// image is held only for the length of the request: it is not written to
// storage or logs.
export const maxDuration = 60;

// Anyone can sign up by magic link and every read costs a Claude call.
const DAILY_LIMIT = 20;
// The browser downsizes to a JPEG well under this; Vercel caps a request body at 4.5 MB.
const MAX_BASE64_CHARS = 5_600_000;
// Kicked-off games stay in the list so their legs read as "started", not "not on the board".
const LOOKBACK_MS = 7 * 24 * 3600_000;

const err = (status: number, error: string) => Response.json({ error }, { status });

export async function POST(req: NextRequest) {
  const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    global: { headers: { Authorization: req.headers.get("authorization") ?? "" } },
    auth: { persistSession: false },
  });
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return err(401, "Sign in to import a bet slip.");

  let body: { image?: unknown; media_type?: unknown };
  try {
    body = await req.json();
  } catch {
    return err(400, "Send the screenshot as JSON.");
  }
  const { image, media_type } = body;
  if (typeof image !== "string" || !image || !SLIP_MEDIA_TYPES.includes(media_type as SlipMediaType)) {
    return err(400, "Send a JPEG, PNG or WebP screenshot.");
  }
  if (image.length > MAX_BASE64_CHARS) return err(413, "That image is too large.");

  const { data: profile } = await supabase.from("pickem_profiles").select("user_id").eq("user_id", user.id).maybeSingle();
  if (!profile) return err(403, "Pick a leaderboard name before importing a slip.");

  const now = new Date();
  const dayAgo = new Date(now.getTime() - 24 * 3600_000).toISOString();
  const { count, error: countError } = await supabase
    .from("pickem_slip_imports")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .gte("created_at", dayAgo);
  if (countError) return err(503, "Slip import is not set up yet.");
  if ((count ?? 0) >= DAILY_LIMIT) return err(429, `That's ${DAILY_LIMIT} slips in a day. Try again tomorrow.`);
  const { error: logError } = await supabase.from("pickem_slip_imports").insert({ user_id: user.id });
  if (logError) return err(503, "Slip import is not set up yet.");

  const { data: games, error: gamesError } = await supabase
    .from("pickem_games")
    .select("id, league, commence_time, home_team, away_team, spread_home, total, ml_home, ml_away")
    .eq("season", PICKEM_SEASON)
    .gt("commence_time", new Date(now.getTime() - LOOKBACK_MS).toISOString())
    .order("commence_time");
  if (gamesError) return err(502, "Could not load the board.");

  const parsed = await parseSlip({ data: image, mediaType: media_type as SlipMediaType }, (games ?? []) as SlipGame[], now);
  if (!parsed.ok) {
    console.error("pickem slip parse failed:", parsed.reason);
    return err(parsed.reason === "timeout" ? 504 : 502, "Could not read that screenshot. Try again, or try a clearer one.");
  }
  return Response.json(reviewSlip(parsed.slip, (games ?? []) as SlipGame[], now.getTime()));
}
