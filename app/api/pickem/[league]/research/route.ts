import type { NextRequest } from "next/server";
import { parseLeague } from "@/lib/pickem";
import { authorizeJob, jobLogLine, recordJobFailure, researchGames } from "@/lib/pickem-server";

// Researches the news for one league's games that matter and kick off within
// four days (one Claude call with web search per game; researchGames in
// lib/pickem-server.ts), stores each digest as the "news" signal the house
// reads, and refreshes Pinnacle's line. A game researched in the last 20
// hours is skipped, so a run that hits the time limit is finished by the
// next one. `?dry=1` returns the digests without storing them (still spends
// Claude calls, skips Pinnacle); `?games=id1,id2` limits the run to those
// games. Same auth as the house route. Scheduled (vercel.json): college 14:00 and
// 20:00 UTC Friday, the NFL 21:00 UTC Wednesday and 14:00 UTC Thursday, ahead of
// each league's news pass (README, "Two-pass week"). Every run prints one
// line to the function log; a run that throws also writes a job row with the
// error (recordJobFailure), so a silent cron is never mistaken for a
// successful one.
export const maxDuration = 300;

async function run(req: NextRequest, ctx: RouteContext<"/api/pickem/[league]/research">) {
  const league = parseLeague((await ctx.params).league);
  if (!league) return Response.json({ error: "unknown league" }, { status: 404 });
  if (!(await authorizeJob(req))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const q = req.nextUrl.searchParams;
  const games = q.get("games")?.split(",").map((s) => s.trim()).filter(Boolean);
  const dry = q.get("dry") === "1";
  const now = new Date();
  try {
    const result = await researchGames(league, now, { dry, games: games?.length ? games : undefined });
    console.log(jobLogLine(league, "research", now, { spend: result.spend }));
    return Response.json(result);
  } catch (e) {
    console.error(jobLogLine(league, "research", now, { error: e }));
    const recorded = await recordJobFailure({ league, job: "research", started_at: now, dry, params: games?.length ? { games } : {} }, e);
    return Response.json({ error: (e as Error).message, recorded }, { status: 500 });
  }
}

export const GET = run;
export const POST = run;
