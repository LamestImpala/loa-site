import type {
  DbRecord,
  Invoice,
  Order,
  OrderRequest,
  Shipment,
} from "../supabase.ts";
import { groupOrders } from "./fulfillment.ts";
import { openOrders } from "./orders.ts";
import { openParcels, packList } from "./pack-list.ts";
import { pickList } from "./pick-list.ts";

// What's waiting on the seller right now, one count per job, from the
// tables every admin page already has. Drives the nav badges and the
// inbox "Next up" strip. Pure — no React, no Supabase.

// A fulfilled order stops asking for its PayPal fee after this long —
// the fulfillment panel's archive window.
export const SYNC_WINDOW_DAYS = 21;

export type Worklist = {
  newRequests: number; // shop requests nobody has loaded yet
  openOrders: number; // held or invoiced, not yet paid
  expiredHolds: number; // held orders whose holds have all lapsed
  staleInvoices: number; // invoiced, unpaid for STALE_INVOICE_HOURS+
  toPull: number; // records on the pick list not marked pulled
  toPack: number; // records in paid orders not in any box yet
  needLabels: number; // boxes with no tracking number
  toSync: number; // paid orders whose invoice has no PayPal fee recorded
};

export function worklist(
  data: {
    records: DbRecord[];
    shipments: Shipment[];
    invoices: Invoice[];
    orders: Order[];
    orderRequests: OrderRequest[];
  },
  now: number = Date.now()
): Worklist {
  const { records, shipments, invoices, orders, orderRequests } = data;
  const open = openOrders(orders, records, invoices, now);
  const invoiceById = new Map(invoices.map((i) => [i.paypal_invoice_id, i]));
  const syncAfter = now - SYNC_WINDOW_DAYS * 24 * 3600 * 1000;
  const toSync = groupOrders(
    records.filter((r) => r.sold),
    shipments,
    orders
  ).filter((g) => {
    if (!g.invoiceId) return false;
    if (g.order && g.order.status !== "paid") return false;
    if (g.done && g.lastActivity < syncAfter) return false;
    return invoiceById.get(g.invoiceId)?.paypal_fee == null;
  }).length;
  return {
    newRequests: orderRequests.filter((r) => r.status === "new").length,
    openOrders: open.length,
    expiredHolds: open.filter((o) => o.expired).length,
    staleInvoices: open.filter((o) => o.stale).length,
    toPull: pickList(records, shipments, orders).filter((r) => !r.picked).length,
    toPack: packList(records, shipments, orders).reduce(
      (n, o) => n + o.loose.length,
      0
    ),
    needLabels: openParcels(shipments).length,
    toSync,
  };
}

// What the Inbox badge counts: the things only the Inbox can clear.
export function inboxCount(w: Worklist) {
  return w.newRequests + w.expiredHolds + w.staleInvoices;
}
