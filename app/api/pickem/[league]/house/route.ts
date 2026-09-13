import type { NextRequest } from "next/server";
import { parseLeague } from "@/lib/pickem";
import { authorizeJob, generateHousePicks } from "@/lib/pickem-server";

// Asks Claude for house picks (spread, total, moneyline with confidence) on
// every upcoming game in one league that doesn't have them yet, then rebuilds
// that league's parlays for the week. `?force=1` re-picks the whole week,
// `?dry=1` returns what would be written without writing it, `?only=parlays`
// skips Claude and only rebuilds parlays. College runs Thursday midday and
// Saturday morning Central; the NFL runs Thursday morning, before the
// Thursday night game.
export const maxDuration = 300;

async function run(req: NextRequest, ctx: RouteContext<"/api/pickem/[league]/house">) {
  const league = parseLeague((await ctx.params).league);
  if (!league) return Response.json({ error: "unknown league" }, { status: 404 });
  if (!(await authorizeJob(req))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const q = req.nextUrl.searchParams;
  const opts = { force: q.get("force") === "1", dry: q.get("dry") === "1", onlyParlays: q.get("only") === "parlays" };
  try {
    const result = await generateHousePicks(league, new Date(), opts);
    return Response.json(result);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}

export const GET = run;
export const POST = run;
