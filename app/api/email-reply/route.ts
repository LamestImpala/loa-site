import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  ADMIN_EMAIL,
  SUPABASE_PUBLISHABLE_KEY,
  SUPABASE_URL,
  type ShopMessage,
} from "@/lib/supabase";
import { EMAIL_RE } from "@/lib/order-request";
import { ORDERS_ADDRESS, addressOf, emailConfigured, emailFrom, sendEmail } from "@/lib/email";
import { parseAttachments } from "@/lib/admin/attachments";

// Send an email from the admin Inbox as orders@curiouserrecords.com — a
// reply to an inbound message, or the sale-desk breakdown to an email
// buyer. The Resend key only exists server-side, so the page calls this
// route; the shop_messages writes go through the admin's own token, so
// RLS still enforces the admin policy.
//
//   POST { to, subject, text, inReplyTo?, messageId?, requestId?, attachments? }
//     → sends, saves an outbound row, marks the inbound row replied.
//   attachments: [{ url, filename }] — photos in our public record-photos
//   bucket, which Resend fetches by URL (parseAttachments refuses the rest).

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

export async function POST(req: NextRequest) {
  const supabase = await adminClient(req);
  if (!supabase) return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  if (!emailConfigured()) {
    return NextResponse.json(
      { error: "Email isn't configured on the server (RESEND_API_KEY)" },
      { status: 503 }
    );
  }
  const body = await req.json().catch(() => ({}));
  const to = typeof body.to === "string" ? body.to.trim().toLowerCase() : "";
  if (!to || !EMAIL_RE.test(to)) {
    return NextResponse.json({ error: "Invalid recipient" }, { status: 400 });
  }
  const subject =
    typeof body.subject === "string" ? body.subject.trim().slice(0, 200) : "";
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!subject || !text || text.length > 5000) {
    return NextResponse.json({ error: "Subject and message are required" }, { status: 400 });
  }
  const inReplyTo =
    typeof body.inReplyTo === "string" && body.inReplyTo.trim()
      ? body.inReplyTo.trim().slice(0, 300)
      : null;
  const messageId = Number.isInteger(body.messageId) ? (body.messageId as number) : null;
  const requestId = Number.isInteger(body.requestId) ? (body.requestId as number) : null;
  const attachments = parseAttachments(body.attachments, SUPABASE_URL);
  if (!attachments.ok) {
    return NextResponse.json({ error: attachments.error }, { status: 400 });
  }

  const sent = await sendEmail({
    to,
    subject,
    text,
    replyTo: ORDERS_ADDRESS,
    headers: inReplyTo ? { "In-Reply-To": inReplyTo, References: inReplyTo } : undefined,
    attachments: attachments.attachments,
  });
  if (!sent.ok) return NextResponse.json({ error: sent.error }, { status: 502 });

  const now = new Date().toISOString();
  const { data: row, error } = await supabase
    .from("shop_messages")
    .insert({
      direction: "out",
      resend_email_id: sent.id || null,
      in_reply_to: inReplyTo,
      from_email: addressOf(emailFrom()),
      from_name: "Curiouser Records",
      to_email: to,
      subject,
      text_body: text,
      request_id: requestId,
      status: "archived", // outbound rows are history, not work
      received_at: now,
    })
    .select("*")
    .single();
  if (error) console.error("email-reply: outbound row failed:", error.message);
  if (messageId != null) {
    const { error: markError } = await supabase
      .from("shop_messages")
      .update({ status: "replied", updated_at: now })
      .eq("id", messageId)
      .eq("direction", "in");
    if (markError) console.error("email-reply: mark replied failed:", markError.message);
  }
  return NextResponse.json({ ok: true, sent: (row as ShopMessage | null) ?? null });
}
