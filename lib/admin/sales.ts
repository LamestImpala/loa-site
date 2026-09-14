import type { DbRecord, OrderRequest } from "../supabase.ts";
import type { BundleItem } from "../records.ts";

// The sale side of the admin: what a mark-sold writes and what it
// finishes. Pure — no React, no Supabase. Order grouping is in orders.ts.

// A money input as typed at the desk: blank means "no override"; anything
// else must be a non-negative amount, rounded to cents.
export function parseMoney(raw: string): number | null | undefined {
  const s = raw.trim();
  if (!s) return null;
  const n = Number(s.replace(/^\$/, ""));
  if (!Number.isFinite(n) || n < 0) return undefined;
  return Math.round(n * 100) / 100;
}

// What a record sells for right now: the desk's override, else the price
// negotiated on its order, else the listed price.
export function salePrice(r: DbRecord, override?: number | null): number {
  if (override != null) return override;
  if (r.negotiated_price != null) return Number(r.negotiated_price);
  return Number(r.price);
}

// The quote line for a record, listed price alongside when it differs.
export function saleItem(r: DbRecord, override?: number | null): BundleItem {
  return {
    artist: r.artist,
    title: r.title,
    media: r.media,
    sleeve: r.sleeve,
    price: salePrice(r, override),
    listedPrice: Number(r.price),
  };
}

// The record patch for a sale. The buyer typed at the desk wins; otherwise
// the hold's buyer, then whatever was already on the row. Holds always
// clear — a sold record must not stay "held". The sold price is the desk's
// override, else the negotiated price, else the listed price; the
// negotiation is spent once it lands in sold_price.
export function soldPatch(
  r: DbRecord,
  buyer: string,
  now: Date = new Date(),
  price?: number | null
): Partial<DbRecord> {
  return {
    sold: true,
    sold_at: now.toISOString(),
    sold_price: salePrice(r, price),
    negotiated_price: null,
    buyer_username:
      buyer || r.hold_buyer || (r.buyer_username ?? "").trim() || "",
    hold_buyer: null,
    hold_until: null,
    picked_at: null, // a fresh sale starts unpulled on the pick list
  };
}

// Loaded order requests whose records are now all sold — the ones a sale
// closes automatically.
export function finishedRequests(
  requests: OrderRequest[],
  justSold: Set<number>,
  byId: Map<number, DbRecord>
): OrderRequest[] {
  return requests.filter(
    (req) =>
      req.status === "loaded" &&
      req.record_ids.every((id) => justSold.has(id) || byId.get(id)?.sold)
  );
}

// Records a sale should offer to pull from the owner's Discogs collection:
// actually written as sold, linked to a release, not already removed.
export function discogsCandidates(
  targets: DbRecord[],
  justSold: Set<number>
): DbRecord[] {
  return targets.filter(
    (r) => justSold.has(r.id) && !!r.discogs_release_id && !r.discogs_removed
  );
}
