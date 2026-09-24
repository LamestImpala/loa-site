import { NextRequest, NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  ADMIN_EMAIL,
  SUPABASE_PUBLISHABLE_KEY,
  SUPABASE_URL,
  type Order,
  type Shipment,
} from "@/lib/supabase";
import {
  addTrackers,
  cancelTracker,
  getInvoicePayment,
  getTransactionDetails,
  listTrackers,
  paypalConfigured,
  PAID_STATUSES,
  REFUNDED_STATUSES,
  type TrackerInput,
} from "@/lib/paypal";
import { refundPlan, refundedPatch } from "@/lib/admin/refunds";

// Two-way tracking sync between shipments and PayPal.
//
//   { action: "pull", invoiceId }   — labels bought inside PayPal: read the
//     paid invoice's transaction, list its trackers, and create a shipment
//     row per tracking number not already stored. An invoice PayPal
//     refunded in full closes its order instead: unshipped records go
//     back up for sale and the order leaves fulfillment.
//   { action: "push", shipmentIds } — labels bought elsewhere: attach each
//     shipment's tracking number to the invoice's transaction (buyer gets
//     a PayPal shipping email).
//
// Credentials only exist server-side; Supabase writes go through the
// caller's own token, so RLS still enforces the admin policy.

type PushResult = {
  shipmentId: number;
  ok: boolean;
  trackerId?: string;
  error?: string;
};

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization") ?? "";
  const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || user.email !== ADMIN_EMAIL) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  if (!paypalConfigured()) {
    return NextResponse.json(
      { error: "PayPal credentials are not configured on the server" },
      { status: 500 }
    );
  }

  const body = await req.json().catch(() => ({}));

  try {
    if (body.action === "pull") {
      const invoiceId =
        typeof body.invoiceId === "string" ? body.invoiceId.trim() : "";
      if (!invoiceId || invoiceId.length > 127) {
        return NextResponse.json({ error: "Invalid invoice id" }, { status: 400 });
      }
      return await pull(supabase, invoiceId);
    }
    if (body.action === "push") {
      const shipmentIds: number[] = Array.isArray(body.shipmentIds)
        ? [...new Set<number>(body.shipmentIds)]
        : [];
      if (
        shipmentIds.length === 0 ||
        shipmentIds.length > 20 ||
        shipmentIds.some((id) => !Number.isInteger(id) || id <= 0)
      ) {
        return NextResponse.json({ error: "Invalid shipment ids" }, { status: 400 });
      }
      return await push(supabase, shipmentIds);
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    // Surfaces PayPal's response body in the Vercel runtime logs
    console.error("paypal-tracking failed:", e instanceof Error ? e.message : e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "PayPal request failed" },
      { status: 502 }
    );
  }
}

type SaleRecord = {
  id: number;
  buyer_username: string;
  order_id: number | null;
  tracking_number: string | null;
  discogs_removed: boolean | null;
};

