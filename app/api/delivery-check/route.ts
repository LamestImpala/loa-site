import type { NextRequest } from "next/server";
import { authorizeJob } from "@/lib/job-auth";
import { emailConfigured, sendEmail } from "@/lib/email";
import {
  cleanTrackingNumber,
  fetchShippoTrack,
  fromPayPalTracker,
  shippoConfigured,
  type TrackLookup,
} from "@/lib/delivery";
import { sweepDeliveries } from "@/lib/delivery-db";
import { getInvoicePayment, listTrackers, paypalConfigured } from "@/lib/paypal";
import { serviceSupabase } from "@/lib/supabase-service";

// Every few hours on the Vercel cron (vercel.json): find out which
// recently dropped-off boxes were delivered (shipments.delivered_at).
// PayPal is asked first — it's free, and labels bought inside PayPal may
// carry the carrier's status on their tracker. When PayPal doesn't say
// delivered, Shippo asks the carrier (about 2¢ per tracked number). What
// PayPal said about each box is logged, so the logs show whether PayPal
// ever reports deliveries. The daily review job then emails email buyers
// a few days after delivery; for a Reddit buyer the admin is emailed that
// the box landed. ?dry=1 asks without writing or emailing.
export const maxDuration = 60;

function lookupFor(paypalSaid: string[]): TrackLookup {
  return async (carrier, number, box) => {
    if (box && paypalConfigured()) {
      try {
        const txn =
          box.paypalTxn ??
          (box.paypalInvoiceId ? (await getInvoicePayment(box.paypalInvoiceId)).transactionId : null);
        if (txn) {
          const t = (await listTrackers(txn)).find((x) => cleanTrackingNumber(x.trackingNumber) === number);
          paypalSaid.push(`box #${box.id} ${t ? `${t.status}${t.updatedAt ? ` @${t.updatedAt}` : ""}` : "no tracker"}`);
          const delivered = fromPayPalTracker(t?.status, t?.updatedAt);
          if (delivered) return delivered;
        } else {
          paypalSaid.push(`box #${box.id} no transaction`);
        }
      } catch (e) {
        paypalSaid.push(`box #${box.id} error ${e instanceof Error ? e.message.slice(0, 120) : "lookup failed"}`);
      }
    }
    if (shippoConfigured()) return fetchShippoTrack(carrier, number);
    throw new Error("not delivered per PayPal, and SHIPPO_API_KEY is not set");
  };
}

async function run(req: NextRequest) {
  if (!(await authorizeJob(req))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!paypalConfigured() && !shippoConfigured()) {
    return Response.json({ skipped: "neither PayPal nor SHIPPO_API_KEY is configured" });
  }
  const dry = req.nextUrl.searchParams.get("dry") === "1";
  const paypalSaid: string[] = [];
  try {
    const sweep = await sweepDeliveries(serviceSupabase(), lookupFor(paypalSaid), {
      dry,
      notify: emailConfigured() ? sendEmail : undefined,
    });
    if (paypalSaid.length > 0) console.log(`delivery-check: PayPal says ${paypalSaid.join("; ")}`);
    if (sweep.checked > 0) {
      console.log(
        `delivery-check: checked ${sweep.checked}, delivered ${sweep.delivered.length}` +
          `${sweep.delivered.length ? ` (${sweep.delivered.map((d) => `box #${d.shipmentId}`).join(", ")})` : ""}` +
          `${sweep.notified.length ? `, emailed about ${sweep.notified.map((id) => `#${id}`).join(", ")}` : ""}` +
          `${sweep.failed.length ? `, failed ${sweep.failed.map((f) => `box #${f.shipmentId}: ${f.error.slice(0, 120)}`).join("; ")}` : ""}`
      );
    }
    return Response.json({ dry, paypal: paypalSaid, ...sweep });
  } catch (e) {
    console.error("delivery-check failed:", e instanceof Error ? e.message : e);
    return Response.json({ error: e instanceof Error ? e.message : "sweep failed" }, { status: 500 });
  }
}

export const GET = run;
export const POST = run;
