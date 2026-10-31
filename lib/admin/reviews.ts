import type { Order, ReviewInvite, ReviewSource, Shipment, ShopReview } from "../supabase.ts";
import { INVITE_AFTER_DAYS, MAX_REVIEW_BODY, MAX_REVIEWER_NAME } from "../review.ts";

// The Inbox's Reviews section: which recent buyers can still be asked for
// a review, and the shape check for a review imported from another
// platform. Pure; the writes are in reviews-db.ts.

// How far back "Ask for a review" reaches.
export const ASK_WINDOW_DAYS = 60;

export const IMPORT_SOURCES: Exclude<ReviewSource, "site">[] = ["discogs", "ebay", "reddit", "other"];

export type AskableOrder = {
  order: Order;
  lastSent: string; // when the last box went out
  invite: ReviewInvite | null; // existing link, if one was made
  autoEmailOn: string | null; // when the daily job will email it (email buyers, no invite yet)
};

// Paid orders whose boxes have all gone out in the last ASK_WINDOW_DAYS
// and that haven't left a review yet, newest drop-off first. Email
// buyers are emailed by the daily job; anyone can be sent a copied link.
export function askableOrders(
  orders: Order[],
  shipments: Pick<Shipment, "order_id" | "sent_at">[],
  invites: ReviewInvite[],
  reviews: Pick<ShopReview, "order_id">[],
  now: number = Date.now()
): AskableOrder[] {
  const reviewed = new Set(reviews.map((r) => r.order_id).filter((id) => id != null));
  const inviteByOrder = new Map(invites.map((i) => [i.order_id, i]));
  const lastSent = new Map<number, string>();
  const unsent = new Set<number>();
  for (const s of shipments) {
    if (s.order_id == null) continue;
    if (!s.sent_at) unsent.add(s.order_id);
    else if (!lastSent.has(s.order_id) || s.sent_at > lastSent.get(s.order_id)!) {
      lastSent.set(s.order_id, s.sent_at);
    }
  }
  const day = 86_400_000;
  const since = now - ASK_WINDOW_DAYS * day;
  const out: AskableOrder[] = [];
  for (const order of orders) {
    const sent = lastSent.get(order.id);
    if (order.status !== "paid" || !sent || unsent.has(order.id) || reviewed.has(order.id)) continue;
    if (Date.parse(sent) < since) continue;
    const invite = inviteByOrder.get(order.id) ?? null;
    if (invite?.used_at) continue;
    const autoEmailOn =
      !invite && order.buyer_email
        ? new Date(Date.parse(sent) + INVITE_AFTER_DAYS * day).toISOString()
        : null;
    out.push({ order, lastSent: sent, invite, autoEmailOn });
  }
  return out.sort((a, b) => b.lastSent.localeCompare(a.lastSent));
}

export type ImportedReviewInput = {
  source: string;
  sourceUrl: string;
  reviewerName: string;
  rating: string; // "" = no stars
  body: string;
  reviewedOn: string; // yyyy-mm-dd
};

export type ImportedReviewRow = Pick<
  ShopReview,
  "source" | "source_url" | "reviewer_name" | "rating" | "body" | "reviewed_on"
>;

export function parseImportedReview(
  input: ImportedReviewInput,
  today: string = new Date().toISOString().slice(0, 10)
): { ok: true; row: ImportedReviewRow } | { ok: false; error: string } {
  const source = input.source as ImportedReviewRow["source"];
  if (!IMPORT_SOURCES.includes(source as (typeof IMPORT_SOURCES)[number])) {
    return { ok: false, error: "Pick where the review was left" };
  }
  const name = input.reviewerName.trim();
  if (!name || name.length > MAX_REVIEWER_NAME) {
    return { ok: false, error: `Name is required (up to ${MAX_REVIEWER_NAME} characters)` };
  }
  const body = input.body.trim();
  if (!body || body.length > MAX_REVIEW_BODY) {
    return { ok: false, error: `Review text is required (up to ${MAX_REVIEW_BODY} characters)` };
  }
  let rating: number | null = null;
  if (input.rating.trim()) {
    rating = Number(input.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return { ok: false, error: "Stars must be 1–5, or blank" };
    }
  }
  const url = input.sourceUrl.trim();
  if (url && !/^https?:\/\/\S+$/i.test(url)) {
    return { ok: false, error: "Link must start with http:// or https://" };
  }
  const date = input.reviewedOn.trim() || today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date)) || date > today) {
    return { ok: false, error: "Date must be a real day, not in the future" };
  }
  return {
    ok: true,
    row: {
      source,
      source_url: url || null,
      reviewer_name: name,
      rating,
      body,
      reviewed_on: date,
    },
  };
}
