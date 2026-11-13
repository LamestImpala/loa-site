import type {
  DbRecord,
  Invoice,
  Order,
  OrderRequest,
  Shipment,
  ShopMessage,
  ShopReview,
} from "../supabase.ts";
import { discogsReady, groupOrders, pushable } from "./fulfillment.ts";
import { openOrders } from "./orders.ts";
import { awaitingDropOff, openParcels, packList } from "./pack-list.ts";
import { pickList } from "./pick-list.ts";

// What's waiting on the seller right now, one count per job, from the
// tables every admin page already has. Drives the nav badges and the
// Today page's to-do list (today.ts). Pure — no React, no Supabase.

// A fulfilled order stops asking for its PayPal fee after this long —
// the fulfillment panel's archive window.
export const SYNC_WINDOW_DAYS = 21;

export type Worklist = {
  newRequests: number; // shop requests nobody has loaded yet
  newMessages: number; // emails to orders@ nobody has read yet
  pendingReviews: number; // buyer reviews waiting to be published or hidden
  openOrders: number; // held or invoiced, not yet paid
  expiredHolds: number; // held orders whose holds have all lapsed
  staleInvoices: number; // invoiced, unpaid for STALE_INVOICE_HOURS+
  toPull: number; // records on the pick list not marked pulled
  toPack: number; // records in paid orders not in any box yet
  needLabels: number; // boxes with no tracking number
  toSend: number; // labeled boxes not dropped off yet
  toPush: number; // orders with tracking PayPal hasn't been told
  toSync: number; // paid orders whose invoice has no PayPal fee recorded
  toUnlist: number; // shipped records still in the owner's Discogs collection
  priceApprovals: number; // price changes from the daily run waiting on approve or reject
};

export function worklist(
  data: {
    records: DbRecord[];
    shipments: Shipment[];
    invoices: Invoice[];
    orders: Order[];
    orderRequests: OrderRequest[];
    messages?: ShopMessage[];
    reviews?: Pick<ShopReview, "status">[];
    // Rows of pending_price_changes still pending; only the count matters.
    pendingPrices?: readonly unknown[];
  },
  now: number = Date.now()
): Worklist {
  const {
    records,
    shipments,
    invoices,
    orders,
    orderRequests,
    messages = [],
    reviews = [],
    pendingPrices = [],
  } = data;
  const open = openOrders(orders, records, invoices, now);
  const invoiceById = new Map(invoices.map((i) => [i.paypal_invoice_id, i]));
  const syncAfter = now - SYNC_WINDOW_DAYS * 24 * 3600 * 1000;
  const groups = groupOrders(
    records.filter((r) => r.sold),
    shipments,
    orders
  );
  const toSync = groups.filter((g) => {
    if (!g.invoiceId) return false;
    if (g.order && g.order.status !== "paid") return false;
    if (g.done && g.lastActivity < syncAfter) return false;
    return invoiceById.get(g.invoiceId)?.paypal_fee == null;
  }).length;
  return {
    newRequests: orderRequests.filter((r) => r.status === "new").length,
    newMessages: messages.filter((m) => m.direction === "in" && m.status === "new").length,
    pendingReviews: reviews.filter((r) => r.status === "pending").length,
    openOrders: open.length,
    expiredHolds: open.filter((o) => o.expired).length,
    staleInvoices: open.filter((o) => o.stale).length,
    toPull: pickList(records, shipments, orders).filter((r) => !r.picked).length,
    toPack: packList(records, shipments, orders).reduce(
      (n, o) => n + o.loose.length,
      0
    ),
    needLabels: openParcels(shipments).length,
    toSend: awaitingDropOff(shipments, orders).length,
    toPush: groups.filter((g) => g.shipments.some(pushable)).length,
    toSync,
    toUnlist: discogsReady(records, shipments, orders).length,
    priceApprovals: pendingPrices.length,
  };
}

// What the Sell badge counts: the things only the Sell page can clear.
// Orders simply waiting on the buyer aren't the seller's move.
export function sellCount(w: Worklist) {
  return w.newRequests + w.newMessages + w.expiredHolds + w.staleInvoices;
}

// What the Send badge counts: every job after the label — drop off, push
// tracking, sync the fee.
export function sendCount(w: Worklist) {
  return w.toSend + w.toPush + w.toSync;
}

// What the Ship badge counts: the four Ship pages' badges added up.
export function shipCount(w: Worklist) {
  return w.toPull + w.toPack + w.needLabels + sendCount(w);
}

// What the Stock badge counts: the Catalog's Discogs removals plus the
// price changes waiting on Pricing.
export function stockCount(w: Worklist) {
  return w.toUnlist + w.priceApprovals;
}

// Where "Ship" in the nav goes: the first step of Pick → Pack → Labels →
// Send with work waiting, so one click lands on the next thing to do.
// With nothing waiting it opens the orders on Send.
export function shipHref(w: Worklist) {
  if (w.toPull > 0) return "/admin/pick";
  if (w.toPack > 0) return "/admin/pack";
  if (w.needLabels > 0) return "/admin/labels";
  return "/admin/ship";
}
