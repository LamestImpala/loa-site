import type {
  DbRecord,
  Invoice,
  Order,
  OrderRequest,
  Shipment,
  ShopMessage,
  ShopReview,
} from "../supabase.ts";
import { discogsReady, groupOrders, orderPhase, pushable } from "./fulfillment.ts";
import { openOrders } from "./orders.ts";
import { awaitingDropOff, openParcels, packList } from "./pack-list.ts";
import { pickList } from "./pick-list.ts";
import { awaitsPriceRun, isDraft } from "./records.ts";

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
  toFinish: number; // orders whose boxes have left, not marked done yet
  toUnlist: number; // shipped records still in the owner's Discogs collection
  priceApprovals: number; // price changes from the daily run waiting on approve or reject
  draftsToPublish: number; // drafts the price run won't publish on its own
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
    toFinish: groups.filter((g) => orderPhase(g, now) === "after").length,
    toUnlist: discogsReady(records, shipments, orders).length,
    priceApprovals: pendingPrices.length,
    draftsToPublish: records.filter((r) => isDraft(r) && !awaitsPriceRun(r, now)).length,
  };
}

// What the Sell badge counts: the things only the Sell page can clear.
// Orders simply waiting on the buyer aren't the seller's move.
export function sellCount(w: Worklist) {
  return w.newRequests + w.newMessages + w.expiredHolds + w.staleInvoices;
}

// What the Orders step counts: the jobs done on an order's card after its
// boxes are labeled — push tracking, sync the fee, mark it done.
export function ordersCount(w: Worklist) {
  return w.toPush + w.toSync + w.toFinish;
}

// What the Ship badge counts: every Ship step's badge added up.
export function shipCount(w: Worklist) {
  return w.toPull + w.toPack + w.needLabels + w.toSend + ordersCount(w);
}

// What the Catalog tab counts: drafts waiting on the seller to price or
// publish, plus shipped records to take out of the Discogs collection.
export function catalogCount(w: Worklist) {
  return w.draftsToPublish + w.toUnlist;
}

// What the Stock badge counts: the Catalog's jobs plus the price changes
// waiting on Pricing.
export function stockCount(w: Worklist) {
  return catalogCount(w) + w.priceApprovals;
}

// The Ship pages as the steps a paid order walks through — Pick → Pack →
// Labels → Drop off — then Orders, where each order's card lives. `count`
// is the work waiting at each.
export type ShipStep = {
  key: "pick" | "pack" | "labels" | "dropoff" | "orders";
  href: string;
  label: string;
  count: number;
  countLabel: string; // read out after the number
};

export function shipSteps(w: Worklist): ShipStep[] {
  return [
    { key: "pick", href: "/admin/pick", label: "Pick", count: w.toPull, countLabel: "to pull" },
    { key: "pack", href: "/admin/pack", label: "Pack", count: w.toPack, countLabel: "to pack" },
    {
      key: "labels",
      href: "/admin/labels",
      label: "Labels",
      count: w.needLabels,
      countLabel: "boxes without a label",
    },
    {
      key: "dropoff",
      href: "/admin/ship",
      label: "Drop off",
      count: w.toSend,
      countLabel: "labeled boxes to drop off",
    },
    {
      key: "orders",
      href: "/admin/ship/orders",
      label: "Orders",
      count: ordersCount(w),
      countLabel: "orders to push, sync or mark done",
    },
  ];
}

// Where "Ship" in the nav goes: the first step with work waiting, so one
// click lands on the next thing to do. With nothing waiting it opens the
// orders.
export function shipHref(w: Worklist) {
  return (shipSteps(w).find((s) => s.count > 0) ?? { href: "/admin/ship/orders" }).href;
}
