import { ADMIN_EMAIL } from "./supabase.ts";
import { bundleBreakdown, type BundleItem } from "./records.ts";
import { ORDERS_ADDRESS } from "./email.ts";
import { bundleKindSummary, countKinds, itemSpecShort, shippingSentence } from "./items.ts";

// The shop's email "Request to buy": what the form may send, and the two
// emails that go out when it lands — a notification to the admin and a
// confirmation to the buyer. Pure; the route owns the database and Resend.

export const MAX_REQUEST_RECORDS = 40;
export const MAX_NAME = 80;
export const MAX_MESSAGE = 1000;
export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
export const SHOP_URL = "https://curiouserrecords.com";
export const ADMIN_REQUESTS_URL = `${SHOP_URL}/admin#requests`;

export type OrderRequestBody = {
  recordIds: number[];
  buyerName: string | null;
  buyerEmail: string;
  message: string | null;
};

export type ParsedBody =
  | { ok: true; body: OrderRequestBody }
  | { ok: true; honeypot: true }
  | { ok: false; error: string };

// Strict shape check for the public endpoint. A filled honeypot ("website")
// means a bot: the caller answers as if it worked and does nothing.
export function parseOrderRequestBody(raw: unknown): ParsedBody {
  if (!raw || typeof raw !== "object") return { ok: false, error: "Invalid request" };
  const b = raw as Record<string, unknown>;
  if (typeof b.website === "string" && b.website.trim()) return { ok: true, honeypot: true };
  const ids = Array.isArray(b.record_ids) ? [...new Set(b.record_ids as unknown[])] : [];
  if (
    ids.length === 0 ||
    ids.length > MAX_REQUEST_RECORDS ||
    ids.some((id) => !Number.isInteger(id) || (id as number) <= 0)
  ) {
    return { ok: false, error: "Pick at least one record" };
  }
  const email = typeof b.buyer_email === "string" ? b.buyer_email.trim().toLowerCase() : "";
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
    return { ok: false, error: "Enter a valid email address" };
  }
  const name = typeof b.buyer_name === "string" ? b.buyer_name.trim().slice(0, MAX_NAME) : "";
  const message =
    typeof b.message === "string" ? b.message.trim().slice(0, MAX_MESSAGE) : "";
  return {
    ok: true,
    body: {
      recordIds: ids as number[],
      buyerName: name || null,
      buyerEmail: email,
      message: message || null,
    },
  };
}

export type RequestEmailArgs = {
  refCode: string;
  buyerName: string | null;
  buyerEmail: string;
  message: string | null;
  items: BundleItem[];
};

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function quoteLines(items: BundleItem[]) {
  const b = bundleBreakdown(items);
  const { lines, subtotal, shipping, total, shippingDetail, shippingNote } = b;
  const text = [
    ...lines,
    "",
    `Subtotal: $${subtotal}`,
    `Shipping: $${shipping}${shippingDetail ? ` (${shippingDetail})` : ""}`,
    ...(shippingNote ? [shippingNote] : []),
    `Total: $${total}`,
  ].join("\n");
  const html = `<ol>${b.items
    .map((r) => {
      const spec = itemSpecShort(r);
      return `<li>${escapeHtml(r.artist)} — ${escapeHtml(r.title)}${
        spec ? ` <span style="color:#666">(${escapeHtml(spec)})</span>` : ""
      } — $${r.price}</li>`;
    })
    .join("")}</ol><p>Subtotal $${subtotal} · Shipping $${shipping}${
    shippingDetail ? ` (${escapeHtml(shippingDetail)})` : ""
  } · <strong>Total $${total}</strong></p>${shippingNote ? `<p style="color:#666">${escapeHtml(shippingNote)}</p>` : ""}`;
  return { text, html, total };
}

