import type { NextRequest } from "next/server";
import { authorizeJob, syncLines } from "@/lib/pickem-server";

// Pulls the week's lines from The Odds API, refreshes the featured slate,
// records a line snapshot, and grades finished games. Runs on the Vercel cron
// in vercel.json and from the admin page's "Refresh lines" button.
export const maxDuration = 60;

async function run(req: NextRequest) {
  if (!(await authorizeJob(req))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const result = await syncLines();
    return Response.json(result);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}

export const GET = run;
export const POST = run;
