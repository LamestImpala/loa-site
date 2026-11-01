import { NextRequest, NextResponse, after } from "next/server";
import { createServerSupabase, type ItemDetails, type ItemKind } from "@/lib/supabase";
import { makeRefCode } from "@/lib/records";
import {
  adminNotificationEmail,
  buyerConfirmationEmail,
  parseOrderRequestBody,
} from "@/lib/order-request";
import { emailConfigured, sendEmail } from "@/lib/email";

// The shop's email "Request to buy". Unauthenticated by design, like
// /api/track: strict validation here, the anon role's INSERT-only policy
// on order_requests, and the validate_order_request trigger (flood cap,
// listed/unsold ids only, totals, email shape) are the guards. The row is
// saved before answering; the two emails (admin notification, buyer
// confirmation) go out after the response and are best-effort — the
// request is in the admin Inbox either way.

export async function POST(req: NextRequest) {
  const parsed = parseOrderRequestBody(await req.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  if ("honeypot" in parsed) return new Response(null, { status: 204 });
  const { recordIds, buyerName, buyerEmail, message } = parsed.body;

  const supabase = createServerSupabase();
  const refCode = makeRefCode();
  // No .select(): the anon role can't read the table back.
  const { error } = await supabase.from("order_requests").insert({
    ref_code: refCode,
    record_ids: recordIds,
    channel: "email",
    buyer_name: buyerName,
    buyer_email: buyerEmail,
    message,
  });
  if (error) {
    const msg = error.message || "";
    if (/rate limited/i.test(msg)) {
      return NextResponse.json(
        { error: "Too many requests right now — please try again in a bit." },
        { status: 429 }
      );
    }
    if (/no valid records/i.test(msg)) {
      return NextResponse.json(
        { error: "Those records are no longer available." },
        { status: 409 }
      );
    }
    if (/email required|too many records/i.test(msg)) {
      return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 });
    }
    console.error("order-request insert failed:", msg);
    return NextResponse.json({ error: "Couldn't save the request" }, { status: 502 });
  }

  after(async () => {
    if (!emailConfigured()) return;
    // The same snapshot the trigger took: listed, unsold, in catalog order.
    const { data, error: readError } = await supabase
      .from("records")
      .select("id, kind, artist, title, media, sleeve, condition, details, price")
      .in("id", recordIds)
      .eq("listed", true)
      .eq("sold", false)
      .order("artist")
      .order("title");
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
    const args = { refCode, buyerName, buyerEmail, message, items };
    const [admin, buyer] = await Promise.all([
      sendEmail(adminNotificationEmail(args)),
      sendEmail(buyerConfirmationEmail(args)),
    ]);
    if (!admin.ok) console.error("order-request: admin email failed:", admin.error);
    if (!buyer.ok) console.error("order-request: buyer email failed:", buyer.error);
  });

  return NextResponse.json({ refCode });
}
