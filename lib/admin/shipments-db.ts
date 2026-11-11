import type { SupabaseClient } from "@supabase/supabase-js";
import type { Shipment, ShipTo } from "../supabase.ts";
import { HAND_CARRIER, HAND_MODE } from "./fulfillment.ts";

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

// Hand an order over in person: every loose record goes into a new box
// and every box still waiting on a label is marked handed over, all
// stamped `at` (sent_at, so the order reads as gone everywhere a drop-off
// would). Returns the new box, if one was made, and the patch written to
// the existing ones so the caller can mirror both locally.
export const handOverPatch = (at: string): Partial<Shipment> => ({
  mode: HAND_MODE,
  carrier: HAND_CARRIER,
  status: "shipped",
  sent_at: at,
});

export async function handOverOrder(
  supabase: SupabaseClient,
  o: {
    buyer: string;
    orderId: number | null;
    invoiceId: string | null;
    looseIds: number[];
    boxIds: number[];
    toAddress?: ShipTo | null;
  },
  at: string = new Date().toISOString()
): Promise<{ created: Shipment | null; patch: Partial<Shipment> }> {
  const patch = handOverPatch(at);
  if (o.boxIds.length > 0) {
    const { error } = await supabase
      .from("shipments")
      .update({ ...patch, updated_at: at })
      .in("id", o.boxIds);
    if (error) throw new Error(`Couldn't mark the boxes handed over: ${error.message}`);
  }
  let created: Shipment | null = null;
  if (o.looseIds.length > 0) {
    const { data, error } = await supabase
      .from("shipments")
      .insert({
        buyer_username: o.buyer,
        order_id: o.orderId,
        record_ids: o.looseIds,
        paypal_invoice_id: o.invoiceId,
        packed_at: at,
        ...(o.toAddress ? { to_address: o.toAddress } : {}),
        ...patch,
      })
      .select()
      .single();
    if (error) throw new Error(`Couldn't record the hand-over: ${error.message}`);
    created = data as Shipment;
  }
  return { created, patch };
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