// The sale an invoice paid for: its records, its parcels, and the order
// that owns them.
async function saleForInvoice(supabase: SupabaseClient, invoiceId: string) {
  const [
    { data: recs, error: recError },
    { data: existing, error: shipError },
    { data: orderRow },
  ] = await Promise.all([
    supabase
      .from("records")
      .select("id, buyer_username, order_id, tracking_number, discogs_removed")
      .eq("paypal_invoice_id", invoiceId),
    supabase.from("shipments").select("*").eq("paypal_invoice_id", invoiceId),
    // The invoice's order names the buyer and owns the parcels.
    supabase
      .from("orders")
      .select("*")
      .eq("paypal_invoice_id", invoiceId)
      .neq("status", "cancelled")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const records = (recs ?? []) as SaleRecord[];
  let order = (orderRow ?? null) as Order | null;
  // The order that owns the sale is the one the records point at. An
  // order that carries the invoice id but none of its records (a sale
  // re-placed under a fresh row) would take the address and never show
  // it, so follow the records when they all agree on another order.
  const recordOrderIds = [
    ...new Set(records.map((r) => r.order_id).filter((id): id is number => id != null)),
  ];
  if (recordOrderIds.length === 1 && recordOrderIds[0] !== order?.id) {
    const { data: recordOrder } = await supabase
      .from("orders")
      .select("*")
      .eq("id", recordOrderIds[0])
      .neq("status", "cancelled")
      .maybeSingle();
    if (recordOrder) order = recordOrder as Order;
  }
  return {
    records,
    shipments: (existing ?? []) as Shipment[],
    order,
    error: recError?.message ?? shipError?.message ?? null,
  };
}

// PayPal sent the whole payment back: close the order. Records that never
// shipped go back up for sale, untracked boxes are dropped, the order is
// marked refunded (which takes it out of fulfillment and the stats).
// Records first and the order last, so a failure partway leaves the order
// paid and the next sync finishes the job.
async function closeRefunded(
  supabase: SupabaseClient,
  invoiceId: string,
  status: string,
  payment: {
    transactionId: string | null;
    paymentDate: string | null;
    refundedAmount: number | null;
    refundDate: string | null;
  }
) {
  const sale = await saleForInvoice(supabase, invoiceId);
  if (sale.error) return NextResponse.json({ error: sale.error }, { status: 502 });
  const now = new Date().toISOString();
  const { relist, keepSold } = refundPlan(sale.records, sale.shipments);

  if (relist.length > 0) {
    const { error } = await supabase
      .from("records")
      .update({ ...refundedPatch(), updated_at: now })
      .in(
        "id",
        relist.map((r) => r.id)
      );
    if (error) {
      return NextResponse.json(
        { error: `Putting the records back for sale failed: ${error.message}` },
        { status: 502 }
      );
    }
  }

  // Boxes that never got a label have nothing left to ship. Tracked ones
  // keep their row — the postage was spent either way.
  const dropped = sale.shipments.filter(
    (s) => !s.tracking_code && s.status !== "refunded"
  );
  if (dropped.length > 0) {
    const { error } = await supabase
      .from("shipments")
      .update({ status: "refunded", updated_at: now })
      .in(
        "id",
        dropped.map((s) => s.id)
      );
    if (error) {
      return NextResponse.json(
        { error: `Closing the order's boxes failed: ${error.message}` },
        { status: 502 }
      );
    }
  }

  let order = sale.order;
  if (order) {
    const { data, error } = await supabase
      .from("orders")
      .update({
        status: "refunded",
        refunded_amount: payment.refundedAmount ?? 0,
        refunded_at: payment.refundDate ?? now,
        updated_at: now,
      })
      .eq("id", order.id)
      .select()
      .single();
    if (error) {
      return NextResponse.json(
        { error: `Marking the order refunded failed: ${error.message}` },
        { status: 502 }
      );
    }
    order = data as Order;
  }

  // PayPal keeps its fee on a refund, so it's still a cost worth having.
  let fee: number | null = null;
  if (payment.transactionId) {
    try {
      fee = (await getTransactionDetails(payment.transactionId, payment.paymentDate)).fee;
    } catch {
      // best-effort — the refund is settled without it
    }
  }
  const { data: invoiceRow } = await supabase
    .from("invoices")
    .upsert({
      paypal_invoice_id: invoiceId,
      status,
      ...(fee != null ? { paypal_fee: fee } : {}),
      updated_at: now,
    })
    .select()
    .single();

  const count = (n: number) => `${n} record${n === 1 ? "" : "s"}`;
  const handRestore = relist.filter((r) => r.discogs_removed).length;
  const note = [
    `Refunded in PayPal${payment.refundedAmount != null ? ` ($${payment.refundedAmount.toFixed(2)})` : ""} — order closed.`,
    relist.length > 0 ? `${count(relist.length)} back up for sale.` : null,
    keepSold.length > 0 ? `${count(keepSold.length)} already shipped — left sold.` : null,
    handRestore > 0
      ? `${count(handRestore)} had been removed from Discogs — add ${handRestore === 1 ? "it" : "them"} back by hand.`
      : null,
    !order ? "No order row for this invoice — only the records were settled." : null,
  ]
    .filter(Boolean)
    .join(" ");

  return NextResponse.json({
    refunded: true,
    order,
    relisted: relist.map((r) => r.id),
    droppedShipments: dropped.map((s) => s.id),
    invoice: invoiceRow ?? null,
    note,
  });
}

async function pull(supabase: SupabaseClient, invoiceId: string) {
  const { status, transactionId, shippingCharged, paymentDate, ...invoicePayment } =
    await getInvoicePayment(invoiceId);
  if (REFUNDED_STATUSES.has(status)) {
    return closeRefunded(supabase, invoiceId, status, {
      transactionId,
      paymentDate,
      refundedAmount: invoicePayment.refundedAmount,
      refundDate: invoicePayment.refundDate,
    });
  }
  if (!PAID_STATUSES.has(status)) {
    return NextResponse.json({
      error: `Invoice isn't paid yet (${status}) — sync again after payment.`,
    });
  }
  // Payment confirmed — record it so the paid state survives reloads
  // (PayPal is the only source of truth for it).
  const paidAt = paymentDate ?? new Date().toISOString();
  if (!transactionId) {
    const { data: offlineRow } = await supabase
      .from("invoices")
      .upsert({
        paypal_invoice_id: invoiceId,
        paid_at: paidAt,
        ...(shippingCharged != null ? { shipping_charged: shippingCharged } : {}),
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();
    return NextResponse.json({
      error:
        "Invoice was marked paid outside PayPal — no transaction to read tracking from.",
      invoice: offlineRow ?? null,
    });
  }

  // Transaction Search carries the fee and the buyer's shipping address
  // (the invoice JSON never has the address). It publishes a few hours
  // after payment — "not found" means try again later; a disabled
  // feature throws, which is reported but doesn't stop the sync.
  let txn: Awaited<ReturnType<typeof getTransactionDetails>> = {
    found: false,
    fee: null,
    shipTo: null,
  };
  let feeNote: string | null = null;
  try {
    txn = await getTransactionDetails(transactionId, paymentDate);
    if (!txn.found) {
      feeNote = "PayPal hasn't published the transaction yet (fee and address come with it) — picked up automatically within a few hours.";
    } else if (txn.fee == null) {
      feeNote = "PayPal hasn't published the fee yet — picked up automatically within a few hours.";
    }
  } catch (e) {
    feeNote = e instanceof Error ? e.message : "Transaction lookup failed.";
  }
  const paypalFee = txn.fee;
  const shipTo = invoicePayment.shipTo ?? txn.shipTo;

  const trackers = (await listTrackers(transactionId)).filter(
    (t) => t.status !== "CANCELLED"
  );
  const trackerNumbers = trackers.map((t) => t.trackingNumber);

  const [sale, { data: sameCode, error: dupError }] = await Promise.all([
    saleForInvoice(supabase, invoiceId),
    // A manual parcel typed before the invoice was linked still counts —
    // match by tracking number so sync doesn't duplicate it.
    supabase.from("shipments").select("*").in("tracking_code", trackerNumbers),
  ]);
  if (sale.error || dupError) {
    return NextResponse.json(
      { error: sale.error ?? dupError?.message },
      { status: 502 }
    );
  }
  const { records, shipments } = sale;
  let order = sale.order;
  // The buyer's ship-to lands on the order now that PayPal has reported
  // payment; overwritten each sync, PayPal being the truth for it. The
  // note says where it came from, so a missing address is explained.
  // A partial refund rides along: the order still ships, the refunded
  // part is recorded on it for the stats.
  const refundedAmount = invoicePayment.refundedAmount;
  if (order && refundedAmount != null && Number(order.refunded_amount ?? 0) !== refundedAmount) {
    const { data: updated, error: refundError } = await supabase
      .from("orders")
      .update({
        refunded_amount: refundedAmount,
        refunded_at: invoicePayment.refundDate ?? new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", order.id)
      .select()
      .single();
    if (refundError) {
      console.error("paypal-tracking pull: refund update failed:", refundError.message);
    } else {
      order = updated as Order;
    }
  }
  let shipToNote: string | null = null;
  if (order && shipTo) {
    const { data: updated, error: shipToError } = await supabase
      .from("orders")
      .update({ ship_to: shipTo, updated_at: new Date().toISOString() })
      .eq("id", order.id)
      .select()
      .single();
    if (shipToError) {
      console.error("paypal-tracking pull: ship_to update failed:", shipToError.message);
      shipToNote = `Saving the address failed: ${shipToError.message}`;
    } else {
      order = updated as Order;
      shipToNote = `Ships to ${shipTo.name ?? shipTo.line1}${shipTo.postal_code ? ` ${shipTo.postal_code}` : ""}.`;
    }
  } else if (!order) {
    shipToNote = "No order row for this invoice — address not saved.";
  } else if (txn.found) {
    shipToNote = "PayPal has no shipping address on this payment.";
  }
  const orderId = order?.id ?? records.find((r) => r.order_id != null)?.order_id ?? null;
  const buyer =
    order?.buyer_username.trim() ||
    (records.find((r) => r.buyer_username?.trim())?.buyer_username ?? "");

  const known = new Set(
    [...shipments, ...((sameCode ?? []) as Shipment[])]
      .map((s) => s.tracking_code)
      .filter(Boolean) as string[]
  );
  const fresh = trackers.filter((t) => !known.has(t.trackingNumber));

  let created: Shipment[] = [];
  if (fresh.length > 0) {
    // Single label for the whole invoice → every record went in that parcel.
    const soleParcel =
      trackers.length === 1 && shipments.length === 0 && records.length > 0;
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from("shipments")
      .insert(
        fresh.map((t) => ({
          buyer_username: buyer,
          order_id: orderId,
          record_ids: soleParcel ? records.map((r) => r.id) : [],
          mode: "paypal",
          status: "shipped",
          tracking_code: t.trackingNumber,
          carrier: t.carrier,
          paypal_invoice_id: invoiceId,
          paypal_tracker_id: `${transactionId}-${t.trackingNumber}`,
          paypal_tracked_number: t.trackingNumber,
          paypal_synced_at: now,
        }))
      )
      .select();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 502 });
    }
    created = (data ?? []) as unknown as Shipment[];
    if (soleParcel) {
      await supabase
        .from("records")
        .update({
          tracking_number: fresh[0].trackingNumber,
          updated_at: now,
        })
        .in(
          "id",
          records.map((r) => r.id)
        );
    }
  }

  // Auto-fill the invoice's money facts: shipping charged comes straight
  // off the invoice, the fee from Transaction Search. Only known values
  // are written, so a pending fee never clobbers a typed one.
  let invoiceRow: unknown = null;
  {
    const patch: Record<string, unknown> = {
      paypal_invoice_id: invoiceId,
      paid_at: paidAt,
      updated_at: new Date().toISOString(),
    };
    if (shippingCharged != null) patch.shipping_charged = shippingCharged;
    if (paypalFee != null) patch.paypal_fee = paypalFee;
    const { data, error } = await supabase
      .from("invoices")
      .upsert(patch)
      .select()
      .single();
    if (error) feeNote = `Saving invoice costs failed: ${error.message}`;
    else invoiceRow = data;
  }

  return NextResponse.json({
    transactionId,
    trackersFound: trackers.length,
    created,
    shipments: [...shipments, ...created],
    invoice: invoiceRow,
    order,
    feeNote,
    shipToNote,
    refundNote:
      refundedAmount != null
        ? `PayPal shows $${refundedAmount.toFixed(2)} refunded — taken off the sold total.`
        : null,
  });
}

async function push(supabase: SupabaseClient, shipmentIds: number[]) {
  const { data, error } = await supabase
    .from("shipments")
    .select("*")
    .in("id", shipmentIds);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 502 });
  }
  const shipments = (data ?? []) as Shipment[];
  const byId = new Map(shipments.map((s) => [s.id, s]));
  const results: PushResult[] = [];
  const pushable: Shipment[] = [];

  for (const id of shipmentIds) {
    const s = byId.get(id);
    if (!s) results.push({ shipmentId: id, ok: false, error: "Not found" });
    else if (!s.tracking_code)
      results.push({ shipmentId: id, ok: false, error: "No tracking number" });
    else if (!s.paypal_invoice_id)
      results.push({
        shipmentId: id,
        ok: false,
        error: "No PayPal invoice linked — notify the buyer yourself",
      });
    else pushable.push(s);
  }

  const byInvoice = new Map<string, Shipment[]>();
  for (const s of pushable) {
    const list = byInvoice.get(s.paypal_invoice_id as string) ?? [];
    list.push(s);
    byInvoice.set(s.paypal_invoice_id as string, list);
  }

  for (const [invoiceId, group] of byInvoice) {
    let payment: { status: string; transactionId: string | null };
    try {
      payment = await getInvoicePayment(invoiceId);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Invoice lookup failed";
      for (const s of group) results.push({ shipmentId: s.id, ok: false, error: message });
      continue;
    }
    if (!PAID_STATUSES.has(payment.status)) {
      for (const s of group)
        results.push({
          shipmentId: s.id,
          ok: false,
          error: `Invoice isn't paid yet (${payment.status})`,
        });
      continue;
    }
    const txn = payment.transactionId;
    if (!txn) {
      for (const s of group)
        results.push({
          shipmentId: s.id,
          ok: false,
          error: "Invoice was marked paid outside PayPal — no transaction",
        });
      continue;
    }

    // A shipment pushed before with a different number gets its old
    // tracker cancelled so the buyer doesn't follow a dead label. The old
    // transaction id comes from the stored tracker id, since the invoice's
    // transaction can have changed since the first push.
    for (const s of group) {
      const current = s.tracking_code as string;
      const oldNumber = s.paypal_tracked_number;
      if (s.paypal_tracker_id && oldNumber && oldNumber !== current) {
        const oldTxn = s.paypal_tracker_id.endsWith(`-${oldNumber}`)
          ? s.paypal_tracker_id.slice(0, -(oldNumber.length + 1))
          : txn;
        try {
          await cancelTracker(oldTxn, oldNumber);
        } catch (e) {
          console.error(
            "paypal-tracking: cancel of replaced tracker failed:",
            e instanceof Error ? e.message : e
          );
        }
      }
    }

    const inputs: TrackerInput[] = group.map((s) => ({
      transactionId: txn,
      trackingNumber: s.tracking_code as string,
      carrier: s.carrier || "USPS",
    }));
    const { ok, errors } = await addTrackers(inputs);

    for (const s of group) {
      const trackingNumber = s.tracking_code as string;
      if (ok.has(trackingNumber)) {
        const trackerId = `${txn}-${trackingNumber}`;
        const { error: updateError } = await supabase
          .from("shipments")
          .update({
            paypal_tracker_id: trackerId,
            paypal_tracked_number: trackingNumber,
            paypal_synced_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", s.id);
        results.push({
          shipmentId: s.id,
          ok: true,
          trackerId,
          ...(updateError
            ? { error: `Pushed, but saving sync state failed: ${updateError.message}` }
            : {}),
        });
      } else {
        results.push({
          shipmentId: s.id,
          ok: false,
          error: errors.get(trackingNumber) ?? "PayPal rejected the tracker",
        });
      }
    }
  }

  return NextResponse.json({ results });
}
