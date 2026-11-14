import type { SupabaseClient } from "@supabase/supabase-js";
import type { DbRecord, Order } from "../supabase.ts";
import { photoPaths, type MissingPlan } from "./missing.ts";

// The writes behind "Can't find it" (rules in missing.ts). The order
// first: its removed_total is what keeps the sold total right once the
// record is gone, so nothing is deleted unless that landed. A failure
// after it puts the order's total back.
export async function removeMissing(
  supabase: SupabaseClient,
  r: DbRecord,
  order: Order,
  plan: MissingPlan
): Promise<Order> {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("orders")
    .update({ removed_total: plan.removedTotal, updated_at: now })
    .eq("id", order.id)
    .select()
    .single();
  if (error) throw new Error(`Couldn't update the order: ${error.message}`);

  const undo = () =>
    supabase
      .from("orders")
      .update({ removed_total: Number(order.removed_total ?? 0), updated_at: now })
      .eq("id", order.id);

  for (const p of plan.parcels) {
    const { error: parcelError } = p.remove
      ? await supabase.from("shipments").delete().eq("id", p.id)
      : await supabase
          .from("shipments")
          .update({ record_ids: p.record_ids, updated_at: now })
          .eq("id", p.id);
    if (parcelError) {
      await undo();
      throw new Error(`Couldn't take it out of box #${p.id}: ${parcelError.message}`);
    }
  }

  const { error: deleteError } = await supabase.from("records").delete().eq("id", r.id);
  if (deleteError) {
    await undo();
    throw new Error(`Couldn't delete the record: ${deleteError.message}`);
  }
  // Best-effort, after the row: orphaned photo files hurt nothing.
  const paths = photoPaths(r);
  if (paths.length > 0) await supabase.storage.from("record-photos").remove(paths);
  return data as Order;
}
