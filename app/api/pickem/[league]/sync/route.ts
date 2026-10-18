import type { NextRequest } from "next/server";
import { parseLeague } from "@/lib/pickem";
import {
  authorizeJob,
  captureCfbd,
  captureFpi,
  captureNflEpa,
  captureNflInjuries,
  captureSchedule,
  captureWeather,
  syncLines,
} from "@/lib/pickem-server";

// Pulls one league's lines from The Odds API, refreshes its slate for the
// week, records a line snapshot, and grades its finished games. It also
// stores what the house is later shown for each upcoming game: ESPN's FPI
// prediction and CollegeFootballData ratings for college, nflverse EPA and
// Sleeper injuries for the NFL, and for both the forecast at kickoff
// (Open-Meteo) and each team's rest (from our own schedule), once a day
// each. None of these spend Odds API requests. Runs on the
// Vercel cron in vercel.json (/api/pickem/ncaaf/sync, /api/pickem/nfl/sync)
// and from the admin page's "Refresh lines" button.
export const maxDuration = 60;

async function run(req: NextRequest, ctx: RouteContext<"/api/pickem/[league]/sync">) {
  const league = parseLeague((await ctx.params).league);
  if (!league) return Response.json({ error: "unknown league" }, { status: 404 });
  if (!(await authorizeJob(req))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const result = await syncLines(league);
    // Research data and house signals; a failure here must not fail the line sync.
    const safe = <T,>(p: Promise<T>) => p.catch((e: Error) => ({ error: e.message }));
    const both = Promise.all([safe(captureWeather(league)), safe(captureSchedule(league))]);
    if (league === "nfl") {
      const [[epa, injuries], [weather, schedule]] = await Promise.all([Promise.all([safe(captureNflEpa()), safe(captureNflInjuries())]), both]);
      return Response.json({ ...result, epa, injuries, weather, schedule });
    }
    const [[fpi, cfbd], [weather, schedule]] = await Promise.all([Promise.all([safe(captureFpi()), safe(captureCfbd())]), both]);
    return Response.json({ ...result, fpi, cfbd, weather, schedule });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}

export const GET = run;
export const POST = run;
