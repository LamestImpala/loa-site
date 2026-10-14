import type { NextRequest } from "next/server";
import { parseLeague } from "@/lib/pickem";
import { authorizeJob, researchGames } from "@/lib/pickem-server";

// Researches the news for one league's games that matter and kick off within
// four days (one Claude call with web search per game; researchGames in
// lib/pickem-server.ts), stores each digest as the "news" signal the house
// reads, and refreshes Pinnacle's line. A game researched in the last 20
// hours is skipped, so a run that hits the time limit is finished by the
// next one. `?dry=1` returns the digests without storing them (still spends
// Claude calls, skips Pinnacle); `?games=id1,id2` limits the run to those
// games. Same auth as the house route. Not on a schedule yet.
export const maxDuration = 300;

async function run(req: NextRequest, ctx: RouteContext<"/api/pickem/[league]/research">) {
  const league = parseLeague((await ctx.params).league);
  if (!league) return Response.json({ error: "unknown league" }, { status: 404 });
  if (!(await authorizeJob(req))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const q = req.nextUrl.searchParams;
  const games = q.get("games")?.split(",").map((s) => s.trim()).filter(Boolean);
  try {
    const result = await researchGames(league, new Date(), { dry: q.get("dry") === "1", games: games?.length ? games : undefined });
    return Response.json(result);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}

export const GET = run;
export const POST = run;
