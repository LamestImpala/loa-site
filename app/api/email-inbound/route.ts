import { NextRequest, NextResponse, after } from "next/server";
import { ADMIN_EMAIL } from "@/lib/supabase";
import { serviceSupabase } from "@/lib/supabase-service";
import { svixHeadersFrom, verifySvixSignature } from "@/lib/resend-webhook";
import {
  ORDERS_ADDRESS,
  addressOf,
  emailFrom,
  fetchReceivedEmail,
  parseAddress,
  sendEmail,
} from "@/lib/email";
import { bodyText, findRefCode } from "@/lib/admin/messages";

// Mail to orders@curiouserrecords.com. Resend receives it and POSTs an
// `email.received` event here (metadata only); this route verifies the
// signature, pulls the body from the receiving API, files it in
// shop_messages for the admin Inbox, and forwards a copy to the admin's
// own mailbox with Reply-To set to the sender. The signature check is the
// auth, so the writes use the service role (same as the PayPal webhook).
//
// Non-2xx answers make Resend retry, so: 401 for a bad signature, 502 when
// the body couldn't be fetched or saved, 200 for duplicates and events we
// don't handle.

export const maxDuration = 30;

const ADMIN_MESSAGES_URL = "https://curiouserrecords.com/admin#messages";

export async function POST(req: NextRequest) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json(
      { error: "RESEND_WEBHOOK_SECRET and SUPABASE_SERVICE_ROLE_KEY must be set" },
      { status: 503 }
    );
  }
  const raw = await req.text();
  if (!verifySvixSignature(secret, svixHeadersFrom(req.headers), raw)) {
    return NextResponse.json({ error: "Bad signature" }, { status: 401 });
  }
  let event: { type?: string; data?: { email_id?: string } };
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Bad JSON" }, { status: 400 });
  }
  if (event.type !== "email.received") {
    return NextResponse.json({ ignored: event.type ?? "unknown" });
  }
  const emailId = event.data?.email_id;
  if (typeof emailId !== "string" || !/^[A-Za-z0-9-]{8,64}$/.test(emailId)) {
    return NextResponse.json({ error: "Bad email id" }, { status: 400 });
  }

  const supabase = serviceSupabase();
  const { data: existing } = await supabase
    .from("shop_messages")
    .select("id")
    .eq("resend_email_id", emailId)
    .maybeSingle();
  if (existing) return NextResponse.json({ duplicate: true, id: existing.id });

  const fetched = await fetchReceivedEmail(emailId);
  if (!fetched.ok) {
    console.error("email-inbound: fetch failed:", fetched.error);
    return NextResponse.json({ error: fetched.error }, { status: 502 });
  }
  const mail = fetched.email;
  const from = parseAddress(mail.from);
  // Our own outbound mail bouncing back in (an auto-reply to orders@
  // from orders@) is a loop, not a message.
  if (from.email === addressOf(emailFrom()) || from.email === ORDERS_ADDRESS) {
    return NextResponse.json({ ignored: "self" });
  }
  const text = mail.text ?? null;
  const html = mail.html ?? null;
  const plain = bodyText({ text_body: text, html_body: html });
  const refCode = findRefCode(mail.subject, plain);
  let requestId: number | null = null;
  if (refCode) {
    const { data: reqRow } = await supabase
      .from("order_requests")
      .select("id")
      .ilike("ref_code", refCode)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    requestId = reqRow?.id ?? null;
  }
  const headers = mail.headers ?? {};
  const inReplyTo =
    headers["in-reply-to"] ?? headers["In-Reply-To"] ?? null;
  const { data: row, error } = await supabase
    .from("shop_messages")
    .insert({
      direction: "in",
      resend_email_id: mail.id,
      message_id: mail.message_id,
      in_reply_to: inReplyTo,
      from_email: from.email,
      from_name: from.name,
      to_email: (mail.to?.[0] ?? ORDERS_ADDRESS).toLowerCase(),
      subject: mail.subject,
      text_body: text,
      html_body: html,
      ref_code: refCode,
      request_id: requestId,
      status: "new",
      received_at: mail.created_at,
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") return NextResponse.json({ duplicate: true });
    console.error("email-inbound: insert failed:", error.message);
    return NextResponse.json({ error: error.message }, { status: 502 });
  }

  // A copy for the admin's own inbox; Reply-To the sender so a Gmail
  // reply (sent as orders@ via Resend SMTP) goes straight back to them.
  after(async () => {
    const who = from.name ? `${from.name} <${from.email}>` : from.email;
    const res = await sendEmail({
      to: ADMIN_EMAIL,
      subject: `[orders@] ${mail.subject?.trim() || "(no subject)"}`,
      text: `From: ${who}\n${refCode ? `Ref: ${refCode}\n` : ""}Inbox: ${ADMIN_MESSAGES_URL}\n\n${plain}`,
      replyTo: from.email,
    });
    if (!res.ok) console.error("email-inbound: forward failed:", res.error);
  });

  return NextResponse.json({ id: row.id, refCode, requestId });
}
