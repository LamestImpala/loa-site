import { ADMIN_EMAIL, type Order, type ReviewInvite, type ReviewSource, type Shipment } from "./supabase.ts";
import { ORDERS_ADDRESS } from "./email.ts";
import { escapeHtml, SHOP_URL } from "./order-request.ts";

// Shop reviews: what the review form may send, which paid orders get an
// emailed review link, the two emails, and how the shop home words the
// summary. Pure; the routes own the database and Resend.

export const MAX_REVIEW_BODY = 1200;
export const MAX_REVIEWER_NAME = 60;
export const ADMIN_REVIEWS_URL = `${SHOP_URL}/admin#reviews`;

// The invite goes out once the box has had time to arrive and be played:
// 10 days after drop-off. Boxes sent more than 30 days ago are left alone,
// so turning the job on doesn't email every past buyer at once.
export const INVITE_AFTER_DAYS = 10;
export const INVITE_UNTIL_DAYS = 30;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isReviewToken(s: unknown): s is string {
  return typeof s === "string" && UUID_RE.test(s);
}

export function reviewUrl(token: string): string {
  return `${SHOP_URL}/review/${token}`;
}

export const SOURCE_LABELS: Record<ReviewSource, string> = {
  site: "this site",
  discogs: "Discogs",
  ebay: "eBay",
  reddit: "Reddit",
  other: "elsewhere",
};

export type ReviewBody = {
  token: string;
  rating: number;
  body: string;
  name: string;
};

export type ParsedReview =
  | { ok: true; review: ReviewBody }
  | { ok: true; honeypot: true }
  | { ok: false; error: string };

// Strict shape check for /api/review. A filled honeypot ("website") means
// a bot: the caller answers as if it worked and does nothing.
export function parseReviewBody(raw: unknown): ParsedReview {
  if (!raw || typeof raw !== "object") return { ok: false, error: "Invalid request" };
  const b = raw as Record<string, unknown>;
  if (typeof b.website === "string" && b.website.trim()) return { ok: true, honeypot: true };
  if (!isReviewToken(b.token)) return { ok: false, error: "This review link isn't valid" };
  const rating = b.rating;
  if (typeof rating !== "number" || !Number.isInteger(rating) || rating < 1 || rating > 5) {
    return { ok: false, error: "Pick a star rating" };
  }
  const body = typeof b.body === "string" ? b.body.trim().slice(0, MAX_REVIEW_BODY) : "";
  if (!body) return { ok: false, error: "Write a sentence or two" };
  const name = typeof b.name === "string" ? b.name.trim().slice(0, MAX_REVIEWER_NAME) : "";
  if (!name) return { ok: false, error: "Add the name to show with your review" };
  return { ok: true, review: { token: b.token.toLowerCase(), rating, body, name } };
}

// Paid orders due a review email today: an email on file, every parcel
// dropped off, the last one INVITE_AFTER_DAYS–INVITE_UNTIL_DAYS ago, and
// no invite yet (emailed or copied). Reddit buyers have no email; the
// admin copies their link into a DM instead.
export function ordersToInvite(
  orders: Pick<Order, "id" | "status" | "buyer_email">[],
  shipments: Pick<Shipment, "order_id" | "sent_at">[],
  invites: Pick<ReviewInvite, "order_id">[],
  now: Date = new Date()
): { orderId: number; email: string }[] {
  const invited = new Set(invites.map((i) => i.order_id));
  const lastSent = new Map<number, number>();
  const unsent = new Set<number>();
  for (const s of shipments) {
    if (s.order_id == null) continue;
    if (!s.sent_at) {
      unsent.add(s.order_id);
      continue;
    }
    const t = Date.parse(s.sent_at);
    lastSent.set(s.order_id, Math.max(lastSent.get(s.order_id) ?? 0, t));
  }
  const day = 86_400_000;
  const earliest = now.getTime() - INVITE_UNTIL_DAYS * day;
  const latest = now.getTime() - INVITE_AFTER_DAYS * day;
  const due: { orderId: number; email: string }[] = [];
  for (const o of orders) {
    const email = o.buyer_email?.trim().toLowerCase();
    if (o.status !== "paid" || !email || invited.has(o.id) || unsent.has(o.id)) continue;
    const sent = lastSent.get(o.id);
    if (sent == null || sent < earliest || sent > latest) continue;
    due.push({ orderId: o.id, email });
  }
  return due;
}

export type ReviewRequestArgs = { to: string; firstName: string | null; url: string };

