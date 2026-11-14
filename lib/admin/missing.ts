import type { DbRecord, Order, Shipment } from "../supabase.ts";
import { handDelivered } from "./fulfillment.ts";
import { unsellPlan, type UnsellPlan } from "./sales.ts";

// A record that sold and then couldn't be found on the shelf. It comes
// off its order and out of the stock for good; the buyer is refunded its
// price in PayPal and the rest of the order ships. Pure — no React, no
// Supabase. The writes are in missing-db.ts.

const cents = (n: number) => Math.round(n * 100) / 100;

// What the record sold for — what the buyer is owed back for it.
export const missingPrice = (r: Pick<DbRecord, "sold_price" | "price">) =>
  cents(Number(r.sold_price ?? r.price ?? 0));

// The orders.removed_total column exists (it reads as undefined until its
// migration is applied) — the admin leaves "Can't find it" out rather
// than offer a write that fails.
export const missingSupported = (order: Order | null | undefined) =>
  !!order && order.removed_total !== undefined;

// Why this record can't be taken off its order as missing, or null when
// it can.
export function missingBlock(
  r: DbRecord,
  records: DbRecord[],
  shipments: Pick<Shipment, "record_ids" | "tracking_code" | "status" | "mode">[],
  order: Order | null | undefined
): string | null {
  const name = `"${r.artist} — ${r.title}"`;
  if (!r.sold || !order || order.status !== "paid") {
    return `${name} isn't on a paid order.`;
  }
  if (!missingSupported(order)) {
    return "The orders.removed_total migration hasn't been applied yet.";
  }
  const left = shipments.some(
    (s) =>
      s.status !== "refunded" &&
      (s.record_ids ?? []).includes(r.id) &&
      (!!s.tracking_code || handDelivered(s))
  );
  if (left || (r.tracking_number ?? "").trim()) {
    return `${name} is in a box that already has tracking — it has left, so it can't be missing.`;
  }
  // The whole payment goes back, and a full refund already has its own
  // path: the sync closes the order and takes it out of the stats.
  const others = records.some((x) => x.id !== r.id && x.order_id === order.id && x.sold);
  if (!others) {
    return `${name} is the only item on this order — refund the whole payment in PayPal, then Sync from PayPal. The order closes and the record goes back to Stock, where you can delete it.`;
  }
  return null;
}

export type MissingPlan = {
  price: number; // what the buyer is owed back for it
  removedTotal: number; // the order's removed_total once it's off
  parcels: UnsellPlan["parcels"]; // untracked boxes it leaves
};

// Call only when missingBlock is null.
export function missingPlan(
  r: DbRecord,
  records: DbRecord[],
  shipments: Shipment[],
  order: Order
): MissingPlan {
  const price = missingPrice(r);
  return {
    price,
    removedTotal: cents(Number(order.removed_total ?? 0) + price),
    parcels: unsellPlan([r], records, shipments, [order]).parcels,
  };
}

// The part of a paid order's PayPal refund that comes off the sold total.
// What pays back items taken off the order doesn't: their prices left
// the total with them.
export const refundOffSold = (
  o: Pick<Order, "refunded_amount" | "removed_total">
) => Math.max(0, cents(Number(o.refunded_amount ?? 0) - Number(o.removed_total ?? 0)));

// What's still to refund for items taken off the order: their prices,
// less what PayPal has reported refunded.
export const refundOwed = (
  o: Pick<Order, "refunded_amount" | "removed_total"> | null | undefined
) =>
  o ? Math.max(0, cents(Number(o.removed_total ?? 0) - Number(o.refunded_amount ?? 0))) : 0;

// Storage paths of a record's own photos, from their public URLs.
export const photoPaths = (r: Pick<DbRecord, "photo_urls">) =>
  (r.photo_urls ?? [])
    .map((url) => url.split("/record-photos/")[1])
    .filter((p): p is string => !!p)
    .map((p) => decodeURIComponent(p));
