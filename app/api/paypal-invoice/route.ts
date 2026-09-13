import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  ADMIN_EMAIL,
  SUPABASE_PUBLISHABLE_KEY,
  SUPABASE_URL,
  type Invoice,
  type Order,
  type OrderRequest,
} from "@/lib/supabase";
import { bundleBreakdown } from "@/lib/records";
import { placeOrder, type PlacedOrder } from "@/lib/admin/orders-db";
import {
  cancelInvoice,
  createAndSendInvoice,
  getInvoicePayment,
  PAID_STATUSES,
  paypalConfigured,
} from "@/lib/paypal";

// PayPal invoices for Reddit sales. PayPal credentials only exist
// server-side, so the admin page calls this route instead of PayPal
// directly. Supabase writes go through the caller's own token, so RLS
// still enforces the admin policy.
//
//   POST   { ids, buyer, email? }  — create + send an invoice for a set of
//     records, put them in an order (invoiced), hold them for the buyer,
//     and save a pending `invoices` row (with the payment link) so the
//     order survives clearing the sale desk.
//   GET    ?id=INV2-…              — read the invoice's status from PayPal
//     and mirror it (status, payment link, paid_at) onto the row.
//   DELETE ?id=INV2-…              — cancel the invoice on PayPal, cancel
//     its order, and release the records (stamp + hold + order cleared).

const HOLD_HOURS = 48;

async function adminClient(req: NextRequest) {
  const authHeader = req.headers.get("authorization") ?? "";
  const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || user.email !== ADMIN_EMAIL) return null;
  return supabase;
}

function invoiceIdFrom(req: NextRequest): string | null {
  const id = req.nextUrl.searchParams.get("id")?.trim() ?? "";
  return /^[A-Z0-9-]{6,64}$/i.test(id) ? id : null;
}

