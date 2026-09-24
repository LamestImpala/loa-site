import type { SupabaseClient } from "@supabase/supabase-js";
import type { Invoice, ShipTo } from "../supabase.ts";

// Filling in what PayPal only publishes later. A paid invoice lands as a
// sale at once (webhook or inbox check), but the seller fee and the
// buyer's ship-to live in Transaction Search, which PayPal populates up
// to a few hours after payment. The /api/paypal-costs cron sweeps recent
// paid invoices still missing their fee and asks again, so the
// fulfillment card fills itself in without anyone clicking Sync.
//
// The fee is the marker: it and the address arrive together, so an
// invoice with a fee has been looked up and is left alone. A fee typed
// by hand counts too. An invoice paid longer ago than the window is the
// admin's to finish (Sync, or type the fee).

export const COSTS_WINDOW_DAYS = 7;

export type TransactionCosts = {
  found: boolean; // false: PayPal hasn't published the transaction yet
  fee: number | null;
  shipTo: ShipTo | null;
};

// Paid invoices from the last COSTS_WINDOW_DAYS days with no fee yet,
// oldest first so a stuck one is retried before a fresh one.
export async function invoicesMissingCosts(
  supabase: SupabaseClient,
  now = new Date()
): Promise<Pick<Invoice, "paypal_invoice_id" | "paid_at">[]> {
  const since = new Date(now.getTime() - COSTS_WINDOW_DAYS * 24 * 3600 * 1000).toISOString();
  const { data, error } = await supabase
    .from("invoices")
    .select("paypal_invoice_id, paid_at")
    .is("paypal_fee", null)
    .gte("paid_at", since)
    .order("paid_at", { ascending: true })
    .limit(50);
  if (error) throw new Error(error.message);
  return (data ?? []) as Pick<Invoice, "paypal_invoice_id" | "paid_at">[];
}

// Writes what Transaction Search reported: the fee onto the invoice, and
// the ship-to onto the invoice's order when the order has none yet (an
// address already there — from the invoice itself, or typed — wins; a
// background job never overwrites). Returns what actually landed.
export async function recordTransactionCosts(
  supabase: SupabaseClient,
  invoiceId: string,
  costs: TransactionCosts
): Promise<{ fee: number | null; shipTo: ShipTo | null }> {
  const now = new Date().toISOString();
  let fee: number | null = null;
  if (costs.fee != null) {
    const { error } = await supabase
      .from("invoices")
      .update({ paypal_fee: costs.fee, updated_at: now })
      .eq("paypal_invoice_id", invoiceId);
    if (error) throw new Error(`Saving the fee failed: ${error.message}`);
    fee = costs.fee;
  }
  let shipTo: ShipTo | null = null;
  if (costs.shipTo) {
    const { data, error } = await supabase
      .from("orders")
      .update({ ship_to: costs.shipTo, updated_at: now })
      .eq("paypal_invoice_id", invoiceId)
      .neq("status", "cancelled")
      .is("ship_to", null)
      .select("id");
    if (error) throw new Error(`Saving the address failed: ${error.message}`);
    if ((data ?? []).length > 0) shipTo = costs.shipTo;
  }
  return { fee, shipTo };
}

export type CostsSweep = {
  checked: string[]; // invoices asked about
  filled: { invoiceId: string; fee: number | null; shipTo: string | null }[];
  pending: string[]; // PayPal hasn't published these yet
  skipped: string[]; // no transaction to look up (paid offline)
  failed: { invoiceId: string; error: string }[];
};

// One pass: look up each invoice still missing costs and record what came
// back. `lookup` does the PayPal calls (invoice → transaction id →
// Transaction Search); null means the invoice has no transaction. One
// invoice failing doesn't stop the others.
export async function sweepMissingCosts(
  supabase: SupabaseClient,
  lookup: (invoiceId: string) => Promise<TransactionCosts | null>,
  now = new Date()
): Promise<CostsSweep> {
  const sweep: CostsSweep = { checked: [], filled: [], pending: [], skipped: [], failed: [] };
  for (const inv of await invoicesMissingCosts(supabase, now)) {
    const id = inv.paypal_invoice_id;
    sweep.checked.push(id);
    try {
      const costs = await lookup(id);
      if (!costs) {
        sweep.skipped.push(id);
      } else if (!costs.found) {
        sweep.pending.push(id);
      } else {
        const landed = await recordTransactionCosts(supabase, id, costs);
        sweep.filled.push({
          invoiceId: id,
          fee: landed.fee,
          shipTo: landed.shipTo?.name ?? landed.shipTo?.line1 ?? null,
        });
      }
    } catch (e) {
      sweep.failed.push({ invoiceId: id, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return sweep;
}
