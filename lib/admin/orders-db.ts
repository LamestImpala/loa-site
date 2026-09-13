import type { SupabaseClient } from "@supabase/supabase-js";
import type { DbRecord, Order, OrderRequest } from "../supabase.ts";
import {
  advanceStatus,
  fallbackBuyer,
  pickOrder,
  requestForOrder,
} from "./orders.ts";

// The order writes, shared by the admin provider (browser) and the PayPal
// routes (server). Both hold a Supabase client under the admin's own
// token, so RLS applies either way. The rules are in orders.ts.

export type OrderTarget = Pick<
  DbRecord,
  "id" | "order_id" | "hold_buyer" | "buyer_username"
>;

export type PlacedOrder = {
  order: Order;
  created: boolean;
  movedIds: number[]; // records that now point at the order (didn't before)
  cancelledIds: number[]; // held orders emptied by the move, now cancelled
};

// Put a sale's records in an order: continue the open one they share, or
// start a new one and move the records to it. A held order the records
// leave behind is cancelled once empty; an invoiced one keeps its live
// PayPal invoice and stays in the inbox until that's dealt with.
export async function placeOrder(
  supabase: SupabaseClient,
  targets: OrderTarget[],
  buyer: string,
  status: "held" | "invoiced" | "paid",
  opts: { requests?: OrderRequest[]; extra?: Partial<Order> } = {}
): Promise<PlacedOrder> {
  const name = buyer.trim().replace(/^u\//, "");
  const prevIds = [
    ...new Set(
      targets.map((r) => r.order_id).filter((id): id is number => id != null)
    ),
  ];
  let existing = new Map<number, Order>();
  if (prevIds.length > 0) {
    const { data, error } = await supabase
      .from("orders")
      .select("*")
      .in("id", prevIds);
    if (error) throw new Error(`Couldn't read orders: ${error.message}`);
    existing = new Map(((data ?? []) as Order[]).map((o) => [o.id, o]));
  }
  const now = new Date().toISOString();
  const request = opts.requests
    ? requestForOrder(
        targets.map((r) => r.id),
        opts.requests
      )
    : null;
  const reuse = pickOrder(targets, name, existing);
  let order: Order;
  let created = false;
  if (reuse) {
    const patch: Partial<Order> = {
      ...opts.extra,
      status: advanceStatus(reuse.status, status),
      updated_at: now,
    };
    if (name && name !== reuse.buyer_username) patch.buyer_username = name;
    if (request && reuse.request_id == null) patch.request_id = request.id;
    const { data, error } = await supabase
      .from("orders")
      .update(patch)
      .eq("id", reuse.id)
      .select()
      .single();
    if (error) throw new Error(`Couldn't update the order: ${error.message}`);
    order = data as Order;
  } else {
    const { data, error } = await supabase
      .from("orders")
      .insert({
        ...opts.extra,
        buyer_username: name || fallbackBuyer(targets),
        status,
        request_id: request?.id ?? null,
        updated_at: now,
      })
      .select()
      .single();
    if (error) throw new Error(`Couldn't create the order: ${error.message}`);
    order = data as Order;
    created = true;
  }

  const movedIds = targets
    .filter((r) => r.order_id !== order.id)
    .map((r) => r.id);
  if (movedIds.length > 0) {
    const { error } = await supabase
      .from("records")
      .update({ order_id: order.id, updated_at: now })
      .in("id", movedIds);
    if (error) {
      throw new Error(
        `Order saved, but linking its records failed: ${error.message}`
      );
    }
  }

  const cancelledIds: number[] = [];
  for (const id of prevIds) {
    const old = existing.get(id);
    if (id === order.id || !old || old.status !== "held") continue;
    const { count } = await supabase
      .from("records")
      .select("id", { count: "exact", head: true })
      .eq("order_id", id);
    if ((count ?? 0) > 0) continue;
    const { error } = await supabase
      .from("orders")
      .update({ status: "cancelled", updated_at: now })
      .eq("id", id);
    if (!error) cancelledIds.push(id);
  }
  return { order, created, movedIds, cancelledIds };
}

// Rename the buyer on an order and mirror it onto the records and parcels
// that carry the name: sold records' buyer_username, unsold members'
// hold_buyer, and every parcel.
export async function renameOrderBuyer(
  supabase: SupabaseClient,
  order: Order,
  buyer: string
): Promise<Order> {
  const name = buyer.trim().replace(/^u\//, "");
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("orders")
    .update({ buyer_username: name, updated_at: now })
    .eq("id", order.id)
    .select()
    .single();
  if (error) throw new Error(`Couldn't rename the buyer: ${error.message}`);
  const [sold, held, parcels] = await Promise.all([
    supabase
      .from("records")
      .update({ buyer_username: name, updated_at: now })
      .eq("order_id", order.id)
      .eq("sold", true),
    supabase
      .from("records")
      .update({ hold_buyer: name, updated_at: now })
      .eq("order_id", order.id)
      .eq("sold", false)
      .not("hold_buyer", "is", null),
    supabase
      .from("shipments")
      .update({ buyer_username: name, updated_at: now })
      .eq("order_id", order.id),
  ]);
  const failed = sold.error ?? held.error ?? parcels.error;
  if (failed) {
    throw new Error(
      `Renamed the order, but mirroring the name failed: ${failed.message}`
    );
  }
  return data as Order;
}

// End a held order: release its unsold records back to the shop and mark
// it cancelled. Returns the released record ids.
export async function releaseOrder(
  supabase: SupabaseClient,
  order: Order
): Promise<number[]> {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("records")
    .update({ hold_buyer: null, hold_until: null, order_id: null, updated_at: now })
    .eq("order_id", order.id)
    .eq("sold", false)
    .select("id");
  if (error) throw new Error(`Couldn't release the records: ${error.message}`);
  const { error: orderError } = await supabase
    .from("orders")
    .update({ status: "cancelled", updated_at: now })
    .eq("id", order.id);
  if (orderError) {
    throw new Error(`Records released, but the order stayed open: ${orderError.message}`);
  }
  return ((data ?? []) as { id: number }[]).map((r) => r.id);
}
