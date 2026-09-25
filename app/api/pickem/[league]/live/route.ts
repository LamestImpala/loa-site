import type { NextRequest } from "next/server";
import { parseLeague, type League } from "@/lib/pickem";
import { liveScores } from "@/lib/pickem-server";
import type { LivePayload } from "@/lib/pickem-live";

// Live scores for one league's games in play, from ESPN's public
// scoreboard. Public and read-mostly: the board polls it every 30 s while a
// game is on. Finals it sees are graded into pickem_games on the way
// through (with the service key), which is why the crons in vercel.json
// also hit it after the late games. Cached here and at the CDN so a room
// full of viewers costs ESPN one request per 20 s.
export const maxDuration = 30;

const TTL_MS = 20_000;
const cache = new Map<League, { at: number; body: LivePayload }>();
const FRESH = { "Cache-Control": "public, s-maxage=20, stale-while-revalidate=60" };
const STALE = { "Cache-Control": "no-store" };

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/pickem/[league]/live">) {
  const league = parseLeague((await ctx.params).league);
  if (!league) return Response.json({ error: "unknown league" }, { status: 404 });
  const hit = cache.get(league);
  if (hit && Date.now() - hit.at < TTL_MS) return Response.json(hit.body, { headers: FRESH });
  try {
    const body = await liveScores(league);
    cache.set(league, { at: Date.now(), body });
    return Response.json(body, { headers: FRESH });
  } catch (e) {
    // ESPN hiccup: hand back what we had rather than blanking the board.
    if (hit) return Response.json(hit.body, { headers: STALE });
    return Response.json({ error: (e as Error).message }, { status: 502, headers: STALE });
  }
}
