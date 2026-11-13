import { NextRequest, NextResponse, after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
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
import { emailConfigured, sendEmail } from "@/lib/email";
import { adminPaidNotificationEmail } from "@/lib/order-request";

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
//
// The delivery that settles a payment also emails the admin — a paid
// invoice is otherwise silent. The email goes out after the response and
// never fails the webhook; a retry settles as "none", so it is sent once.
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
    const { paid, invoice } = await mirrorInvoice(supabase, invoiceId, payment);
    const settled: Settled = paid
      ? await settlePaidInvoice(supabase, invoiceId)
      : { kind: "none" };
    if (settled.kind === "sold" && settled.failure) {
      // Part of the sale landed; a retry sells the rest.
      throw new Error(
        `sold ${settled.soldIds.length} records, then failed: ${settled.failure}`
      );
    }
    if (settled.kind === "sold" || settled.kind === "closed") {
      const soldIds = settled.kind === "sold" ? settled.soldIds : [];
      const total = invoice.total != null ? Number(invoice.total) : null;
      after(() => notifyPaid(supabase, invoiceId, settled.orderId, soldIds, total));
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

// Tell the admin an invoice was paid. Best-effort: anything that goes
// wrong is logged and dropped, since the sale itself is already saved.
async function notifyPaid(
  supabase: SupabaseClient,
  invoiceId: string,
  orderId: number,
  soldIds: number[],
  total: number | null
) {
  try {
    if (!emailConfigured()) return;
    const [{ data: order }, { data: recs }] = await Promise.all([
      supabase
        .from("orders")
        .select("buyer_username, buyer_email")
        .eq("id", orderId)
        .maybeSingle(),
      soldIds.length
        ? supabase
            .from("records")
            .select("artist, title, sold_price")
            .in("id", soldIds)
            .order("artist")
            .order("title")
        : Promise.resolve({ data: [] }),
    ]);
    const sent = await sendEmail(
      adminPaidNotificationEmail({
        buyer: (order?.buyer_username as string | undefined) || "A buyer",
        buyerEmail: (order?.buyer_email as string | null | undefined) ?? null,
        invoiceId,
        total: total != null && Number.isFinite(total) ? total : null,
        items: (recs ?? []).map((r) => ({
          artist: r.artist as string,
          title: r.title as string,
          price: r.sold_price != null ? Number(r.sold_price) : null,
        })),
      })
    );
    if (!sent.ok) console.error("paypal-webhook: paid email failed:", sent.error);
  } catch (e) {
    console.error("paypal-webhook: paid email failed:", e instanceof Error ? e.message : e);
  }
}
