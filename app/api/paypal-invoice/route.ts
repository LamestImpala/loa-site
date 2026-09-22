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
import { liveInvoiceOn } from "@/lib/admin/orders";
import { INVOICE_HOLD_UNTIL } from "@/lib/admin/records";
import { mirrorInvoice } from "@/lib/admin/invoices-db";
import { settlePaidInvoice } from "@/lib/admin/sales-db";
import { placeOrder, type PlacedOrder } from "@/lib/admin/orders-db";
import {
  cancelInvoice,
  createAndSendInvoice,
  getInvoicePayment,
  PAID_STATUSES,
  REFUNDED_STATUSES,
  paypalConfigured,
} from "@/lib/paypal";

// PayPal invoices for Reddit sales. PayPal credentials only exist
// server-side, so the admin page calls this route instead of PayPal
// directly. Supabase writes go through the caller's own token, so RLS
// still enforces the admin policy.
//
//   POST   { ids, buyer, email?, prices?, credit?, creditNote? } — create +
//     send an invoice for a set of records, put them in an order
//     (invoiced), hold them for the buyer until the invoice is paid or
//     cancelled, and save a pending `invoices`
//     row (with the payment link) so the order survives clearing the sale
//     desk. `prices` maps record id → negotiated price: the line shows the
//     listed price with the difference as a discount. `credit` comes off
//     the whole invoice as an invoice-level discount, `creditNote` in the
//     note to the buyer.
//   GET    ?id=INV2-…              — read the invoice's status from PayPal
//     and mirror it (status, payment link, paid_at) onto the row. While
//     it's still payable, its unsold records are (re)held until resolved;
//     once paid, its order's records are sold (settlePaidInvoice — the
//     same write the /api/paypal-webhook makes).
//   DELETE ?id=INV2-…              — cancel the invoice on PayPal, cancel
//     its order, and release the records (stamp + hold + order cleared).

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
  // Negotiated prices: only for records on the invoice, cents, never negative.
  const prices = new Map<number, number>();
  if (body.prices != null) {
    if (typeof body.prices !== "object" || Array.isArray(body.prices)) {
      return NextResponse.json({ error: "Invalid prices" }, { status: 400 });
    }
    for (const [key, raw] of Object.entries(body.prices as Record<string, unknown>)) {
      const id = Number(key);
      const value = Number(raw);
      if (!ids.includes(id) || !Number.isFinite(value) || value < 0) {
        return NextResponse.json(
          { error: `Invalid negotiated price for record ${key}` },
          { status: 400 }
        );
      }
      prices.set(id, Math.round(value * 100) / 100);
    }
  }
  const credit =
    body.credit == null ? 0 : Math.round(Number(body.credit) * 100) / 100;
  if (!Number.isFinite(credit) || credit < 0) {
    return NextResponse.json({ error: "Invalid credit" }, { status: 400 });
  }
  const creditNote =
    typeof body.creditNote === "string" ? body.creditNote.trim().slice(0, 200) : "";

  const { data: recs, error: fetchError } = await supabase
    .from("records")
    .select(
      "id, artist, title, media, sleeve, price, sold, order_id, hold_buyer, buyer_username, paypal_invoice_id"
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
  // One live invoice per sale: re-invoicing would orphan the first one,
  // still payable on PayPal. The seller cancels it first.
  const orderIds = [
    ...new Set(recs.map((r) => r.order_id).filter((id): id is number => id != null)),
  ];
  const { data: recOrders, error: ordersError } = orderIds.length
    ? await supabase
        .from("orders")
        .select("id, status, paypal_invoice_id")
        .in("id", orderIds)
    : { data: [], error: null };
  if (ordersError) {
    return NextResponse.json({ error: ordersError.message }, { status: 502 });
  }
  const live = liveInvoiceOn(
    recs,
    new Map(
      ((recOrders ?? []) as Pick<Order, "id" | "status" | "paypal_invoice_id">[]).map(
        (o) => [o.id, o]
      )
    )
  );
  if (live) {
    return NextResponse.json(
      {
        error: `These records are already on invoice ${live} — cancel it under Open orders first, then invoice again.`,
        invoiceId: live,
      },
      { status: 409 }
    );
  }

  // Keep invoice line order matching the order the admin selected.
  recs.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));

  // Each line: listed price, and what the buyer actually pays for it. A
  // lower negotiated price is a line-item discount off the listed price;
  // a higher one (rare) simply replaces it.
  const lines = recs.map((r) => {
    const listed = Number(r.price);
    const sale = prices.get(r.id) ?? listed;
    return { r, listed, sale, negotiated: sale !== listed };
  });
  const breakdown = bundleBreakdown(
    lines.map(({ r, listed, sale }) => ({ ...r, price: sale, listedPrice: listed })),
    credit
  );
  if (credit > breakdown.subtotal) {
    return NextResponse.json(
      { error: `A $${credit} credit is more than the $${breakdown.subtotal} subtotal` },
      { status: 400 }
    );
  }

  try {
    const result = await createAndSendInvoice({
      items: lines.map(({ r, listed, sale }) => ({
        name: `${r.artist} — ${r.title}`.slice(0, 200),
        description: `Media: ${r.media} / Sleeve: ${r.sleeve}`,
        value: (sale < listed ? listed : sale).toFixed(2),
        discount: sale < listed ? (listed - sale).toFixed(2) : undefined,
      })),
      shippingValue: breakdown.shipping.toFixed(2),
      discountValue: breakdown.credit > 0 ? breakdown.credit.toFixed(2) : undefined,
      note:
        `Vinyl records for Reddit user u/${buyer} — thanks! Shipped USPS Media Mail from Phoenix, AZ.` +
        (breakdown.credit > 0
          ? ` A $${breakdown.credit.toFixed(2)} credit is applied as the discount${creditNote ? ` (${creditNote})` : ""}.`
          : ""),
      memo: `Reddit sale to u/${buyer}`,
      recipientEmail: email,
    });
    const now = new Date().toISOString();
    const holdUntil = INVOICE_HOLD_UNTIL;
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
        extra: {
          paypal_invoice_id: result.invoiceId,
          credit: breakdown.credit,
          credit_note: creditNote,
        },
      });
    } catch (e) {
      orderError = e instanceof Error ? e.message : "Couldn't save the order";
      console.error("paypal-invoice: order failed:", orderError);
    }
    // Link the records to the invoice so fulfillment can find the PayPal
    // transaction later, hold them for the buyer until they pay or the
    // invoice is cancelled, and keep
    // the negotiated price on each (so the sale lands at what was
    // invoiced). Non-fatal: the invoice already exists.
    const stamps = await Promise.all(
      lines.map(({ r, sale, negotiated }) =>
        supabase
          .from("records")
          .update({
            paypal_invoice_id: result.invoiceId,
            hold_buyer: buyer,
            hold_until: holdUntil,
            negotiated_price: negotiated ? sale : null,
            updated_at: now,
          })
          .eq("id", r.id)
      )
    );
    const stampError = stamps.find((s) => s.error)?.error ?? null;
    if (stampError) {
      console.error("paypal-invoice: failed to stamp invoice id:", stampError.message);
    }
    // The pending-order row: this is what the admin's Open orders
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
          ? "Couldn't save the invoice id on the records — link it by hand on the Send page."
          : null,
        orderError
          ? `Couldn't save the order (${orderError}) — the invoice is out, but it won't be listed under Open orders.`
          : null,
        rowError
          ? "Couldn't save the pending order — copy the payment link now; it won't be listed under Open orders."
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
      credit: breakdown.credit,
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
    const { invoice, order, paid, heldIds } = await mirrorInvoice(supabase, id, payment);
    // Paid: the sale lands here on the server — the same write the webhook
    // makes, so it doesn't depend on this browser tab staying open.
    const settled = paid ? await settlePaidInvoice(supabase, id) : { kind: "none" as const };
    return NextResponse.json({
      status: payment.status,
      paid,
      heldIds,
      settled,
      paidAt: invoice.paid_at,
      recipientViewUrl: invoice.recipient_view_url ?? null,
      invoice,
      order,
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
    // A refunded invoice was paid once: it closes through Fulfillment's
    // sync (which settles the records), not a cancel.
    if (REFUNDED_STATUSES.has(payment.status)) {
      return NextResponse.json(
        {
          error: `Invoice is ${payment.status} — sync it on the Send page to close the order.`,
        },
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
        negotiated_price: null,
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
