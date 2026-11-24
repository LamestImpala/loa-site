import { NextRequest, NextResponse, after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerSupabase, type ItemDetails, type ItemKind } from "@/lib/supabase";
import { serviceSupabase } from "@/lib/supabase-service";
import { makeRefCode } from "@/lib/records";
import {
  adminNotificationEmail,
  buyerConfirmationEmail,
  parseOrderRequestBody,
} from "@/lib/order-request";
import { saveOrderRequest } from "@/lib/order-request-db";
import { clientIp, visitorHash, visitorSecret } from "@/lib/rate-limit";
import { emailConfigured, sendEmail } from "@/lib/email";
import { fetchShippingPause } from "@/lib/shipping-pause";

// The shop's "Request to buy", both channels: the email form and the
// Reddit DM sheet. Unauthenticated by design, and the only way a request
// is saved: the public key can't insert into order_requests, so every one
// passes the shape check here and the per-visitor limits in
// saveOrderRequest() before the service role writes it. The
// validate_order_request trigger then keeps listed/unsold ids only,
// recomputes the totals and holds a shop-wide hourly cap as a backstop.
//
// The row is saved before answering. An email request then sends two
// emails after the response (admin notification, buyer confirmation),
// best-effort — the request is in the admin Inbox either way. A Reddit
// request sends none; the buyer's DM is the message.

export async function POST(req: NextRequest) {
  const parsed = parseOrderRequestBody(await req.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  if ("honeypot" in parsed) return new Response(null, { status: 204 });
  const body = parsed.body;

  let db: SupabaseClient;
  let visitor: string;
  try {
    db = serviceSupabase();
    visitor = visitorHash(clientIp(req.headers), visitorSecret());
  } catch (e) {
    console.error("order-request:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Couldn't save the request" }, { status: 502 });
  }

  // A Reddit request arrives with the code already in the buyer's DM.
  const refCode = (body.channel === "reddit" && body.refCode) || makeRefCode();
  const saved = await saveOrderRequest(db, body, { refCode, visitor });
  if (!saved.ok) return NextResponse.json({ error: saved.error }, { status: saved.status });
  if (body.channel !== "email") return NextResponse.json({ refCode });

  const { recordIds, buyerName, buyerEmail, message } = body;
  after(async () => {
    if (!emailConfigured()) return;
    // Public reads, so the public client: the same snapshot the trigger
    // took — listed, unsold, in catalog order.
    const supabase = createServerSupabase();
    const [{ data, error: readError }, shippingPause] = await Promise.all([
      supabase
        .from("records")
        .select("id, kind, artist, title, media, sleeve, condition, details, price")
        .in("id", recordIds)
        .eq("listed", true)
        .eq("sold", false)
        .order("artist")
        .order("title"),
      fetchShippingPause(supabase),
    ]);
    if (readError || !data) {
      console.error("order-request: records read failed:", readError?.message);
      return;
    }
    const items = data.map((r) => ({
      kind: r.kind as ItemKind,
      artist: r.artist as string,
      title: r.title as string,
      media: r.media as string,
      sleeve: r.sleeve as string,
      condition: r.condition as string | null,
      details: r.details as ItemDetails | null,
      price: Number(r.price),
    }));
    const args = { refCode, buyerName, buyerEmail, message, items, shippingPause };
    const [admin, buyer] = await Promise.all([
      sendEmail(adminNotificationEmail(args)),
      sendEmail(buyerConfirmationEmail(args)),
    ]);
    if (!admin.ok) console.error("order-request: admin email failed:", admin.error);
    if (!buyer.ok) console.error("order-request: buyer email failed:", buyer.error);
  });

  return NextResponse.json({ refCode });
}
