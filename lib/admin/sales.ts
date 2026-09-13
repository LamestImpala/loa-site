import type { DbRecord, Invoice, OrderRequest } from "../supabase.ts";
import { bundleBreakdown } from "../records.ts";
import { holdActive } from "./records.ts";

// The sale side of the admin: what a mark-sold writes, what it finishes,
// and how open orders group in the inbox. Pure — no React, no Supabase.

// The record patch for a sale. The buyer typed at the desk wins; otherwise
// the hold's buyer, then whatever was already on the row. Holds always
// clear — a sold record must not stay "held".
export function soldPatch(
  r: DbRecord,
  buyer: string,
  now: Date = new Date()
): Partial<DbRecord> {
  return {
    sold: true,
    sold_at: now.toISOString(),
    sold_price: Number(r.price),
    buyer_username:
      buyer || r.hold_buyer || (r.buyer_username ?? "").trim() || "",
    hold_buyer: null,
    hold_until: null,
  };
}

// Loaded order requests whose records are now all sold — the ones a sale
// closes automatically.
export function finishedRequests(
  requests: OrderRequest[],
  justSold: Set<number>,
  byId: Map<number, DbRecord>
): OrderRequest[] {
  return requests.filter(
    (req) =>
      req.status === "loaded" &&
      req.record_ids.every((id) => justSold.has(id) || byId.get(id)?.sold)
  );
}

// Records a sale should offer to pull from the owner's Discogs collection:
// actually written as sold, linked to a release, not already removed.
export function discogsCandidates(
  targets: DbRecord[],
  justSold: Set<number>
): DbRecord[] {
  return targets.filter(
    (r) => justSold.has(r.id) && !!r.discogs_release_id && !r.discogs_removed
  );
}

// An order between invoice and payment: unpaid, uncancelled, with at
// least one unsold record. This is the durable "order in progress" — it
// survives clearing the sale desk, and disappears once its records are
// marked sold or the invoice is cancelled. Newest first.
export type PendingInvoiceGroup = {
  invoice: Invoice;
  buyer: string;
  recs: DbRecord[];
  totals: ReturnType<typeof bundleBreakdown>;
  holdUntil: number; // latest hold expiry among members (ms), 0 if none
};

export function pendingInvoiceGroups(
  records: DbRecord[],
  invoices: Invoice[]
): PendingInvoiceGroup[] {
  const byId = new Map(records.map((r) => [r.id, r]));
  const byInvoice = new Map<string, DbRecord[]>();
  for (const r of records) {
    if (r.sold || !r.paypal_invoice_id) continue;
    const list = byInvoice.get(r.paypal_invoice_id);
    if (list) list.push(r);
    else byInvoice.set(r.paypal_invoice_id, [r]);
  }
  return invoices
    .filter((inv) => !inv.paid_at && inv.status !== "CANCELLED")
    .map((inv) => {
      // Prefer the live stamp; fall back to the ids saved at creation for
      // invoices whose stamp never landed.
      let recs = byInvoice.get(inv.paypal_invoice_id) ?? [];
      if (recs.length === 0 && inv.record_ids?.length) {
        recs = inv.record_ids
          .map((id) => byId.get(id))
          .filter((r): r is DbRecord => !!r && !r.sold);
      }
      const holdUntil = recs.reduce(
        (max, r) =>
          r.hold_until ? Math.max(max, new Date(r.hold_until).getTime()) : max,
        0
      );
      return {
        invoice: inv,
        buyer: (inv.buyer_username ?? recs[0]?.hold_buyer ?? "").trim(),
        recs,
        totals: bundleBreakdown(recs),
        holdUntil,
      };
    })
    .filter((p) => p.recs.length > 0)
    .sort((a, b) => b.invoice.created_at.localeCompare(a.invoice.created_at));
}

// Active holds grouped per buyer. Records covered by a pending invoice are
// listed under that invoice instead, so an order shows once. Soonest
// expiry first.
export type HoldGroup = { buyer: string; recs: DbRecord[]; until: number };

export function activeHoldGroups(
  records: DbRecord[],
  pendingInvoiceIds: Set<string>,
  now: number = Date.now()
): HoldGroup[] {
  const groups = new Map<string, DbRecord[]>();
  for (const r of records) {
    if (r.sold || !holdActive(r, now)) continue;
    if (r.paypal_invoice_id && pendingInvoiceIds.has(r.paypal_invoice_id))
      continue;
    const buyer = (r.hold_buyer ?? "").trim() || "(no buyer name)";
    const list = groups.get(buyer);
    if (list) list.push(r);
    else groups.set(buyer, [r]);
  }
  return [...groups.entries()]
    .map(([buyer, recs]) => ({
      buyer,
      recs,
      // Holds in a group can expire at different times; show the soonest.
      until: recs.reduce(
        (min, r) => Math.min(min, new Date(r.hold_until!).getTime()),
        Infinity
      ),
    }))
    .sort((a, b) => a.until - b.until);
}
