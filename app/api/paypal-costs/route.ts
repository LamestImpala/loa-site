import type { NextRequest } from "next/server";
import { sweepMissingCosts } from "@/lib/admin/costs-db";
import { authorizeJob } from "@/lib/job-auth";
import { getInvoicePayment, getTransactionDetails, paypalConfigured } from "@/lib/paypal";
import { serviceSupabase } from "@/lib/supabase-service";

// The delayed half of a PayPal sale. The webhook (or the inbox check)
// marks the sale the moment an invoice is paid, but PayPal publishes the
// seller fee and the buyer's ship-to to Transaction Search up to a few
// hours later. This job runs on the Vercel cron in vercel.json every half
// hour, asks again for each recent paid invoice still missing its fee,
// and records what has appeared — so the fulfillment card shows "ships
// to" and the fee without anyone clicking Sync. Refunds and trackers are
// still Sync's job.
export const maxDuration = 60;

async function run(req: NextRequest) {
  if (!(await authorizeJob(req))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!paypalConfigured()) {
    return Response.json({ error: "PayPal credentials are not configured" }, { status: 500 });
  }
  try {
    const sweep = await sweepMissingCosts(serviceSupabase(), async (invoiceId) => {
      const { transactionId, paymentDate } = await getInvoicePayment(invoiceId);
      if (!transactionId) return null; // marked paid outside PayPal
      return getTransactionDetails(transactionId, paymentDate);
    });
    if (sweep.checked.length > 0) {
      const filled = sweep.filled
        .map((f) => `${f.invoiceId} fee ${f.fee ?? "—"}${f.shipTo ? ` → ${f.shipTo}` : ""}`)
        .join("; ");
      console.log(
        `paypal-costs: checked ${sweep.checked.length}, filled ${sweep.filled.length}` +
          `${filled ? ` (${filled})` : ""}, pending ${sweep.pending.length}, skipped ${sweep.skipped.length}` +
          `${sweep.failed.length ? `, failed ${sweep.failed.map((f) => `${f.invoiceId}: ${f.error}`).join("; ")}` : ""}`
      );
    }
    return Response.json(sweep);
  } catch (e) {
    console.error("paypal-costs failed:", e instanceof Error ? e.message : e);
    return Response.json({ error: e instanceof Error ? e.message : "sweep failed" }, { status: 500 });
  }
}

export const GET = run;
export const POST = run;
