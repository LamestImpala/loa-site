import type { DbRecord, Order, Shipment } from "../supabase.ts";
import { LETTERS, artistLetter } from "../records.ts";
import { groupOrders } from "./fulfillment.ts";

// Pick list rules: which sold records still have to come off the shelf,
// in shelf order (artist, then title), and how they roll up per letter
// and per order. Pure — no React, no Supabase.

export type PickRow = {
  record: DbRecord;
  buyer: string;
  orderKey: string; // OrderGroup.key — "order-12", or "buyer-name" for pre-orders rows
  order: Order | null;
  picked: boolean;
};

const shelfCompare = (a: DbRecord, b: DbRecord) =>
  a.artist.localeCompare(b.artist, undefined, { sensitivity: "base" }) ||
  a.title.localeCompare(b.title, undefined, { sensitivity: "base" });

// Records in paid, not-yet-shipped orders that still have to come off the
// shelf: unassigned ones and members of parcels that are neither packed
// nor tracked. A parcel sealed on /admin/pack (packed_at) already holds
// its records, so they leave the list before any label exists; a draft
// parcel made on the fulfillment card doesn't. Sold records with no order
// (pre-orders rows) count as paid. Refunded parcels are already dropped
// by groupOrders, so they never hide a record.
export function pickList(
  records: DbRecord[],
  shipments: Shipment[],
  orders: Order[]
): PickRow[] {
  const rows: PickRow[] = [];
  for (const g of groupOrders(records.filter((r) => r.sold), shipments, orders)) {
    if (g.done) continue;
    if (g.order && g.order.status !== "paid") continue;
    const boxed = new Set(
      g.shipments
        .filter((s) => !!s.tracking_code || !!s.packed_at)
        .flatMap((s) => s.record_ids ?? [])
    );
    for (const record of g.records) {
      if (boxed.has(record.id)) continue;
      rows.push({
        record,
        buyer: g.buyer,
        orderKey: g.key,
        order: g.order,
        picked: !!record.picked_at,
      });
    }
  }
  return rows.sort((a, b) => shelfCompare(a.record, b.record));
}

export function pickProgress(rows: PickRow[]) {
  return { picked: rows.filter((r) => r.picked).length, total: rows.length };
}

// Shelf view: rows bucketed by artist letter, A–Z order, empty letters left out.
export function byLetter(rows: PickRow[]): [string, PickRow[]][] {
  const buckets = new Map<string, PickRow[]>();
  for (const row of rows) {
    const letter = artistLetter(row.record.artist);
    const bucket = buckets.get(letter);
    if (bucket) bucket.push(row);
    else buckets.set(letter, [row]);
  }
  return LETTERS.filter((l) => buckets.has(l)).map((l) => [l, buckets.get(l)!]);
}

export type PickOrder = {
  key: string;
  buyer: string;
  order: Order | null;
  rows: PickRow[]; // shelf order
  picked: number;
};

// Packing view: one group per order, alphabetical by buyer; two orders to
// the same buyer stay separate.
export function byOrder(rows: PickRow[]): PickOrder[] {
  const groups = new Map<string, PickOrder>();
  for (const row of rows) {
    let g = groups.get(row.orderKey);
    if (!g) {
      g = { key: row.orderKey, buyer: row.buyer, order: row.order, rows: [], picked: 0 };
      groups.set(row.orderKey, g);
    }
    g.rows.push(row);
    if (row.picked) g.picked++;
  }
  return [...groups.values()].sort(
    (a, b) =>
      a.buyer.localeCompare(b.buyer, undefined, { sensitivity: "base" }) ||
      a.key.localeCompare(b.key)
  );
}

// How many records each order has on the list — the "×3" badge that says
// a buyer's records need to end up together.
export function orderCounts(rows: PickRow[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.orderKey, (counts.get(row.orderKey) ?? 0) + 1);
  return counts;
}

// The toggle: pulled records go back to unpulled, and vice versa.
export function pickPatch(r: DbRecord, now: Date = new Date()): Partial<DbRecord> {
  return { picked_at: r.picked_at ? null : now.toISOString() };
}
