import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  ADMIN_EMAIL,
  SUPABASE_PUBLISHABLE_KEY,
  SUPABASE_URL,
} from "@/lib/supabase";
import { bundleBreakdown } from "@/lib/records";
import { createAndSendInvoice, paypalConfigured } from "@/lib/paypal";

// Creates and sends a PayPal invoice for a set of records claimed by a
// Reddit buyer. PayPal credentials only exist server-side, so the admin
// page calls this route instead of PayPal directly. Prices are re-read
// from Supabase — the client only sends record ids.
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
    .select("id, artist, title, media, sleeve, price, sold")
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
    return NextResponse.json({
      ...result,
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
