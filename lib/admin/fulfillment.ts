import type { DbRecord, Invoice, Order, Shipment } from "../supabase.ts";

// Fulfillment rules: how sold records and parcels group per order, what
// PayPal already knows about a parcel, and the r/VinylCollectors trade
// confirmation texts. Pure — no React, no Supabase.

// A parcel already known to PayPal, under its current tracking number.
export const inPayPal = (s: Shipment) =>
  !!s.paypal_tracker_id &&
  !!s.tracking_code &&
  s.paypal_tracked_number === s.tracking_code;

// Pushed once, but the tracking number changed since.
export const needsRepush = (s: Shipment) =>
  !!s.paypal_tracker_id &&
  !!s.tracking_code &&
  s.paypal_tracked_number !== s.tracking_code;

// Marked as a label bought inside PayPal that the tracking API can't see
// (PayPal Shipping labels never register as trackers): the tracking is
// already on the transaction, so pushing would only duplicate the buyer
// email. Parcels PayPal does know about keep their re-push behavior.
export const pushNotNeeded = (s: Shipment) =>
  s.mode === "paypal" && !s.paypal_tracker_id;

// r/VinylCollectors trade confirmations: u/VinylSwapBot only reads plain-text
// u/ mentions (hyperlinked tags are invisible to it) and only counts NEW
// top-level comments on the thread the sale came from — edits don't register.
// Credit lands once the buyer replies to the comment.
export const SWAP_BOT = "u/VinylSwapBot";

export function confirmationComment(buyer: string, records: DbRecord[]) {
  const list = [...records].sort((a, b) =>
    `${a.artist} ${a.title}`.localeCompare(`${b.artist} ${b.title}`)
  );
  return [
    SWAP_BOT,
    "",
    `Confirming my sale to u/${buyer}:`,
    "",
    ...list.map((r) => `- ${r.artist} — ${r.title}`),
    "",
    `Thanks for a smooth transaction, u/${buyer}! Please reply to this comment to confirm so the bot credits us both.`,
  ].join("\n");
}

export function buyerNudge(buyer: string, threadUrl: string) {
  const where = threadUrl
    ? `here: ${threadUrl}`
    : "on the r/VinylCollectors post the sale came from";
  return [
    `Hey u/${buyer} — thanks again for the order! I posted our trade confirmation ${where}`,
    "",
    `When you get a minute, could you reply to my comment there (a quick "Confirmed" is perfect)? That way ${SWAP_BOT} counts the trade for both of us. Cheers!`,
  ].join("\n");
}

export type OrderGroup = {
  key: string;
  order: Order | null; // null for sold records that predate the orders table
  buyer: string;
  records: DbRecord[];
  shipments: Shipment[];
  invoiceId: string; // the order's invoice, else the one id shared by member records
  unassigned: DbRecord[];
  done: boolean;
  lastActivity: number; // most recent shipment update (ms) — drives archiving
};

// One group per order, from sold records and their non-refunded parcels.
// Records and parcels without an order fall back to grouping by buyer
// name (case-insensitive), the pre-orders rule. Open orders first, then
// alphabetical by buyer.
export function groupOrders(
  records: DbRecord[],
  shipments: Shipment[],
  orders: Order[]
): OrderGroup[] {
  const orderById = new Map(orders.map((o) => [o.id, o]));
  const map = new Map<string, OrderGroup>();
  const groupFor = (orderId: number | null | undefined, buyer: string) => {
    const order = orderId != null ? (orderById.get(orderId) ?? null) : null;
    const key = order
      ? `order-${order.id}`
      : `buyer-${buyer.trim().toLowerCase() || "(no buyer)"}`;
    let g = map.get(key);
    if (!g) {
      g = {
        key,
        order,
        buyer: (order?.buyer_username ?? buyer).trim(),
        records: [],
        shipments: [],
        invoiceId: "",
        unassigned: [],
        done: false,
        lastActivity: 0,
      };
      map.set(key, g);
    }
    return g;
  };
  for (const r of records) groupFor(r.order_id, r.buyer_username ?? "").records.push(r);
  for (const s of shipments) {
    if (s.status === "refunded") continue;
    groupFor(s.order_id, s.buyer_username ?? "").shipments.push(s);
  }
  for (const g of map.values()) {
    const invoices = [
      ...new Set(
        g.records.map((r) => r.paypal_invoice_id).filter(Boolean) as string[]
      ),
    ];
    g.invoiceId =
      g.order?.paypal_invoice_id ?? (invoices.length === 1 ? invoices[0] : "");
    const assigned = new Set(g.shipments.flatMap((s) => s.record_ids ?? []));
    g.unassigned = g.records.filter((r) => !assigned.has(r.id));
    g.done =
      g.records.length > 0 &&
      g.unassigned.length === 0 &&
      g.shipments.every((s) => !!s.tracking_code);
    g.lastActivity = g.shipments.reduce(
      (max, s) =>
        Math.max(max, new Date(s.updated_at ?? s.created_at).getTime()),
      0
    );
  }
  return [...map.values()].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    return a.buyer.localeCompare(b.buyer);
  });
}

// Where an order stands, as the one job still open on it — what the
// fulfillment card names in its pill and offers as its main button:
//   pack   records not in a box yet            → the pack page
//   label  a box with no tracking number       → the labels page
//   push   tracking PayPal hasn't been told    → Push to PayPal
//   sync   invoice with no PayPal fee recorded → Sync from PayPal
//   done   nothing left but the trade confirmation
export type OrderStage = "pack" | "label" | "push" | "sync" | "done";

export const pushable = (s: Shipment) =>
  !!s.tracking_code && !!s.paypal_invoice_id && !inPayPal(s) && !pushNotNeeded(s);

export function orderStage(
  g: Pick<OrderGroup, "unassigned" | "shipments" | "invoiceId">,
  invoice: Pick<Invoice, "paypal_fee"> | null | undefined
): OrderStage {
  if (g.unassigned.length > 0) return "pack";
  if (g.shipments.some((s) => !s.tracking_code)) return "label";
  if (g.shipments.some(pushable)) return "push";
  if (g.invoiceId && invoice?.paypal_fee == null) return "sync";
  return "done";
}

// When the order started waiting on the seller: the order row's date, or
// for sales that predate the orders table the earliest sold date.
export function waitingSince(g: Pick<OrderGroup, "order" | "records">): number {
  if (g.order) return new Date(g.order.created_at).getTime();
  const times = g.records
    .map((r) => new Date(r.sold_at ?? r.updated_at).getTime())
    .filter((t) => Number.isFinite(t));
  return times.length ? Math.min(...times) : 0;
}

// The fulfillment panel's order: open orders longest-waiting first, then
// finished ones most recently shipped first.
export function byLongestWaiting(groups: OrderGroup[]): OrderGroup[] {
  return [...groups].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    return a.done
      ? b.lastActivity - a.lastActivity
      : waitingSince(a) - waitingSince(b) || a.key.localeCompare(b.key);
  });
}
