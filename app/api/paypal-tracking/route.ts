import { NextRequest, NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  ADMIN_EMAIL,
  SUPABASE_PUBLISHABLE_KEY,
  SUPABASE_URL,
  type Shipment,
} from "@/lib/supabase";
import {
  addTrackers,
  cancelTracker,
  getInvoicePayment,
  getTransactionFee,
  listTrackers,
  paypalConfigured,
  type TrackerInput,
} from "@/lib/paypal";

// Two-way tracking sync between shipments and PayPal.
//
//   { action: "pull", invoiceId }   — labels bought inside PayPal: read the
//     paid invoice's transaction, list its trackers, and create a shipment
//     row per tracking number not already stored.
//   { action: "push", shipmentIds } — labels bought elsewhere: attach each
//     shipment's tracking number to the invoice's transaction (buyer gets
//     a PayPal shipping email).
//
// Credentials only exist server-side; Supabase writes go through the
// caller's own token, so RLS still enforces the admin policy.

const PAID_STATUSES = new Set(["PAID", "MARKED_AS_PAID", "PARTIALLY_PAID"]);

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

async function pull(supabase: SupabaseClient, invoiceId: string) {
  const { status, transactionId, shippingCharged, paymentDate } =
    await getInvoicePayment(invoiceId);
  if (!PAID_STATUSES.has(status)) {
    return NextResponse.json({
      error: `Invoice isn't paid yet (${status}) — sync again after payment.`,
    });
  }
  if (!transactionId) {
    return NextResponse.json({
      error:
        "Invoice was marked paid outside PayPal — no transaction to read tracking from.",
    });
  }

  const trackers = (await listTrackers(transactionId)).filter(
    (t) => t.status !== "CANCELLED"
  );
  const trackerNumbers = trackers.map((t) => t.trackingNumber);

  const [
    { data: recs, error: recError },
    { data: existing, error: shipError },
    { data: sameCode, error: dupError },
  ] = await Promise.all([
    supabase
      .from("records")
      .select("id, buyer_username")
      .eq("paypal_invoice_id", invoiceId),
    supabase.from("shipments").select("*").eq("paypal_invoice_id", invoiceId),
    // A manual parcel typed before the invoice was linked still counts —
    // match by tracking number so sync doesn't duplicate it.
    supabase.from("shipments").select("*").in("tracking_code", trackerNumbers),
  ]);
  if (recError || shipError || dupError) {
    return NextResponse.json(
      { error: recError?.message ?? shipError?.message ?? dupError?.message },
      { status: 502 }
    );
  }
  const records = (recs ?? []) as { id: number; buyer_username: string }[];
  const shipments = (existing ?? []) as Shipment[];
  const buyer = records.find((r) => r.buyer_username?.trim())?.buyer_username ?? "";

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
  // off the invoice, the fee from Transaction Search (which publishes a
  // few hours after payment — null means try again later). Only known
  // values are written, so a pending fee never clobbers a typed one.
  let paypalFee: number | null = null;
  let feeNote: string | null = null;
  try {
    paypalFee = await getTransactionFee(transactionId, paymentDate);
    if (paypalFee == null) {
      feeNote = "PayPal hasn't published the fee yet — sync again later.";
    }
  } catch (e) {
    feeNote = e instanceof Error ? e.message : "Fee lookup failed.";
  }
  let invoiceRow: unknown = null;
  if (shippingCharged != null || paypalFee != null) {
    const patch: Record<string, unknown> = {
      paypal_invoice_id: invoiceId,
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
    feeNote,
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
