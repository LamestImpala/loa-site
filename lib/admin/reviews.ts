import type { DbRecord, Order, ReviewInvite, ReviewSource, Shipment, ShopReview } from "../supabase.ts";
import { INVITE_AFTER_DAYS, MAX_REVIEW_BODY, MAX_REVIEWER_NAME } from "../review.ts";
import { saleGroups, saleInvite, saleShipping } from "./combined.ts";

// The Inbox's Reviews section: which recent buyers can still be asked for
// a review, and the shape check for a review imported from another
// platform. Pure; the writes are in reviews-db.ts.

// How far back "Ask for a review" reaches.
export const ASK_WINDOW_DAYS = 60;

export const IMPORT_SOURCES: Exclude<ReviewSource, "site">[] = ["discogs", "ebay", "reddit", "other"];

export type AskableOrder = {
  order: Order; // the sale's first paid order
  members: Order[]; // every paid order in the sale, `order` first (just it, unless combined)
  lastSent: string; // when the last box went out
  inPerson: boolean; // every box was handed over in person, none mailed
  invite: ReviewInvite | null; // existing link, if one was made
  autoEmailOn: string | null; // when the daily job will email it (email buyers, no invite yet)
};

// Paid sales whose boxes have all gone out in the last ASK_WINDOW_DAYS
// and that haven't left a review yet, newest drop-off first. Orders that
// were combined are one sale: one row, one link, one review. Email
// buyers are emailed by the daily job; anyone can be sent a copied link.
export function askableOrders(
  orders: Order[],
  shipments: (Pick<Shipment, "order_id" | "sent_at"> & { mode?: string | null })[],
  invites: ReviewInvite[],
  reviews: Pick<ShopReview, "order_id">[],
  now: number = Date.now()
): AskableOrder[] {
  const reviewed = new Set(reviews.map((r) => r.order_id).filter((id) => id != null));
  const shipping = saleShipping(orders, shipments);
  const day = 86_400_000;
  const since = now - ASK_WINDOW_DAYS * day;
  const out: AskableOrder[] = [];
  for (const [root, all] of saleGroups(orders)) {
    const members = all.filter((o) => o.status === "paid");
    const sale = shipping.get(root);
    const sent = sale?.lastSent;
    if (members.length === 0 || !sale || !sent || sale.unsent) continue;
    if (all.some((o) => reviewed.has(o.id))) continue;
    if (Date.parse(sent) < since) continue;
    const invite = saleInvite(invites, all.map((o) => o.id));
    if (invite?.used_at) continue;
    const autoEmailOn =
      !invite && members.some((o) => o.buyer_email)
        ? new Date(Date.parse(sent) + INVITE_AFTER_DAYS * day).toISOString()
        : null;
    out.push({
      order: members[0],
      members,
      lastSent: sent,
      inPerson: !sale.mailed,
      invite,
      autoEmailOn,
    });
  }
  return out.sort((a, b) => b.lastSent.localeCompare(a.lastSent));
}

type BoughtRecord = Pick<DbRecord, "id" | "artist" | "title">;

// Each order's records, artist then title, so a review row can say what
// the buyer bought.
export function recordsByOrder(
  records: Pick<DbRecord, "id" | "artist" | "title" | "order_id">[]
): Map<number, BoughtRecord[]> {
  const out = new Map<number, BoughtRecord[]>();
  for (const r of records) {
    if (r.order_id == null) continue;
    const list = out.get(r.order_id) ?? [];
    list.push(r);
    out.set(r.order_id, list);
  }
  for (const list of out.values()) {
    list.sort((a, b) => a.artist.localeCompare(b.artist) || a.title.localeCompare(b.title));
  }
  return out;
}

// The same, but every order of a combined sale maps to the whole sale's
// records — a review on either order was for all of them.
export function recordsBySale(
  records: Pick<DbRecord, "id" | "artist" | "title" | "order_id">[],
  orders: Pick<Order, "id" | "combined_into">[]
): Map<number, BoughtRecord[]> {
  const byOrder = recordsByOrder(records);
  const out = new Map(byOrder);
  for (const members of saleGroups(orders).values()) {
    if (members.length < 2) continue;
    const all = members
      .flatMap((o) => byOrder.get(o.id) ?? [])
      .sort((a, b) => a.artist.localeCompare(b.artist) || a.title.localeCompare(b.title));
    for (const o of members) out.set(o.id, all);
  }
  return out;
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
