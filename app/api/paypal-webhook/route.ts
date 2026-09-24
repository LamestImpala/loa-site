import { NextRequest, NextResponse } from "next/server";
import { mirrorInvoice } from "@/lib/admin/invoices-db";
import { settlePaidInvoice, type Settled } from "@/lib/admin/sales-db";
import {
  WEBHOOK_HEADERS,
  getInvoicePayment,
  invoiceIdFromEvent,
  paypalConfigured,
  verifyWebhookSignature,
} from "@/lib/paypal";
import { serviceSupabase } from "@/lib/supabase-service";

// PayPal calls this when one of our invoices changes, so a payment lands
// as a sale without anyone opening the admin. Registered in the PayPal
// developer dashboard (live app → Webhooks) for the Invoicing events, at
// https://curiouserrecords.com/api/paypal-webhook; its id is
// PAYPAL_WEBHOOK_ID.
//
// Nothing in the event body is trusted: the delivery must pass PayPal's
// signature check, and then the invoice is read fresh from PayPal — the
// same mirror + settle the inbox's Check PayPal runs. Both are safe to
// repeat, so PayPal's retries (anything but a 2xx is retried for days)
// and the inbox check can't double a sale. Only invoices the admin
// created are touched. The fee and ship-to arrive later, via the
// /api/paypal-costs cron. A refund still closes through Sync on the Send
// page.
export async function POST(req: NextRequest) {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId || !paypalConfigured()) {
    console.error("paypal-webhook: PAYPAL_WEBHOOK_ID or PayPal credentials not set");
    return NextResponse.json({ error: "Webhook not configured" }, { status: 503 });
  }

  const rawBody = await req.text();
  const headers = Object.fromEntries(
    WEBHOOK_HEADERS.map((h) => [h, req.headers.get(h)])
  ) as Record<(typeof WEBHOOK_HEADERS)[number], string | null>;
  let genuine = false;
  try {
    genuine = await verifyWebhookSignature(headers, rawBody, webhookId);
  } catch (e) {
    // PayPal unreachable: a 5xx makes it deliver again later.
    console.error("paypal-webhook:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Verification unavailable" }, { status: 502 });
  }
  if (!genuine) {
    console.warn("paypal-webhook: signature check failed");
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  let event: { id?: string; event_type?: string };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const type = event.event_type ?? "";
  if (!type.startsWith("INVOICING.INVOICE.")) {
    return NextResponse.json({ ignored: type || "unknown event" });
  }
  const invoiceId = invoiceIdFromEvent(event);
  if (!invoiceId) {
    console.warn(`paypal-webhook: ${type} ${event.id} has no invoice id`);
    return NextResponse.json({ ignored: "no invoice id" });
  }

  try {
    const supabase = serviceSupabase();
    // Ours only: an invoice the admin sent has an invoices row or an order.
    const [{ data: row }, { data: orderRow }] = await Promise.all([
      supabase
        .from("invoices")
        .select("paypal_invoice_id")
        .eq("paypal_invoice_id", invoiceId)
        .maybeSingle(),
      supabase
        .from("orders")
        .select("id")
        .eq("paypal_invoice_id", invoiceId)
        .limit(1)
        .maybeSingle(),
    ]);
    if (!row && !orderRow) {
      return NextResponse.json({ ignored: `unknown invoice ${invoiceId}` });
    }

    const payment = await getInvoicePayment(invoiceId);
    const { paid } = await mirrorInvoice(supabase, invoiceId, payment);
    const settled: Settled = paid
      ? await settlePaidInvoice(supabase, invoiceId)
      : { kind: "none" };
    if (settled.kind === "sold" && settled.failure) {
      // Part of the sale landed; a retry sells the rest.
      throw new Error(
        `sold ${settled.soldIds.length} records, then failed: ${settled.failure}`
      );
    }
    console.log(
      `paypal-webhook: ${type} ${invoiceId} → ${payment.status}, ${settled.kind}${
        settled.kind === "sold" ? ` (${settled.soldIds.length} records)` : ""
      }`
    );
    return NextResponse.json({ ok: true, status: payment.status, settled: settled.kind });
  } catch (e) {
    console.error(
      `paypal-webhook: ${type} ${invoiceId} failed:`,
      e instanceof Error ? e.message : e
    );
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }
}
