import type { SupabaseClient } from "@supabase/supabase-js";
import type { Order, Shipment } from "./supabase.ts";
import { ADMIN_EMAIL } from "./supabase.ts";
import { saleGroups, saleShipping } from "./admin/combined.ts";
import { boxesToTrack, cleanTrackingNumber, deliveredDay, shippoCarrier, trackingUpdate, type TrackLookup } from "./delivery.ts";
import { ADMIN_REVIEWS_URL, boughtPhrase } from "./review.ts";
import { escapeHtml } from "./order-request.ts";

// The /api/delivery-check sweep: ask the carrier (through Shippo) about
// every recently dropped-off box that hasn't been delivered, and write
// what it says onto the shipments row. When that finishes a sale with no
// buyer email (a Reddit buyer), the admin is emailed: the review ask is
// theirs to send, and now is the time. Email buyers need nothing — the
// daily review job emails them a few days after delivery.

type TrackedBox = Pick<
  Shipment,
  "id" | "order_id" | "sent_at" | "tracking_code" | "carrier" | "mode" | "delivered_at"
>;

export type DeliverySweep = {
  checked: number;
  delivered: { shipmentId: number; orderId: number | null; at: string; detail: string | null }[];
  moving: { shipmentId: number; status: string }[];
  failed: { shipmentId: number; error: string }[];
  notified: number[]; // sale (first order) ids the admin was emailed about
};

export type Notify = (msg: { to: string; subject: string; text: string; html: string }) => Promise<{
  ok: boolean;
  error?: string;
}>;

export async function sweepDeliveries(
  supabase: SupabaseClient,
  lookup: TrackLookup,
  opts: { dry?: boolean; notify?: Notify; now?: Date } = {}
): Promise<DeliverySweep> {
  const now = opts.now ?? new Date();
  const out: DeliverySweep = { checked: 0, delivered: [], moving: [], failed: [], notified: [] };

  const since = new Date(now.getTime() - 31 * 86_400_000).toISOString();
  const { data, error } = await supabase
    .from("shipments")
    .select("id, order_id, sent_at, tracking_code, carrier, mode, delivered_at")
    .is("delivered_at", null)
    .gte("sent_at", since)
    .order("sent_at", { ascending: true })
    .limit(60);
  if (error) throw new Error(error.message);
  const boxes = boxesToTrack((data ?? []) as TrackedBox[], now);

  const newlyDelivered = new Set<number>(); // order ids
  for (const b of boxes) {
    out.checked++;
    try {
      const r = await lookup(shippoCarrier(b.carrier)!, cleanTrackingNumber(b.tracking_code));
      if (r.deliveredAt) {
        out.delivered.push({ shipmentId: b.id, orderId: b.order_id, at: r.deliveredAt, detail: r.detail });
        if (b.order_id != null) newlyDelivered.add(b.order_id);
      } else {
        out.moving.push({ shipmentId: b.id, status: r.status });
      }
      if (opts.dry) continue;
      const { error: upError } = await supabase
        .from("shipments")
        .update(trackingUpdate(r, now))
        .eq("id", b.id);
      if (upError) throw new Error(upError.message);
    } catch (e) {
      out.failed.push({ shipmentId: b.id, error: e instanceof Error ? e.message : "lookup failed" });
    }
  }

  if (newlyDelivered.size > 0 && opts.notify && !opts.dry) {
    out.notified = await notifyArrivals(supabase, newlyDelivered, out.delivered, opts.notify);
  }
  return out;
}

// Email the admin about each sale this run finished delivering whose
// review ask is manual: no buyer email, no review link made yet.
async function notifyArrivals(
  supabase: SupabaseClient,
  orderIds: Set<number>,
  delivered: DeliverySweep["delivered"],
  notify: Notify
): Promise<number[]> {
  const { data: orders, error } = await supabase
    .from("orders")
    .select("id, status, buyer_email, buyer_username, combined_into")
    .in("status", ["paid", "refunded"]);
  if (error || !orders) return [];
  const typed = orders as Pick<Order, "id" | "status" | "buyer_email" | "buyer_username" | "combined_into">[];
  const groups = [...saleGroups(typed)].filter(([, members]) =>
    members.some((o) => orderIds.has(o.id))
  );
  if (groups.length === 0) return [];
  const ids = groups.flatMap(([, members]) => members.map((o) => o.id));
  const [{ data: shipments }, { data: invites }, { data: records }] = await Promise.all([
    supabase.from("shipments").select("order_id, sent_at, mode, delivered_at").in("order_id", ids),
    supabase.from("review_invites").select("order_id").in("order_id", ids),
    supabase.from("records").select("artist, title, order_id").in("order_id", ids),
  ]);
  const shipping = saleShipping(typed, (shipments ?? []) as Pick<Shipment, "order_id" | "sent_at">[]);
  const invited = new Set((invites ?? []).map((i) => i.order_id as number));

  const sent: number[] = [];
  for (const [root, members] of groups) {
    const sale = shipping.get(root);
    if (!sale?.lastArrived) continue; // another box is still on its way
    if (members.some((o) => o.status === "paid" && o.buyer_email?.trim())) continue;
    if (members.some((o) => invited.has(o.id))) continue;
    const detail =
      delivered.find((d) => d.detail && members.some((o) => o.id === d.orderId))?.detail ?? null;
    const buyer = members[0].buyer_username?.trim() || "The buyer";
    const handle = /^u\//i.test(buyer) || !/^[\w-]+$/.test(buyer) ? buyer : `u/${buyer}`;
    const bought = boughtPhrase(
      (records ?? []).filter((r) => members.some((o) => o.id === r.order_id)) as {
        artist: string;
        title: string;
      }[]
    );
    const when = deliveredDay(sale.lastArrived);
    const subject = `Delivered: ${handle}'s box — time for the review DM`;
    const lines = [
      `${handle}'s box (${bought}) was delivered ${when}${detail ? ` — ${detail}` : ""}.`,
      "",
      "They have no email on file, so the review ask is yours. Copy a review DM from Reviews:",
      ADMIN_REVIEWS_URL,
    ];
    const html = `<p><strong>${escapeHtml(handle)}</strong>'s box (${escapeHtml(bought)}) was delivered ${escapeHtml(when)}${detail ? ` — ${escapeHtml(detail)}` : ""}.</p><p>They have no email on file, so the review ask is yours. <a href="${ADMIN_REVIEWS_URL}">Copy a review DM from Reviews</a>.</p>`;
    const r = await notify({ to: ADMIN_EMAIL, subject, text: lines.join("\n"), html });
    if (r.ok) sent.push(root);
  }
  return sent;
}
