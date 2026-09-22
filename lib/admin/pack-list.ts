import type { DbRecord, Invoice, Order, Shipment, ShipTo } from "../supabase.ts";
import { groupOrders, orderStage } from "./fulfillment.ts";

// Pack rules: which paid orders are on the packing table, what's still
// loose in each, which boxes are sealed, and the one order boxes go in
// for slips and labels. Pure — no React, no Supabase.

export type PackOrder = {
  key: string; // OrderGroup.key
  order: Order | null; // null for sold records that predate the orders table
  buyer: string;
  shipTo: ShipTo | null;
  invoiceId: string;
  loose: DbRecord[]; // sold, not in any parcel yet — shelf order
  parcels: Shipment[]; // this order's parcels, pack order
  pulled: number; // loose records already marked pulled on the pick list
};

const shelfCompare = (a: DbRecord, b: DbRecord) =>
  a.artist.localeCompare(b.artist, undefined, { sensitivity: "base" }) ||
  a.title.localeCompare(b.title, undefined, { sensitivity: "base" });

// Boxes in the order they were sealed, then by id for the fulfillment
// card's parcels (never sealed). Slips print and labels stack in this
// order, so it must be the same everywhere.
export function sortByPackOrder<T extends Pick<Shipment, "id" | "packed_at">>(
  shipments: T[]
): T[] {
  return [...shipments].sort((a, b) => {
    const pa = a.packed_at ? new Date(a.packed_at).getTime() : Infinity;
    const pb = b.packed_at ? new Date(b.packed_at).getTime() : Infinity;
    return pa - pb || a.id - b.id;
  });
}

// Paid orders not yet fully shipped, alphabetical by buyer, with a
// pre-orders buyer group counting as paid (same admission as the pick
// list). Every order that still has loose records or an untracked box.
export function packList(
  records: DbRecord[],
  shipments: Shipment[],
  orders: Order[]
): PackOrder[] {
  const out: PackOrder[] = [];
  for (const g of groupOrders(records.filter((r) => r.sold), shipments, orders)) {
    if (g.done) continue;
    if (g.order && g.order.status !== "paid") continue;
    const loose = [...g.unassigned].sort(shelfCompare);
    out.push({
      key: g.key,
      order: g.order,
      buyer: g.buyer,
      shipTo: g.order?.ship_to ?? null,
      invoiceId: g.invoiceId,
      loose,
      parcels: sortByPackOrder(g.shipments),
      pulled: loose.filter((r) => !!r.picked_at).length,
    });
  }
  return out.sort(
    (a, b) =>
      a.buyer.localeCompare(b.buyer, undefined, { sensitivity: "base" }) ||
      a.key.localeCompare(b.key)
  );
}

// Boxes with no label yet — what a dropped label PDF can be matched to,
// and what a packing slip prints for. Sealed on the pack page or made on
// the fulfillment card alike; sealed ones come first, in pack order.
export function openParcels(shipments: Shipment[]): Shipment[] {
  return sortByPackOrder(
    shipments.filter((s) => !s.tracking_code && s.status !== "refunded")
  );
}

// What a packing slip says about one box. Ship-to comes from the parcel's
// own snapshot when it has one (taken at seal time), else the order's.
export type PackingSlip = {
  boxId: number;
  buyer: string;
  shipTo: ShipTo | null;
  boxIndex: number; // 1-based position among the order's boxes
  boxCount: number;
  packedAt: string | null;
  records: Pick<DbRecord, "artist" | "title" | "pressing" | "media" | "sleeve">[];
};

export function slipsForParcels(
  parcels: Shipment[],
  allShipments: Shipment[],
  byId: Map<number, DbRecord>,
  ordersById: Map<number, Order>
): PackingSlip[] {
  return sortByPackOrder(parcels).map((s) => {
    const siblings = sortByPackOrder(
      allShipments.filter(
        (x) =>
          x.status !== "refunded" &&
          (s.order_id != null
            ? x.order_id === s.order_id
            : x.order_id == null &&
              x.buyer_username.trim().toLowerCase() ===
                s.buyer_username.trim().toLowerCase())
      )
    );
    const snapshot = s.to_address as Partial<ShipTo> | null | undefined;
    const order = s.order_id != null ? ordersById.get(s.order_id) : undefined;
    const shipTo: ShipTo | null =
      snapshot && (snapshot.name || snapshot.line1)
        ? {
            name: snapshot.name ?? null,
            line1: snapshot.line1 ?? null,
            line2: snapshot.line2 ?? null,
            city: snapshot.city ?? null,
            state: snapshot.state ?? null,
            postal_code: snapshot.postal_code ?? null,
            country_code: snapshot.country_code ?? null,
          }
        : (order?.ship_to ?? null);
    return {
      boxId: s.id,
      buyer: (order?.buyer_username ?? s.buyer_username).trim(),
      shipTo,
      boxIndex: Math.max(1, siblings.findIndex((x) => x.id === s.id) + 1),
      boxCount: Math.max(1, siblings.length),
      packedAt: s.packed_at,
      records: (s.record_ids ?? [])
        .map((id) => byId.get(id))
        .filter((r): r is DbRecord => !!r)
        .sort(shelfCompare),
    };
  });
}

