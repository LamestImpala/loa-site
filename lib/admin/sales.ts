import type { DbRecord, OrderRequest } from "../supabase.ts";

// The sale side of the admin: what a mark-sold writes and what it
// finishes. Pure — no React, no Supabase. Order grouping is in orders.ts.

// The record patch for a sale. The buyer typed at the desk wins; otherwise
// the hold's buyer, then whatever was already on the row. Holds always
// clear — a sold record must not stay "held".
export function soldPatch(
  r: DbRecord,
  buyer: string,
  now: Date = new Date()
): Partial<DbRecord> {
  return {
    sold: true,
    sold_at: now.toISOString(),
    sold_price: Number(r.price),
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