export async function POST(req: NextRequest) {
  const supabase = await adminClient(req);
  if (!supabase) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }

  if (!paypalConfigured()) {
    return NextResponse.json(
      { error: "PayPal credentials are not configured on the server" },
      { status: 500 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const ids: number[] = Array.isArray(body.ids) ? [...new Set<number>(body.ids)] : [];
  if (
    ids.length === 0 ||
    ids.length > 50 ||
    ids.some((id) => !Number.isInteger(id) || id <= 0)
  ) {
    return NextResponse.json({ error: "Invalid record ids" }, { status: 400 });
  }
  const buyer =
    typeof body.buyer === "string"
      ? body.buyer.trim().replace(/^u\//, "")
      : "";
  if (!buyer) {
    return NextResponse.json({ error: "Missing buyer username" }, { status: 400 });
  }
  const email =
    typeof body.email === "string" && body.email.trim()
      ? body.email.trim()
      : undefined;
  if (email && !/.+@.+\..+/.test(email)) {
    return NextResponse.json({ error: "Invalid buyer email" }, { status: 400 });
  }

  const { data: recs, error: fetchError } = await supabase
    .from("records")
    .select(
      "id, artist, title, media, sleeve, price, sold, order_id, hold_buyer, buyer_username"
    )
    .in("id", ids);
  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 502 });
  }
  if (!recs || recs.length !== ids.length) {
    const foundIds = new Set((recs ?? []).map((r) => r.id));
    return NextResponse.json(
      {
        error: "Some records were not found",
        missingIds: ids.filter((id) => !foundIds.has(id)),
      },
      { status: 400 }
    );
  }
  const soldIds = recs.filter((r) => r.sold).map((r) => r.id);
  if (soldIds.length > 0) {
    return NextResponse.json(
      { error: "Some records are already sold", soldIds },
      { status: 409 }
    );
  }
  // Keep invoice line order matching the order the admin selected.
  recs.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));

  const breakdown = bundleBreakdown(recs.map((r) => ({ ...r, price: Number(r.price) })));

  try {
    const result = await createAndSendInvoice({
      items: recs.map((r) => ({
        name: `${r.artist} — ${r.title}`.slice(0, 200),
        description: `Media: ${r.media} / Sleeve: ${r.sleeve}`,
        value: Number(r.price).toFixed(2),
      })),
      shippingValue: breakdown.shipping.toFixed(2),
      note: `Vinyl records for Reddit user u/${buyer} — thanks! Shipped USPS Media Mail from Phoenix, AZ.`,
      memo: `Reddit sale to u/${buyer}`,
      recipientEmail: email,
    });
    const now = new Date().toISOString();
    const holdUntil = new Date(Date.now() + HOLD_HOURS * 3600 * 1000).toISOString();
    // The order: continue the open one these records share, else a new
    // one, now invoiced. Non-fatal: the invoice already exists.
    let placed: PlacedOrder | null = null;
    let orderError: string | null = null;
    try {
      const { data: openRequests } = await supabase
        .from("order_requests")
        .select("*")
        .in("status", ["new", "loaded"])
        .order("created_at", { ascending: false })
        .limit(50);
      placed = await placeOrder(supabase, recs, buyer, "invoiced", {
        requests: (openRequests ?? []) as OrderRequest[],
        extra: { paypal_invoice_id: result.invoiceId },
      });
    } catch (e) {
      orderError = e instanceof Error ? e.message : "Couldn't save the order";
      console.error("paypal-invoice: order failed:", orderError);
    }
    // Link the records to the invoice so fulfillment can find the PayPal
    // transaction later, and hold them for the buyer while they pay.
    // Non-fatal: the invoice already exists.
    const { error: stampError } = await supabase
      .from("records")
      .update({
        paypal_invoice_id: result.invoiceId,
        hold_buyer: buyer,
        hold_until: holdUntil,
        updated_at: now,
      })
      .in("id", ids);
    if (stampError) {
      console.error("paypal-invoice: failed to stamp invoice id:", stampError.message);
    }
    // The pending-order row: this is what the admin's Pending invoices
    // panel lists, payment link included.
    const row = {
      paypal_invoice_id: result.invoiceId,
      buyer_username: buyer,
      recipient_view_url: result.recipientViewUrl,
      status: result.status,
      record_ids: ids,
      total: breakdown.total,
      updated_at: now,
    };
    const { data: saved, error: rowError } = await supabase
      .from("invoices")
      .upsert(row, { onConflict: "paypal_invoice_id" })
      .select()
      .single();
    if (rowError) {
      console.error("paypal-invoice: failed to save invoice row:", rowError.message);
    }
    const warning =
      [
        result.warning,
        stampError
          ? "Couldn't save the invoice id on the records — link it by hand in Fulfillment."
          : null,
        orderError
          ? `Couldn't save the order (${orderError}) — the invoice is out, but it won't be listed under Open orders.`
          : null,
        rowError
          ? "Couldn't save the pending order — copy the payment link now; it won't be listed under Pending invoices."
          : null,
      ]
        .filter(Boolean)
        .join(" ") || undefined;
    return NextResponse.json({
      ...result,
      warning,
      invoiceStamped: !stampError,
      holdUntil: stampError ? null : holdUntil,
      invoice: rowError ? null : (saved as Invoice),
      placed,
      subtotal: breakdown.subtotal,
      shipping: breakdown.shipping,
      total: breakdown.total,
    });
  } catch (e) {
    // Surfaces PayPal's response body in the Vercel runtime logs
    console.error("paypal-invoice failed:", e instanceof Error ? e.message : e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "PayPal request failed" },
      { status: 502 }
    );
  }
}