// To the buyer, from orders@: a short ask with the private link. Replies
// land in the admin Inbox like any other mail to orders@.
export function reviewRequestEmail(a: ReviewRequestArgs) {
  const hi = a.firstName ? `Hi ${a.firstName},` : "Hi,";
  const subject = "How did your records arrive?";
  const text = [
    hi,
    "",
    "Your records from Curiouser Records should have landed by now. I hope they sound as good as they look.",
    "",
    "If you have a minute, would you leave a short review? It's a couple of sentences and a star rating, and it helps other collectors trust a one-person shop:",
    "",
    a.url,
    "",
    "If anything wasn't right — grading, packing, a skip — just reply to this email and I'll make it right.",
    "",
    "— Curiouser Records",
  ].join("\n");
  const html = `<p>${escapeHtml(hi)}</p><p>Your records from Curiouser Records should have landed by now. I hope they sound as good as they look.</p><p>If you have a minute, would you leave a short review? It's a couple of sentences and a star rating, and it helps other collectors trust a one-person shop.</p><p><a href="${escapeHtml(a.url)}"><strong>Leave a review</strong></a></p><p>If anything wasn't right — grading, packing, a skip — just reply to this email and I'll make it right.</p><p>— Curiouser Records</p>`;
  return { to: a.to, subject, text, html, replyTo: ORDERS_ADDRESS };
}

export function stars(rating: number): string {
  const n = Math.max(0, Math.min(5, Math.round(rating)));
  return "★".repeat(n) + "☆".repeat(5 - n);
}

// To the admin: the review in full and where to publish it.
export function adminReviewNotificationEmail(r: Pick<ReviewBody, "rating" | "body" | "name">) {
  const subject = `New ${r.rating}-star review from ${r.name}`;
  const text = [
    `${r.name} left a review (${stars(r.rating)}):`,
    "",
    r.body,
    "",
    `It's pending until you publish it: ${ADMIN_REVIEWS_URL}`,
  ].join("\n");
  const html = `<p><strong>${escapeHtml(r.name)}</strong> left a review (${stars(r.rating)}):</p><blockquote>${escapeHtml(r.body).replace(/\n/g, "<br>")}</blockquote><p><a href="${ADMIN_REVIEWS_URL}">Publish or hide it</a> — it stays pending until you do.</p>`;
  return { to: ADMIN_EMAIL, subject, text, html };
}

export type ReviewQuote = {
  id: number;
  reviewerName: string;
  rating: number | null;
  body: string;
  source: ReviewSource;
  reviewedOn: string;
  ownerReply: string | null;
};

export type ReviewSummary = {
  count: number;
  ratedCount: number;
  average: number | null;
  quotes: ReviewQuote[];
};

// The shop_review_summary() JSON, typed. Null when there's nothing
// published (or the call failed) — the shop leaves the section out.
export function toReviewSummary(raw: unknown): ReviewSummary | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const count = Number(r.count) || 0;
  if (count === 0) return null;
  const quotes = Array.isArray(r.quotes) ? (r.quotes as Record<string, unknown>[]) : [];
  return {
    count,
    ratedCount: Number(r.rated_count) || 0,
    average: r.average == null ? null : Number(r.average),
    quotes: quotes.map((q) => ({
      id: Number(q.id),
      reviewerName: String(q.reviewer_name ?? ""),
      rating: q.rating == null ? null : Number(q.rating),
      body: String(q.body ?? ""),
      source: (q.source as ReviewSource) ?? "site",
      reviewedOn: String(q.reviewed_on ?? ""),
      ownerReply: (q.owner_reply as string | null) ?? null,
    })),
  };
}

// "4.9 from 23 reviews" — the average is over rated reviews only, so the
// count says how many it's from.
export function ratingLine(s: ReviewSummary): string {
  const n = s.ratedCount;
  if (s.average == null || n === 0) {
    return `${s.count} review${s.count === 1 ? "" : "s"}`;
  }
  return `${s.average.toFixed(1)} out of 5 from ${n} review${n === 1 ? "" : "s"}`;
}

// "Oct 2026" for a yyyy-mm-dd date.
export function reviewMonth(isoDate: string): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

// The greeting name: the PayPal shipping name, or the name an email buyer
// typed. Never a Reddit handle. Matches review_invite_info() in SQL.
export function buyerFirstName(o: Pick<Order, "ship_to" | "buyer_email" | "buyer_username">): string | null {
  const full = o.ship_to?.name?.trim() || (o.buyer_email ? o.buyer_username.trim() : "");
  return full.split(/\s+/)[0] || null;
}
