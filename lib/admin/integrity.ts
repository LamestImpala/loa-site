import type { DbRecord, Invoice, Order, Shipment } from "../supabase.ts";
import { awaitingDropOff } from "./pack-list.ts";

// Things that went quietly wrong: states no button leads to on purpose,
// left behind by a closed tab, a failed write, or a hand edit. The Send
// page lists them with a jump to where each is fixed, so nothing rots
// unseen. Pure — no React, no Supabase.

// A labeled box still in the house after this long is probably forgotten.
export const UNSENT_AFTER_DAYS = 3;

export type Issue = {
  key: string;
  text: string;
  href: string; // where it gets fixed
  readdRecordId?: number; // fixable in place: re-add this record to Discogs
};

const record = (r: DbRecord) => `${r.artist} — ${r.title}`;

export function integrityIssues(
  data: {
    records: DbRecord[];
    shipments: Shipment[];
    invoices: Invoice[];
    orders: Order[];
  },
  now: number = Date.now()
): Issue[] {
  const { records, shipments, invoices, orders } = data;
  const orderById = new Map(orders.map((o) => [o.id, o]));
  const invoiceById = new Map(invoices.map((i) => [i.paypal_invoice_id, i]));
  const issues: Issue[] = [];

  // PayPal says paid, but the sale never landed (the tab closed mid-way,
  // or a write failed). Check PayPal on the order finishes it.
  for (const o of orders) {
    if (o.status !== "invoiced" || !o.paypal_invoice_id) continue;
    const inv = invoiceById.get(o.paypal_invoice_id);
    if (!inv) {
      issues.push({
        key: `no-invoice-${o.id}`,
        text: `u/${o.buyer_username}'s order is invoiced, but invoice ${o.paypal_invoice_id} isn't saved here — Check PayPal on it, or cancel it`,
        href: "/admin#open-orders",
      });
    } else if (inv.paid_at) {
      issues.push({
        key: `paid-unsold-${o.id}`,
        text: `Invoice ${o.paypal_invoice_id} (u/${o.buyer_username}) is paid, but its records aren't marked sold — Check PayPal on it`,
        href: "/admin#open-orders",
      });
    }
  }

  // A sold record outside a paid order never reaches pick, pack or the
  // stats' order view. Records a refund kept sold are fine.
  for (const r of records) {
    if (!r.sold) continue;
    const o = r.order_id != null ? orderById.get(r.order_id) : undefined;
    if (o && (o.status === "paid" || o.status === "refunded")) continue;
    issues.push({
      key: `sold-no-order-${r.id}`,
      text: `${record(r)} is sold but not in a paid order${o ? ` (order is ${o.status})` : ""} — un-sell it and sell it again from the desk`,
      href: `/admin/catalog?record=${r.id}`,
    });
  }

  // One record can only be in one box.
  const boxesByRecord = new Map<number, number[]>();
  for (const s of shipments) {
    if (s.status === "refunded") continue;
    for (const id of s.record_ids ?? []) {
      boxesByRecord.set(id, [...(boxesByRecord.get(id) ?? []), s.id]);
    }
  }
  const byId = new Map(records.map((r) => [r.id, r]));
  for (const [id, boxes] of boxesByRecord) {
    if (boxes.length < 2) continue;
    const r = byId.get(id);
    issues.push({
      key: `two-boxes-${id}`,
      text: `${r ? record(r) : `Record ${id}`} is in ${boxes.length} boxes (${boxes
        .map((b) => `#${b}`)
        .join(", ")}) — take it out of the wrong one`,
      href: "/admin/ship#fulfillment",
    });
  }

  // For sale again but gone from the Discogs collection.
  for (const r of records) {
    if (r.sold || !r.listed || !r.discogs_removed) continue;
    issues.push({
      key: `off-discogs-${r.id}`,
      text: `${record(r)} is for sale again but came out of your Discogs collection — re-add it there`,
      href: `/admin/catalog?record=${r.id}`,
      readdRecordId: r.discogs_release_id ? r.id : undefined,
    });
  }

  // Labeled and sitting in the house for days — one line, since the
  // drop-off list names the boxes.
  const cutoff = now - UNSENT_AFTER_DAYS * 24 * 3600 * 1000;
  const stale = awaitingDropOff(shipments, orders).filter(
    (s) => new Date(s.packed_at ?? s.created_at).getTime() <= cutoff
  );
  if (stale.length > 0) {
    issues.push({
      key: "unsent",
      text: `${stale.length === 1 ? "Box" : "Boxes"} ${stale
        .map((s) => `#${s.id}`)
        .join(", ")} ${stale.length === 1 ? "has" : "have"} been labeled ${UNSENT_AFTER_DAYS}+ days without a drop-off — take ${stale.length === 1 ? "it" : "them"} in, or mark ${stale.length === 1 ? "it" : "them"} if already gone`,
      href: "/admin/ship#drop-off",
    });
  }

  return issues;
}
