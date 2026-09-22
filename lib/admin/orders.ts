import type {
  DbRecord,
  Invoice,
  Order,
  OrderRequest,
  OrderStatus,
} from "../supabase.ts";
import { bundleBreakdown } from "../records.ts";
import { holdActive } from "./records.ts";
import { saleItem } from "./sales.ts";

// Order rules: which order a sale lands in, what the inbox shows while an
// order is open, and which request an order came from. Pure — no React,
// no Supabase. The writes live in orders-db.ts.

const RANK: Record<OrderStatus, number> = {
  held: 0,
  invoiced: 1,
  paid: 2,
  cancelled: 3,
  refunded: 4,
};

// An order only moves forward: holding records that are already invoiced
// keeps the invoice; marking them sold makes the order paid.
export function advanceStatus(current: OrderStatus, next: OrderStatus) {
  return RANK[next] > RANK[current] ? next : current;
}

// How long a hold keeps records off the shop — the desk, the catalog row
// and a sent invoice all use it.
export const HOLD_HOURS = 48;
export const holdExpiry = (now: number = Date.now()) =>
  new Date(now + HOLD_HOURS * 3600 * 1000).toISOString();

// The live PayPal invoice any of these records is already on, if one is:
// stamped on an unsold record, or held by an invoiced order a record
// belongs to. A second invoice would replace the first on the order while
// the first stays payable on PayPal, so the desk must cancel it first.
export function liveInvoiceOn(
  targets: Pick<DbRecord, "sold" | "paypal_invoice_id" | "order_id">[],
  orders: Map<number, Pick<Order, "status" | "paypal_invoice_id">>
): string | null {
  for (const r of targets) {
    if (!r.sold && r.paypal_invoice_id) return r.paypal_invoice_id;
    const o = r.order_id != null ? orders.get(r.order_id) : undefined;
    if (o?.status === "invoiced" && o.paypal_invoice_id) return o.paypal_invoice_id;
  }
  return null;
}

// An invoice unpaid this long is worth a nudge or a cancel.
export const STALE_INVOICE_HOURS = 24;

export const isOpen = (o: Pick<Order, "status">) =>
  o.status === "held" || o.status === "invoiced";

const sameBuyer = (a: string, b: string) =>
  a.trim().toLowerCase() === b.trim().toLowerCase();

// The open order a set of records already belongs to, if the sale can
// continue in it: the records that have an order all share one, it is
// still open, and the buyer matches (a blank buyer defers to the order's).
// Otherwise the sale starts a new order and the records move to it.
export function pickOrder(
  targets: Pick<DbRecord, "order_id">[],
  buyer: string,
  orders: Map<number, Order>
): Order | null {
  const ids = new Set(
    targets.map((r) => r.order_id).filter((id): id is number => id != null)
  );
  if (ids.size !== 1) return null;
  const order = orders.get([...ids][0]);
  if (!order || !isOpen(order)) return null;
  if (buyer.trim() && !sameBuyer(buyer, order.buyer_username)) return null;
  return order;
}

// The buyer a new order is named for when the desk left the field blank:
// a hold's buyer, then whatever an earlier sale wrote on the row.
export function fallbackBuyer(
  targets: Pick<DbRecord, "hold_buyer" | "buyer_username">[]
) {
  for (const r of targets) {
    const b = (r.hold_buyer ?? "").trim() || (r.buyer_username ?? "").trim();
    if (b) return b;
  }
  return "";
}

// The shop request this order fulfils: an open request whose records are
// all in the order. The first (newest) match wins.
export function requestForOrder(
  targetIds: number[],
  requests: OrderRequest[]
): OrderRequest | null {
  const ids = new Set(targetIds);
  return (
    requests.find(
      (req) =>
        (req.status === "loaded" || req.status === "new") &&
        req.record_ids.length > 0 &&
        req.record_ids.every((id) => ids.has(id))
    ) ?? null
  );
}

// An order in the inbox: held or invoiced, with the unsold records it
// still covers. A held order lasts only while a hold is active on some
// member — an expired hold puts the records back on the shop, and the
// order lapses with it. An invoiced order stays until it's paid or
// cancelled, even with no records left, so a live PayPal invoice is
// never forgotten. Sorted by what needs the seller soonest: lapsed holds
// (release or chase), then invoices oldest first (the longest unpaid on
// top), then running holds by the one that lapses next.
export type OpenOrder = {
  order: Order;
  buyer: string;
  invoice: Invoice | null;
  recs: DbRecord[];
  totals: ReturnType<typeof bundleBreakdown>;
  holdUntil: number; // latest hold expiry among members (ms), 0 if none
  expired: boolean; // held order whose holds have all lapsed
  stale: boolean; // invoiced and unpaid for STALE_INVOICE_HOURS or more
};

const urgency = (o: OpenOrder) =>
  o.expired ? 0 : o.order.status === "invoiced" ? 1 : 2;

export function openOrders(
  orders: Order[],
  records: DbRecord[],
  invoices: Invoice[],
  now: number = Date.now()
): OpenOrder[] {
  const invoiceById = new Map(invoices.map((i) => [i.paypal_invoice_id, i]));
  const members = new Map<number, DbRecord[]>();
  for (const r of records) {
    if (r.sold || r.order_id == null) continue;
    const list = members.get(r.order_id);
    if (list) list.push(r);
    else members.set(r.order_id, [r]);
  }
  return orders
    .filter(isOpen)
    .map((order) => {
      const recs = members.get(order.id) ?? [];
      const holdUntil = recs.reduce(
        (max, r) =>
          r.hold_until ? Math.max(max, new Date(r.hold_until).getTime()) : max,
        0
      );
      return {
        order,
        buyer: order.buyer_username.trim(),
        invoice: order.paypal_invoice_id
          ? (invoiceById.get(order.paypal_invoice_id) ?? null)
          : null,
        recs,
        totals: bundleBreakdown(
          recs.map((r) => saleItem(r)),
          Number(order.credit ?? 0)
        ),
        holdUntil,
        expired: order.status === "held" && !recs.some((r) => holdActive(r, now)),
        stale:
          order.status === "invoiced" &&
          now - new Date(order.created_at).getTime() >=
            STALE_INVOICE_HOURS * 3600 * 1000,
      };
    })
    .filter((o) => o.order.status === "invoiced" || o.recs.length > 0)
    .sort(
      (a, b) =>
        urgency(a) - urgency(b) ||
        (urgency(a) === 2
          ? a.holdUntil - b.holdUntil
          : a.order.created_at.localeCompare(b.order.created_at))
    );
}
