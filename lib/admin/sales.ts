import type { DbRecord, Order, OrderRequest, Shipment } from "../supabase.ts";
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

// Open order requests whose records are now all sold — the ones a sale
// closes automatically. A request never loaded into the desk counts too
// (the sale often starts from a DM), as long as this sale touched it;
// otherwise it would sit in the inbox as "new" forever.
export function finishedRequests(
  requests: OrderRequest[],
  justSold: Set<number>,
  byId: Map<number, DbRecord>
): OrderRequest[] {
  return requests.filter(
    (req) =>
      (req.status === "loaded" || req.status === "new") &&
      req.record_ids.some((id) => justSold.has(id)) &&
      req.record_ids.every((id) => justSold.has(id) || byId.get(id)?.sold)
  );
}

// The record patch that undoes a sale: back on the shop (listed is never
// touched by a sale), out of its order, a fresh start on the pick list,
// and cleared of the dead sale's buyer, price, invoice and tracking so the
// row doesn't regroup under it in fulfillment. discogs_removed stays — it
// records what happened on Discogs, not the sale.
export function unsoldPatch(): Partial<DbRecord> {
  return {
    sold: false,
    sold_at: null,
    order_id: null,
    negotiated_price: null,
    picked_at: null,
    sold_price: null,
    buyer_username: "",
    paypal_invoice_id: null,
    tracking_number: "",
  };
}

// Everything else an un-sell has to tidy so no trace of the sale is left
// working: the records leave their parcels (an untracked parcel left
// empty is deleted; a tracked one keeps its row as shipping history), an
// order left with no records is cancelled (never an invoiced one — that
// has a live PayPal invoice to cancel first), and records already taken
// off Discogs are named so the seller can re-add them.
export type UnsellPlan = {
  parcels: { id: number; record_ids: number[]; remove: boolean }[];
  cancelOrderIds: number[];
  offDiscogs: DbRecord[];
};

export function unsellPlan(
  targets: DbRecord[],
  records: DbRecord[],
  shipments: Shipment[],
  orders: Order[]
): UnsellPlan {
  const ids = new Set(targets.map((r) => r.id));
  const parcels = shipments
    .filter(
      (s) => s.status !== "refunded" && (s.record_ids ?? []).some((id) => ids.has(id))
    )
    .map((s) => {
      const left = (s.record_ids ?? []).filter((id) => !ids.has(id));
      return { id: s.id, record_ids: left, remove: left.length === 0 && !s.tracking_code };
    });
  const touched = new Set(
    targets.map((r) => r.order_id).filter((id): id is number => id != null)
  );
  const cancelOrderIds = orders
    .filter(
      (o) =>
        touched.has(o.id) &&
        (o.status === "held" || o.status === "paid") &&
        !records.some((r) => r.order_id === o.id && !ids.has(r.id))
    )
    .map((o) => o.id);
  return {
    parcels,
    cancelOrderIds,
    offDiscogs: targets.filter((r) => r.discogs_removed),
  };
}
