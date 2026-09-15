import type { SupabaseClient } from "@supabase/supabase-js";
import type { Shipment, ShipTo } from "../supabase.ts";

// The parcel writes, shared by the fulfillment card, the pack page, and
// label intake. Every caller holds a Supabase client under the admin's
// own token, so RLS applies. Callers mirror the result into local state
// themselves (the provider's upsertShipmentLocal / patchShipmentLocal).

export type NewParcel = {
  buyer: string;
  orderId: number | null;
  recordIds: number[];
  invoiceId: string | null;
  // "paypal" = label bought inside PayPal, tracking typed or read off the
  // label (the pack page's default); "manual" = label bought elsewhere,
  // tracking gets pushed to PayPal.
  mode: "paypal" | "manual";
  // Set when the parcel is sealed on the pack page with its records
  // checked in; the fulfillment card's parcels leave it unset.
  packedAt?: string;
  // Snapshot of the order's ship-to at pack time, for the packing slip.
  toAddress?: ShipTo | null;
};

// A parcel with no tracking yet: status draft, USPS until told otherwise.
export async function createParcel(
  supabase: SupabaseClient,
  parcel: NewParcel
): Promise<Shipment> {
  const { data, error } = await supabase
    .from("shipments")
    .insert({
      buyer_username: parcel.buyer,
      order_id: parcel.orderId,
      record_ids: parcel.recordIds,
      mode: parcel.mode,
      status: "draft",
      carrier: "USPS",
      paypal_invoice_id: parcel.invoiceId,
      ...(parcel.packedAt ? { packed_at: parcel.packedAt } : {}),
      ...(parcel.toAddress ? { to_address: parcel.toAddress } : {}),
    })
    .select()
    .single();
  if (error) throw new Error(`Couldn't create the parcel: ${error.message}`);
  return data as Shipment;
}

// The tracking number on a parcel. A number makes it shipped; clearing
// it puts the parcel back to draft. Returns the patch that was written so
// the caller can mirror it locally.
export async function setParcelTracking(
  supabase: SupabaseClient,
  shipment: Pick<Shipment, "id">,
  tracking: string,
  opts: { mode?: "paypal" | "manual" } = {}
): Promise<Partial<Shipment>> {
  const value = tracking.trim();
  const patch: Partial<Shipment> = {
    tracking_code: value || null,
    status: value ? "shipped" : "draft",
    ...(opts.mode ? { mode: opts.mode } : {}),
  };
  const { error } = await supabase
    .from("shipments")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", shipment.id);
  if (error) throw new Error(`Save failed: ${error.message}`);
  return patch;
}

// Mirror a parcel's tracking number onto its member records, so the
// catalog's read-only tracking column stays accurate. "" clears it.
export async function mirrorTracking(
  supabase: SupabaseClient,
  recordIds: number[],
  value: string
): Promise<void> {
  if (recordIds.length === 0) return;
  const { error } = await supabase
    .from("records")
    .update({ tracking_number: value, updated_at: new Date().toISOString() })
    .in("id", recordIds);
  if (error) throw new Error(`Saving tracking on records failed: ${error.message}`);
}
