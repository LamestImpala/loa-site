import type { DbRecord, Shipment } from "../supabase.ts";

// Fulfillment rules: how sold records and parcels group per buyer, what
// PayPal already knows about a parcel, and the r/VinylCollectors trade
// confirmation texts. Pure — no React, no Supabase.

// A parcel already known to PayPal, under its current tracking number.
export const inPayPal = (s: Shipment) =>
  !!s.paypal_tracker_id &&
  !!s.tracking_code &&
  s.paypal_tracked_number === s.tracking_code;

// Pushed once, but the tracking number changed since.
export const needsRepush = (s: Shipment) =>
  !!s.paypal_tracker_id &&
  !!s.tracking_code &&
  s.paypal_tracked_number !== s.tracking_code;

// Marked as a label bought inside PayPal that the tracking API can't see
// (PayPal Shipping labels never register as trackers): the tracking is
// already on the transaction, so pushing would only duplicate the buyer
// email. Parcels PayPal does know about keep their re-push behavior.
export const pushNotNeeded = (s: Shipment) =>
  s.mode === "paypal" && !s.paypal_tracker_id;

// r/VinylCollectors trade confirmations: u/VinylSwapBot only reads plain-text
// u/ mentions (hyperlinked tags are invisible to it) and only counts NEW
// top-level comments on the thread the sale came from — edits don't register.
// Credit lands once the buyer replies to the comment.
export const SWAP_BOT = "u/VinylSwapBot";

export function confirmationComment(buyer: string, records: DbRecord[]) {
  const list = [...records].sort((a, b) =>
    `${a.artist} ${a.title}`.localeCompare(`${b.artist} ${b.title}`)
  );
  return [
    SWAP_BOT,
    "",
    `Confirming my sale to u/${buyer}:`,
    "",
    ...list.map((r) => `- ${r.artist} — ${r.title}`),
    "",
    `Thanks for a smooth transaction, u/${buyer}! Please reply to this comment to confirm so the bot credits us both.`,
  ].join("\n");
}

export function buyerNudge(buyer: string, threadUrl: string) {
  const where = threadUrl
    ? `here: ${threadUrl}`
    : "on the r/VinylCollectors post the sale came from";
  return [
    `Hey u/${buyer} — thanks again for the order! I posted our trade confirmation ${where}`,
    "",
    `When you get a minute, could you reply to my comment there (a quick "Confirmed" is perfect)? That way ${SWAP_BOT} counts the trade for both of us. Cheers!`,
  ].join("\n");
}

export type OrderGroup = {
  key: string;
  buyer: string;
  records: DbRecord[];
  shipments: Shipment[];
  invoiceId: string; // unique invoice id among member records, if any
  unassigned: DbRecord[];
  done: boolean;
  lastActivity: number; // most recent shipment update (ms) — drives archiving
};

// One group per buyer (case-insensitive), from sold records and their
// non-refunded parcels. Open orders first, then alphabetical by buyer.
export function groupOrdersByBuyer(
  records: DbRecord[],
  shipments: Shipment[]
): OrderGroup[] {
  const map = new Map<string, OrderGroup>();
  const groupOf = (buyer: string) => {
    const key = buyer.trim().toLowerCase() || "(no buyer)";
    let g = map.get(key);
    if (!g) {
      g = {
        key,
        buyer: buyer.trim(),
        records: [],
        shipments: [],
        invoiceId: "",
        unassigned: [],
        done: false,
        lastActivity: 0,
      };
      map.set(key, g);
    }
    return g;
  };
  for (const r of records) groupOf(r.buyer_username ?? "").records.push(r);
  for (const s of shipments) {
    if (s.status === "refunded") continue;
    groupOf(s.buyer_username ?? "").shipments.push(s);
  }
  for (const g of map.values()) {
    const invoices = [
      ...new Set(
        g.records.map((r) => r.paypal_invoice_id).filter(Boolean) as string[]
      ),
    ];
    g.invoiceId = invoices.length === 1 ? invoices[0] : "";
    const assigned = new Set(g.shipments.flatMap((s) => s.record_ids ?? []));
    g.unassigned = g.records.filter((r) => !assigned.has(r.id));
    g.done =
      g.records.length > 0 &&
      g.unassigned.length === 0 &&
      g.shipments.every((s) => !!s.tracking_code);
    g.lastActivity = g.shipments.reduce(
      (max, s) =>
        Math.max(max, new Date(s.updated_at ?? s.created_at).getTime()),
      0
    );
  }
  return [...map.values()].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    return a.buyer.localeCompare(b.buyer);
  });
}
