import type { NextRequest } from "next/server";
import { parseLeague } from "@/lib/pickem";
import { authorizeJob, syncLines } from "@/lib/pickem-server";

// Pulls one league's lines from The Odds API, refreshes its slate for the
// week, records a line snapshot, and grades its finished games. Runs on the
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
    return Response.json(result);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}

export const GET = run;
export const POST = run;
