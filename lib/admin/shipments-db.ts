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

// Undo a hand-over marked by mistake: the order goes back on the packing
// table as it was. A box the hand-over made for the loose records (sealed
// and handed over in the same stamp) is deleted, so its records are loose
// again; a box that was already sealed goes back to waiting on a label —
// "paypal" like every box sealed on the pack page, "manual" for one made
// on the order card.
export type HandOverUndo = {
  deleteIds: number[];
  reverts: { id: number; patch: Partial<Shipment> }[];
};

export function handOverUndoPlan(
  boxes: Pick<Shipment, "id" | "mode" | "packed_at" | "sent_at">[]
): HandOverUndo {
  const plan: HandOverUndo = { deleteIds: [], reverts: [] };
  for (const s of boxes) {
    if (s.mode !== HAND_MODE) continue;
    const madeByHandOver =
      !!s.packed_at && !!s.sent_at && Date.parse(s.packed_at) === Date.parse(s.sent_at);
    if (madeByHandOver) plan.deleteIds.push(s.id);
    else
      plan.reverts.push({
        id: s.id,
        patch: {
          mode: s.packed_at ? "paypal" : "manual",
          carrier: "USPS",
          status: "draft",
          sent_at: null,
        },
      });
  }
  return plan;
}

export async function undoHandOver(
  supabase: SupabaseClient,
  boxes: Pick<Shipment, "id" | "mode" | "packed_at" | "sent_at">[],
  at: string = new Date().toISOString()
): Promise<HandOverUndo> {
  const plan = handOverUndoPlan(boxes);
  for (const { id, patch } of plan.reverts) {
    const { error } = await supabase
      .from("shipments")
      .update({ ...patch, updated_at: at })
      .eq("id", id);
    if (error) throw new Error(`Couldn't undo the hand-over: ${error.message}`);
  }
  if (plan.deleteIds.length > 0) {
    const { error } = await supabase.from("shipments").delete().in("id", plan.deleteIds);
    if (error) throw new Error(`Couldn't undo the hand-over: ${error.message}`);
  }
  return plan;
}

// The drop-off: stamp when labeled boxes left the house, and take the
// stamp back off for a box that stayed home after all. Neither touches
// updated_at — the archive clock runs from the label, as it always has.
export async function markDroppedOff(
  supabase: SupabaseClient,
  boxIds: number[],
  at: string = new Date().toISOString()
): Promise<string> {
  const { error } = await supabase.from("shipments").update({ sent_at: at }).in("id", boxIds);
  if (error) throw new Error(`Couldn't mark dropped off: ${error.message}`);
  return at;
}

export async function undoDropOff(supabase: SupabaseClient, boxIds: number[]): Promise<void> {
  const { error } = await supabase.from("shipments").update({ sent_at: null }).in("id", boxIds);
  if (error) throw new Error(`Couldn't undo the drop-off: ${error.message}`);
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
