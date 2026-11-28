import type { NextRequest } from "next/server";
import { authorizeJob } from "@/lib/job-auth";
import { emailConfigured, sendEmail } from "@/lib/email";
import { fetchShippoTrack, shippoConfigured } from "@/lib/delivery";
import { sweepDeliveries } from "@/lib/delivery-db";
import { serviceSupabase } from "@/lib/supabase-service";

// Once a day on the Vercel cron (vercel.json), at 02:00 UTC — 6 pm Pacific
// in winter, 7 pm in summer, after the day's deliveries: ask Shippo where each
// recently dropped-off box is, and mark the ones the carrier scanned
// delivered (shipments.delivered_at). The daily review job then emails
// email buyers a few days after delivery; for a Reddit buyer the admin is
// emailed that the box landed and the review DM is theirs to send. Until
// SHIPPO_API_KEY is set this does nothing and says so. ?dry=1 asks Shippo
// and reports without writing or emailing.
export const maxDuration = 60;

async function run(req: NextRequest) {
  if (!(await authorizeJob(req))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!shippoConfigured()) {
    return Response.json({ skipped: "SHIPPO_API_KEY is not set" });
  }
  const dry = req.nextUrl.searchParams.get("dry") === "1";
  try {
    const sweep = await sweepDeliveries(serviceSupabase(), (carrier, number) => fetchShippoTrack(carrier, number), {
      dry,
      notify: emailConfigured() ? sendEmail : undefined,
    });
    if (sweep.checked > 0) {
      console.log(
        `delivery-check: checked ${sweep.checked}, delivered ${sweep.delivered.length}` +
          `${sweep.delivered.length ? ` (${sweep.delivered.map((d) => `box #${d.shipmentId}`).join(", ")})` : ""}` +
          `${sweep.notified.length ? `, emailed about ${sweep.notified.map((id) => `#${id}`).join(", ")}` : ""}` +
          `${sweep.failed.length ? `, failed ${sweep.failed.map((f) => `box #${f.shipmentId}: ${f.error}`).join("; ")}` : ""}`
      );
    }
    return Response.json({ dry, ...sweep });
  } catch (e) {
    console.error("delivery-check failed:", e instanceof Error ? e.message : e);
    return Response.json({ error: e instanceof Error ? e.message : "sweep failed" }, { status: 500 });
  }
}

export const GET = run;
export const POST = run;
