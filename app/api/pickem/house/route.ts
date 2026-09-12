import type { NextRequest } from "next/server";
import { authorizeJob, generateHousePicks } from "@/lib/pickem-server";

// Asks Claude for house picks (spread, total, moneyline with confidence) and
// parlays for every upcoming featured game that doesn't have them yet.
// `?force=1` re-picks the whole week. Runs Thursday and Saturday mornings.
export const maxDuration = 300;

async function run(req: NextRequest) {
  if (!(await authorizeJob(req))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const force = req.nextUrl.searchParams.get("force") === "1";
  try {
    const result = await generateHousePicks(new Date(), { force });
    return Response.json(result);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}

export const GET = run;
export const POST = run;