export function packProgress(list: PackOrder[]) {
  const loose = list.reduce((n, o) => n + o.loose.length, 0);
  const boxes = list.reduce(
    (n, o) => n + o.parcels.filter((s) => !s.tracking_code).length,
    0
  );
  return { orders: list.length, loose, boxes };
}

// Ship manifest rows: every package still open on the fulfillment board,
// labeled or not — a box has its label on when its tracking is recorded,
// which is before it leaves the house, so "awaiting a label" is the
// wrong net. An order leaves the manifest when its stage is done (all
// boxed, tracked, pushed and fee-synced), the same moment it leaves the
// board. Boxed rows first in pack order (the slip and label order), then
// one row per order whose records aren't in a box in the app yet.
export type ManifestRow = {
  boxId: number | null; // null: the order's records aren't boxed in the app
  buyer: string;
  shipTo: ShipTo | null;
  boxIndex: number;
  boxCount: number;
  tracking: string | null;
  records: number;
};

export function manifestRows(
  records: DbRecord[],
  shipments: Shipment[],
  orders: Order[],
  invoices: Pick<Invoice, "paypal_invoice_id" | "paypal_fee">[]
): ManifestRow[] {
  const invoiceById = new Map(invoices.map((inv) => [inv.paypal_invoice_id, inv]));
  const boxed: { row: ManifestRow; s: Shipment }[] = [];
  const loose: ManifestRow[] = [];
  for (const g of groupOrders(records.filter((r) => r.sold), shipments, orders)) {
    if (g.order && g.order.status !== "paid") continue;
    if (orderStage(g, invoiceById.get(g.invoiceId)) === "done") continue;
    const parcels = sortByPackOrder(g.shipments);
    const shipToOf = (s: Shipment): ShipTo | null => {
      const snap = s.to_address as Partial<ShipTo> | null | undefined;
      return snap && (snap.name || snap.line1)
        ? {
            name: snap.name ?? null,
            line1: snap.line1 ?? null,
            line2: snap.line2 ?? null,
            city: snap.city ?? null,
            state: snap.state ?? null,
            postal_code: snap.postal_code ?? null,
            country_code: snap.country_code ?? null,
          }
        : (g.order?.ship_to ?? null);
    };
    parcels.forEach((s, i) =>
      boxed.push({
        s,
        row: {
          boxId: s.id,
          buyer: g.buyer,
          shipTo: shipToOf(s),
          boxIndex: i + 1,
          boxCount: parcels.length,
          tracking: s.tracking_code,
          records: (s.record_ids ?? []).length,
        },
      })
    );
    if (g.unassigned.length > 0)
      loose.push({
        boxId: null,
        buyer: g.buyer,
        shipTo: g.order?.ship_to ?? null,
        boxIndex: 1,
        boxCount: 1,
        tracking: null,
        records: g.unassigned.length,
      });
  }
  return [
    ...sortByPackOrder(boxed.map(({ s, row }) => ({ ...s, row }))).map((x) => x.row),
    ...loose.sort((a, b) => a.buyer.localeCompare(b.buyer, undefined, { sensitivity: "base" })),
  ];
}

// Order sheet: the Letter-size packing checklist — every order on the
// packing table with each record still to go into a mailer, in the same
// buyer A→Z order as the Pack page cards. Loose records first (shelf
// order), then records already in a box that has no label yet, tagged
// with the Box # so a sealed box reads as done at a glance. Records in a
// labeled box are finished and left off; an order with none left drops.
export type OrderSheetRecord = Pick<DbRecord, "artist" | "title" | "media" | "sleeve"> & {
  boxId: number | null;
};

export type OrderSheetOrder = {
  key: string;
  buyer: string;
  shipToName: string | null;
  records: OrderSheetRecord[];
};

export function orderSheet(
  list: PackOrder[],
  byId: Map<number, DbRecord>
): OrderSheetOrder[] {
  const line = (r: DbRecord, boxId: number | null): OrderSheetRecord => ({
    artist: r.artist,
    title: r.title,
    media: r.media,
    sleeve: r.sleeve,
    boxId,
  });
  return list
    .map((o) => ({
      key: o.key,
      buyer: o.buyer,
      shipToName: o.shipTo?.name ?? null,
      records: [
        ...o.loose.map((r) => line(r, null)),
        ...o.parcels
          .filter((s) => !s.tracking_code)
          .flatMap((s) =>
            (s.record_ids ?? [])
              .map((id) => byId.get(id))
              .filter((r): r is DbRecord => !!r)
              .sort(shelfCompare)
              .map((r) => line(r, s.id))
          ),
      ],
    }))
    .filter((o) => o.records.length > 0);
}
