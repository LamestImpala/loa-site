import type { NextRequest } from "next/server";
import { authorizeJob, generateHousePicks } from "@/lib/pickem-server";

// Asks Claude for house picks (spread, total, moneyline with confidence) on
// every upcoming game that doesn't have them yet, then rebuilds the week's
// parlays from the picks. `?force=1` re-picks the whole week, `?dry=1` returns
// what would be written without writing it, `?only=parlays` skips Claude and
// only rebuilds parlays. Runs Thursday midday and Saturday morning Central.
export const maxDuration = 300;

async function run(req: NextRequest) {
  if (!(await authorizeJob(req))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const q = req.nextUrl.searchParams;
  const opts = { force: q.get("force") === "1", dry: q.get("dry") === "1", onlyParlays: q.get("only") === "parlays" };
  try {
    const result = await generateHousePicks(new Date(), opts);
    return Response.json(result);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}

export const GET = run;
export const POST = run;
