import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  ADMIN_EMAIL,
  SUPABASE_PUBLISHABLE_KEY,
  SUPABASE_URL,
  type DbShipment,
} from "@/lib/supabase";
import {
  buyShipment,
  createShipment,
  easypostConfigured,
  refundShipment,
  verifyAddress,
  type Parcel,
} from "@/lib/easypost";

// Quote, buy, and refund USPS Media Mail labels for staged shipments.
// EasyPost credentials only exist server-side, so the admin page calls
// this route instead of EasyPost directly. Everything is re-read from
// Supabase — the client only sends a shipment id (plus parcel edits).
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

  if (!easypostConfigured()) {
    return NextResponse.json(
      { error: "EasyPost credentials are not configured on the server" },
      { status: 500 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const action = body.action;
  const shipmentId = body.shipmentId;
  if (
    !["quote", "buy", "refund"].includes(action) ||
    !Number.isInteger(shipmentId) ||
    shipmentId <= 0
  ) {
    return NextResponse.json(
      { error: "Expected an action (quote|buy|refund) and shipmentId" },
      { status: 400 }
    );
  }

  const { data: shipment, error: fetchError } = await supabase
    .from("shipments")
    .select("*")
    .eq("id", shipmentId)
    .maybeSingle<DbShipment>();
  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 502 });
  }
  if (!shipment) {
    return NextResponse.json({ error: "Shipment not found" }, { status: 404 });
  }

  try {
    if (action === "quote") {
      if (shipment.status !== "draft") {
        return NextResponse.json(
          { error: `Cannot quote a ${shipment.status} shipment` },
          { status: 400 }
        );
      }
      const parcel = parseParcel(body.parcel) ?? shipment.parcel;

      const verification = await verifyAddress(shipment.to_address);
      if (!verification.verified || !verification.normalized) {
        await supabase
          .from("shipments")
          .update({ address_verified: false, updated_at: new Date().toISOString() })
          .eq("id", shipment.id);
        return NextResponse.json(
          {
            error: `Address failed USPS delivery verification: ${
              verification.errors.join("; ") || "unknown reason"
            }`,
          },
          { status: 400 }
        );
      }

      const quote = await createShipment({
        to: verification.normalized,
        parcel,
      });
      const { error: updateError } = await supabase
        .from("shipments")
        .update({
          to_address: verification.normalized,
          address_verified: true,
          parcel,
          easypost_shipment_id: quote.shipmentId,
          easypost_rate_id: quote.rateId,
          rate_amount: Number(quote.rate),
          service: "MediaMail",
          mode: quote.mode,
          updated_at: new Date().toISOString(),
        })
        .eq("id", shipment.id);
      if (updateError) {
        return NextResponse.json({ error: updateError.message }, { status: 502 });
      }
      return NextResponse.json({
        rate: quote.rate,
        mode: quote.mode,
        address: verification.normalized,
      });
    }

    if (action === "buy") {
      if (shipment.status !== "draft" || !shipment.easypost_shipment_id || !shipment.easypost_rate_id) {
        return NextResponse.json(
          { error: "Shipment needs a fresh quote before buying" },
          { status: 400 }
        );
      }
      const label = await buyShipment(
        shipment.easypost_shipment_id,
        shipment.easypost_rate_id
      );
      const { error: updateError } = await supabase
        .from("shipments")
        .update({
          status: "purchased",
          label_url: label.labelUrl,
          tracking_code: label.trackingCode,
          updated_at: new Date().toISOString(),
        })
        .eq("id", shipment.id);
      if (updateError) {
        // Label is bought either way — surface it so it isn't lost.
        return NextResponse.json(
          {
            error: `Label bought but saving failed: ${updateError.message}. Label: ${label.labelUrl}`,
          },
          { status: 502 }
        );
      }
      // Auto-fill the existing per-record tracking field the rest of
      // the admin flow (copy confirm, sold view) already reads.
      const { error: trackError } = await supabase
        .from("records")
        .update({
          tracking_number: label.trackingCode,
          updated_at: new Date().toISOString(),
        })
        .in("id", shipment.record_ids);
      return NextResponse.json({
        labelUrl: label.labelUrl,
        trackingCode: label.trackingCode,
        ...(trackError
          ? {
              warning: `Label bought, but updating record tracking failed: ${trackError.message}`,
            }
          : {}),
      });
    }

    // action === "refund"
    if (shipment.status !== "purchased" || !shipment.easypost_shipment_id) {
      return NextResponse.json(
        { error: "Only purchased shipments can be refunded" },
        { status: 400 }
      );
    }
    const refundStatus = await refundShipment(shipment.easypost_shipment_id);
    const { error: updateError } = await supabase
      .from("shipments")
      .update({
        status: "refunded",
        updated_at: new Date().toISOString(),
      })
      .eq("id", shipment.id);
    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 502 });
    }
    // Clear tracking only where it still matches this label — a manual
    // re-ship may already have written a new number.
    await supabase
      .from("records")
      .update({ tracking_number: "", updated_at: new Date().toISOString() })
      .in("id", shipment.record_ids)
      .eq("tracking_number", shipment.tracking_code ?? "");
    return NextResponse.json({ refundStatus });
  } catch (e) {
    // Surfaces EasyPost's response body in the Vercel runtime logs
    console.error("shipping-label failed:", e instanceof Error ? e.message : e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "EasyPost request failed" },
      { status: 502 }
    );
  }
}

function parseParcel(raw: unknown): Parcel | null {
  if (raw == null || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  const num = (key: string) => {
    const v = Number(p[key]);
    return Number.isFinite(v) && v > 0 ? v : null;
  };
  const length = num("length");
  const width = num("width");
  const height = num("height");
  const weightOz = num("weight_oz");
  if (!length || !width || !height || !weightOz) return null;
  return { length, width, height, weight_oz: weightOz };
}