export async function GET(req: NextRequest) {
  const supabase = await adminClient(req);
  if (!supabase) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  if (!paypalConfigured()) {
    return NextResponse.json(
      { error: "PayPal credentials are not configured on the server" },
      { status: 500 }
    );
  }
  const id = invoiceIdFrom(req);
  if (!id) {
    return NextResponse.json({ error: "Invalid invoice id" }, { status: 400 });
  }

  try {
    const payment = await getInvoicePayment(id);
    const paid = PAID_STATUSES.has(payment.status);
    const paidAt = paid
      ? payment.paymentDate
        ? new Date(payment.paymentDate).toISOString()
        : new Date().toISOString()
      : null;
    const { data: existing } = await supabase
      .from("invoices")
      .select("recipient_view_url, paid_at")
      .eq("paypal_invoice_id", id)
      .maybeSingle();
    const patch: Record<string, unknown> = {
      paypal_invoice_id: id,
      status: payment.status,
      updated_at: new Date().toISOString(),
    };
    // Keep the first link and paid date we learned; PayPal's answer only
    // fills gaps.
    if (!existing?.recipient_view_url && payment.recipientViewUrl) {
      patch.recipient_view_url = payment.recipientViewUrl;
    }
    if (paidAt && !existing?.paid_at) patch.paid_at = paidAt;
    if (payment.shippingCharged != null) {
      patch.shipping_charged = payment.shippingCharged;
    }
    const { data: saved, error } = await supabase
      .from("invoices")
      .upsert(patch, { onConflict: "paypal_invoice_id" })
      .select()
      .single();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 502 });
    }
    return NextResponse.json({
      status: payment.status,
      paid,
      paidAt: (saved as Invoice).paid_at,
      recipientViewUrl: (saved as Invoice).recipient_view_url ?? null,
      invoice: saved as Invoice,
    });
  } catch (e) {
    console.error("paypal-invoice status failed:", e instanceof Error ? e.message : e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "PayPal request failed" },
      { status: 502 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  const supabase = await adminClient(req);
  if (!supabase) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  if (!paypalConfigured()) {
    return NextResponse.json(
      { error: "PayPal credentials are not configured on the server" },
      { status: 500 }
    );
  }
  const id = invoiceIdFrom(req);
  if (!id) {
    return NextResponse.json({ error: "Invalid invoice id" }, { status: 400 });
  }

  try {
    // Never cancel something the buyer already paid.
    const payment = await getInvoicePayment(id);
    if (PAID_STATUSES.has(payment.status)) {
      return NextResponse.json(
        { error: `Invoice is ${payment.status} — it can't be cancelled.` },
        { status: 409 }
      );
    }
    if (payment.status !== "CANCELLED") await cancelInvoice(id);
    const now = new Date().toISOString();
    const { error: rowError } = await supabase
      .from("invoices")
      .upsert(
        { paypal_invoice_id: id, status: "CANCELLED", cancelled_at: now, updated_at: now },
        { onConflict: "paypal_invoice_id" }
      );
    if (rowError) {
      return NextResponse.json({ error: rowError.message }, { status: 502 });
    }
    const { data: released, error: releaseError } = await supabase
      .from("records")
      .update({
        paypal_invoice_id: null,
        hold_buyer: null,
        hold_until: null,
        order_id: null,
        updated_at: now,
      })
      .eq("paypal_invoice_id", id)
      .eq("sold", false)
      .select("id");
    if (releaseError) {
      return NextResponse.json({ error: releaseError.message }, { status: 502 });
    }
    // The order ends with its invoice, unless it was already paid.
    const { data: cancelledOrders, error: orderError } = await supabase
      .from("orders")
      .update({ status: "cancelled", updated_at: now })
      .eq("paypal_invoice_id", id)
      .neq("status", "paid")
      .select("id");
    if (orderError) {
      console.error("paypal-invoice cancel: order update failed:", orderError.message);
    }
    return NextResponse.json({
      ok: true,
      releasedIds: (released ?? []).map((r) => r.id),
      cancelledOrderIds: ((cancelledOrders ?? []) as Pick<Order, "id">[]).map(
        (o) => o.id
      ),
    });
  } catch (e) {
    console.error("paypal-invoice cancel failed:", e instanceof Error ? e.message : e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "PayPal request failed" },
      { status: 502 }
    );
  }
}
