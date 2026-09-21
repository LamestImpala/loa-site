import type { DbRecord, Shipment } from "../supabase.ts";
import { unsoldPatch } from "./sales.ts";

// Refund rules: what happens to an order's records when PayPal reports
// the whole payment refunded. Pure — no React, no Supabase. The writes
// are in the paypal-tracking route's pull.

type PlanRecord = { id: number; tracking_number?: string | null };

// A record that already left in a tracked parcel isn't coming back (a
// lost or damaged parcel is the usual refund after shipping), so it stays
// sold; one that never shipped goes back up for sale. Decided per record,
// so a half-shipped order splits.
export function refundPlan<R extends PlanRecord>(
  records: R[],
  shipments: Pick<Shipment, "record_ids" | "tracking_code" | "status">[]
): { relist: R[]; keepSold: R[] } {
  const shipped = new Set(
    shipments
      .filter((s) => s.status !== "refunded" && !!s.tracking_code)
      .flatMap((s) => s.record_ids ?? [])
  );
  const relist: R[] = [];
  const keepSold: R[] = [];
  for (const r of records) {
    if (shipped.has(r.id) || (r.tracking_number ?? "").trim()) keepSold.push(r);
    else relist.push(r);
  }
  return { relist, keepSold };
}

// The record patch for a refunded sale's unshipped records: un-sold, and
// cleared of the dead sale's buyer, price and invoice so the row doesn't
// regroup under it in fulfillment.
export function refundedPatch(): Partial<DbRecord> {
  return {
    ...unsoldPatch(),
    sold_price: null,
    buyer_username: "",
    paypal_invoice_id: null,
    tracking_number: "",
  };
}