// "record" when the request is all records, "poster"/"equipment" when it's
// all one of those, "" for a mix — so the subject line reads naturally.
function requestNoun(items: BundleItem[]): string {
  const n = countKinds(items);
  const kinds = (["record", "poster", "gear"] as const).filter((k) => n[k] > 0);
  if (kinds.length !== 1) return "";
  return kinds[0] === "gear" ? "equipment" : kinds[0];
}

export function buyerDisplay(name: string | null, email: string): string {
  return name ? `${name} <${email}>` : email;
}

// To the admin: everything needed to act without opening the portal, with
// Reply-To the buyer so a Gmail reply goes straight to them.
export function adminNotificationEmail(a: RequestEmailArgs) {
  const q = quoteLines(a.items);
  const who = buyerDisplay(a.buyerName, a.buyerEmail);
  const noun = requestNoun(a.items);
  const subject = `New ${noun ? `${noun} ` : ""}request ${a.refCode} from ${a.buyerName || a.buyerEmail} — $${q.total}`;
  const what = bundleKindSummary(a.items);
  const text = [
    `${who} wants to buy ${what} (Ref: ${a.refCode}).`,
    "",
    q.text,
    "",
    a.message ? `Their note:\n${a.message}\n` : "",
    `Load it into the sale desk: ${ADMIN_REQUESTS_URL}`,
    `Reply to this email to answer ${a.buyerEmail}, or reply from the Inbox as ${ORDERS_ADDRESS}.`,
  ]
    .filter((l) => l !== "")
    .join("\n");
  const html = `<p><strong>${escapeHtml(who)}</strong> wants to buy ${what} (Ref: <code>${a.refCode}</code>).</p>${q.html}${
    a.message ? `<p><em>Their note:</em></p><blockquote>${escapeHtml(a.message).replace(/\n/g, "<br>")}</blockquote>` : ""
  }<p><a href="${ADMIN_REQUESTS_URL}">Load it into the sale desk</a></p><p style="color:#666">Reply to this email to answer ${escapeHtml(a.buyerEmail)}, or reply from the Inbox as ${ORDERS_ADDRESS}.</p>`;
  return { to: ADMIN_EMAIL, subject, text, html, replyTo: a.buyerEmail };
}

// To the buyer: the quote, the ref code, and what happens next. Reply-To is
// the orders address so an answer lands in the admin Inbox.
export function buyerConfirmationEmail(a: RequestEmailArgs) {
  const q = quoteLines(a.items);
  const hi = a.buyerName ? `Hi ${a.buyerName}!` : "Hi!";
  const noun = requestNoun(a.items);
  const subject = `Got your ${noun ? `${noun} ` : ""}request (Ref ${a.refCode})`;
  const ships = shippingSentence(a.items);
  const text = [
    hi,
    "",
    `Thanks for your request from ${SHOP_URL}. Here's what you asked about:`,
    "",
    q.text,
    "",
    `Ref: ${a.refCode}`,
    "",
    `I'll reply from this address, usually within a day, to confirm what's available. Payment is a PayPal Goods & Services invoice (I cover the fee), sent to this email once we've settled the list. ${ships}`,
    "",
    a.message ? `Your note: ${a.message}\n` : "",
    "— Curiouser Records",
  ]
    .filter((l) => l !== "")
    .join("\n");
  const html = `<p>${escapeHtml(hi)}</p><p>Thanks for your request from <a href="${SHOP_URL}">curiouserrecords.com</a>. Here's what you asked about:</p>${q.html}<p>Ref: <code>${a.refCode}</code></p><p>I'll reply from this address, usually within a day, to confirm what's available. Payment is a PayPal Goods &amp; Services invoice (I cover the fee), sent to this email once we've settled the list. ${escapeHtml(ships)}</p>${
    a.message ? `<p style="color:#666">Your note: ${escapeHtml(a.message).replace(/\n/g, "<br>")}</p>` : ""
  }<p>— Curiouser Records</p>`;
  return { to: a.buyerEmail, subject, text, html, replyTo: ORDERS_ADDRESS };
}
