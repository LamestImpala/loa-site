import type { NextRequest } from "next/server";
import { parseLeague } from "@/lib/pickem";
import { authorizeJob, generateHousePicks, jobLogLine, recordJobFailure } from "@/lib/pickem-server";
import { parseRepickScope } from "@/lib/pickem-repick";

// Asks Claude for house picks (spread, total, moneyline with confidence) on
// every upcoming game in one league that doesn't have them yet, then rebuilds
// that league's parlays for the week. `?force=1` re-picks the whole week,
// `?dry=1` returns what would be written without writing it, `?only=parlays`
// skips Claude and only rebuilds parlays. `?games=id1,id2` re-picks only
// those games and `?since=<iso>` only games whose news digest has news after
// that time (`since=call`: after each game's own call); the two combine, and
// either re-picks without `force` (lib/pickem-repick.ts). Both leagues run
// Tuesday morning Central, right after the week's first line sync, so the
// house locks early numbers. College runs again Saturday morning and the NFL on Thursday for
// games that reached the board late. The news pass is scheduled too (vercel.json):
// `?since=call` at 15:00 UTC Saturday for college and 15:30 UTC Thursday for the
// NFL, after that week's research runs (README, "Two-pass week"). Every run
// prints one line to the function log; a run that throws also writes a job
// row with the error (recordJobFailure), so a silent cron is never mistaken
// for a successful one.
export const maxDuration = 300;

async function run(req: NextRequest, ctx: RouteContext<"/api/pickem/[league]/house">) {
  const league = parseLeague((await ctx.params).league);
  if (!league) return Response.json({ error: "unknown league" }, { status: 404 });
  if (!(await authorizeJob(req))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const q = req.nextUrl.searchParams;
  const scope = parseRepickScope(q);
  if ("error" in scope) return Response.json({ error: scope.error }, { status: 400 });
  const opts = { force: q.get("force") === "1", dry: q.get("dry") === "1", onlyParlays: q.get("only") === "parlays", scope };
  const now = new Date();
  try {
    const result = await generateHousePicks(league, now, opts);
    console.log(jobLogLine(league, "house", now, { spend: result.spend }));
    return Response.json(result);
  } catch (e) {
    console.error(jobLogLine(league, "house", now, { error: e }));
    const recorded = await recordJobFailure({ league, job: "house", started_at: now, dry: opts.dry, params: { force: opts.force, only_parlays: opts.onlyParlays, scope } }, e);
    return Response.json({ error: (e as Error).message, recorded }, { status: 500 });
  }
}

export const GET = run;
export const POST = run;
