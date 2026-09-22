import type { SupabaseClient } from "@supabase/supabase-js";
import type { Invoice, Order } from "../supabase.ts";
import { PAID_STATUSES, REFUNDED_STATUSES, type getInvoicePayment } from "../paypal.ts";
import { INVOICE_HOLD_UNTIL } from "./records.ts";

// Mirroring what PayPal says about an invoice onto our rows, shared by the
// inbox's Check PayPal route and the PayPal webhook: the invoice row
// (status, payment link, paid date, shipping), the buyer's ship-to on its
// order, and — while it's still payable — the until-resolved hold on its
// unsold records. The sale itself is settlePaidInvoice (sales-db.ts).

export type InvoicePayment = Awaited<ReturnType<typeof getInvoicePayment>>;

export async function mirrorInvoice(
  supabase: SupabaseClient,
  id: string,
  payment: InvoicePayment
): Promise<{ invoice: Invoice; order: Order | null; paid: boolean; heldIds: number[] }> {
  const paid = PAID_STATUSES.has(payment.status);
  const paidAt = paid
    ? payment.paymentDate
      ? new Date(payment.paymentDate).toISOString()
      : new Date().toISOString()
    : null;
  const { data: existing } = await supabase
    .from("invoices")
    .select("recipient_view_url, paid_at")
    .eq("paypal_invoice_id", id)
    .maybeSingle();
  const patch: Record<string, unknown> = {
    paypal_invoice_id: id,
    status: payment.status,
    updated_at: new Date().toISOString(),
  };
  // Keep the first link and paid date we learned; PayPal's answer only
  // fills gaps.
  if (!existing?.recipient_view_url && payment.recipientViewUrl) {
    patch.recipient_view_url = payment.recipientViewUrl;
  }
  if (paidAt && !existing?.paid_at) patch.paid_at = paidAt;
  if (payment.shippingCharged != null) {
    patch.shipping_charged = payment.shippingCharged;
  }
  const { data: saved, error } = await supabase
    .from("invoices")
    .upsert(patch, { onConflict: "paypal_invoice_id" })
    .select()
    .single();
  if (error) throw new Error(error.message);

  // The buyer's ship-to lands on the order once PayPal reports it.
  // Overwritten every check — PayPal is the truth for where it goes.
  let order: Order | null = null;
  if (payment.shipTo) {
    const { data: orderRow, error: orderError } = await supabase
      .from("orders")
      .update({ ship_to: payment.shipTo, updated_at: new Date().toISOString() })
      .eq("paypal_invoice_id", id)
      .neq("status", "cancelled")
      .select()
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (orderError) {
      console.error("invoice mirror: ship_to update failed:", orderError.message);
    } else {
      order = (orderRow ?? null) as Order | null;
    }
  }

  // Still payable: its unsold records stay held until it resolves. Heals
  // holds that lapsed on invoices sent before holds lasted that long.
  let heldIds: number[] = [];
  if (!paid && !REFUNDED_STATUSES.has(payment.status) && payment.status !== "CANCELLED") {
    const { data: held, error: holdError } = await supabase
      .from("records")
      .update({ hold_until: INVOICE_HOLD_UNTIL, updated_at: new Date().toISOString() })
      .eq("paypal_invoice_id", id)
      .eq("sold", false)
      .or(`hold_until.is.null,hold_until.lt."${INVOICE_HOLD_UNTIL}"`)
      .select("id");
    if (holdError) {
      console.error("invoice mirror: hold refresh failed:", holdError.message);
    } else {
      heldIds = (held ?? []).map((r) => r.id);
    }
  }
  return { invoice: saved as Invoice, order, paid, heldIds };
}
