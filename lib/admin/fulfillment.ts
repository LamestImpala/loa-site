import type { DbRecord, Invoice, Order, OrderRequest, Shipment } from "../supabase.ts";
import { kindOf } from "../items.ts";

// Fulfillment rules: how sold records and boxes (shipments rows — "parcel"
// in the older code) group per order, where an order stands from request
// to drop-off, what PayPal already knows about a box, and the
// r/VinylCollectors trade confirmation texts. Pure — no React, no Supabase.

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

// Handed to the buyer in person (local pickup, cash or otherwise): no
// label, no tracking, nothing for PayPal. sent_at is when it changed
// hands, so the box counts as gone everywhere a drop-off would.
export const HAND_MODE = "hand";
export const HAND_CARRIER = "In person";
export const handDelivered = (s: { mode?: string | null }) => s.mode === HAND_MODE;

// A box still waiting on its label: no tracking yet and not handed over.
export const needsLabel = (s: Pick<Shipment, "mode" | "tracking_code">) =>
  !s.tracking_code && !handDelivered(s);

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
  order: Order | null; // null for sold records that predate the orders table
  buyer: string;
  buyerEmail: string | null; // an email buyer's address, from the order
  records: DbRecord[];
  shipments: Shipment[];
  invoiceId: string; // the order's invoice, else the one id shared by member records
  unassigned: DbRecord[];
  done: boolean;
  lastActivity: number; // most recent shipment update (ms) — drives archiving
};

// One group per order, from sold records and their non-refunded parcels.
// A refunded order is over — it has no group, so it drops out of the
// panel, the pick and pack lists and the worklist alike (any records it
// keeps sold went out in a parcel that isn't coming back). Records and
// parcels without an order fall back to grouping by buyer name
// (case-insensitive), the pre-orders rule. Open orders first, then
// alphabetical by buyer.
export function groupOrders(
  records: DbRecord[],
  shipments: Shipment[],
  orders: Order[]
): OrderGroup[] {
  const orderById = new Map(orders.map((o) => [o.id, o]));
  const map = new Map<string, OrderGroup>();
  const groupFor = (orderId: number | null | undefined, buyer: string) => {
    const order = orderId != null ? (orderById.get(orderId) ?? null) : null;
    const key = order
      ? `order-${order.id}`
      : `buyer-${buyer.trim().toLowerCase() || "(no buyer)"}`;
    let g = map.get(key);
    if (!g) {
      g = {
        key,
        order,
        buyer: (order?.buyer_username ?? buyer).trim(),
        buyerEmail: order?.buyer_email ?? null,
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
  const refunded = (orderId: number | null | undefined) =>
    orderId != null && orderById.get(orderId)?.status === "refunded";
  for (const r of records) {
    if (refunded(r.order_id)) continue;
    groupFor(r.order_id, r.buyer_username ?? "").records.push(r);
  }
  for (const s of shipments) {
    if (s.status === "refunded" || refunded(s.order_id)) continue;
    groupFor(s.order_id, s.buyer_username ?? "").shipments.push(s);
  }
  for (const g of map.values()) {
    const invoices = [
      ...new Set(
        g.records.map((r) => r.paypal_invoice_id).filter(Boolean) as string[]
      ),
    ];
    g.invoiceId =
      g.order?.paypal_invoice_id ?? (invoices.length === 1 ? invoices[0] : "");
    const assigned = new Set(g.shipments.flatMap((s) => s.record_ids ?? []));
    g.unassigned = g.records.filter((r) => !assigned.has(r.id));
    g.done =
      g.records.length > 0 &&
      g.unassigned.length === 0 &&
      !g.shipments.some(needsLabel);
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

// Where an order stands, as the one job still open on it — what the
// fulfillment card names in its pill and offers as its main button:
//   pack   records not in a box yet            → the pack page
//   label  a box with no tracking number       → the labels page
//          (a box handed over in person needs none)
//   push   tracking PayPal hasn't been told    → Push to PayPal
//   sync   invoice with no PayPal fee recorded → Sync from PayPal
//   done   nothing left but the trade confirmation
export type OrderStage = "pack" | "label" | "push" | "sync" | "done";

export const pushable = (s: Shipment) =>
  !!s.tracking_code && !!s.paypal_invoice_id && !inPayPal(s) && !pushNotNeeded(s);

export function orderStage(
  g: Pick<OrderGroup, "unassigned" | "shipments" | "invoiceId">,
  invoice: Pick<Invoice, "paypal_fee"> | null | undefined
): OrderStage {
  if (g.unassigned.length > 0) return "pack";
  if (g.shipments.some(needsLabel)) return "label";
  if (g.shipments.some(pushable)) return "push";
  if (g.invoiceId && invoice?.paypal_fee == null) return "sync";
  return "done";
}

// Every record boxed and every box out of the house — dropped off with
// the carrier or handed over in person. A label isn't a drop-off: a
// tracked box can sit on the table for days.
export function orderGone(
  g: Pick<OrderGroup, "records" | "unassigned" | "shipments">
): boolean {
  return (
    g.records.length > 0 &&
    g.unassigned.length === 0 &&
    g.shipments.length > 0 &&
    g.shipments.every((s) => !!s.sent_at)
  );
}

// The one job an order card offers as its bright button, in the order a
// sale moves: the stage jobs up to the label, then the drop-off, the fee
// sync, and last the after-sale checklist ("finish"). "none" = closed.
export type OrderJob = "pack" | "label" | "push" | "dropoff" | "sync" | "finish" | "none";

export function nextJob(
  g: Pick<OrderGroup, "order" | "records" | "unassigned" | "shipments" | "invoiceId">,
  invoice: Pick<Invoice, "paypal_fee"> | null | undefined
): OrderJob {
  const stage = orderStage(g, invoice);
  if (stage === "pack" || stage === "label" || stage === "push") return stage;
  if (!orderGone(g)) return "dropoff";
  if (stage === "sync") return "sync";
  return g.order?.completed_at === null ? "finish" : "none";
}

// A shipped order stays on the Orders page this long after its last box
// update, then moves to the archive. Keyed to the boxes (not the sale
// date) so an order still in transit never archives early — the window
// covers delivery plus an it-arrived-damaged grace period.
export const ARCHIVE_AFTER_DAYS = 21;

// Which list an order card belongs in on the Orders page:
//   ship      something is still in the house (loose, unlabeled, or not
//             dropped off)
//   after     everything has left; the after-sale checklist is open until
//             the seller marks the order done
//   done      marked done — or can't be marked: sales that predate the
//             orders table, and every order until the completed_at
//             migration is applied (the column reads as undefined)
//   archived  left more than ARCHIVE_AFTER_DAYS ago, marked or not, so
//             orders from before "Mark done" existed never pile up
export type OrderPhase = "ship" | "after" | "done" | "archived";

export function orderPhase(
  g: Pick<OrderGroup, "order" | "records" | "unassigned" | "shipments" | "lastActivity">,
  now: number = Date.now()
): OrderPhase {
  if (!orderGone(g)) return "ship";
  if (g.lastActivity < now - ARCHIVE_AFTER_DAYS * 24 * 3600 * 1000) return "archived";
  return g.order?.completed_at === null ? "after" : "done";
}

// An order's whole life as a row of steps, for its card: request →
// invoice → paid → pulled → packed → labeled → dropped off. Steps that
// never applied to this sale are left out (no request for a DM sale, no
// invoice for cash, no label when it was handed over). The first step
// not yet done is "current"; `at` is when a step happened, where the
// tables recorded it (a label has no timestamp of its own).
export type TimelineStep = {
  key: "request" | "invoice" | "paid" | "pulled" | "packed" | "labeled" | "sent";
  label: string;
  state: "done" | "current" | "todo";
  at: string | null;
  detail?: string; // "2 of 3" while a step is part-way
};

const latest = (times: (string | null | undefined)[]): string | null => {
  const known = times.filter((t): t is string => !!t);
  return known.length ? known.reduce((a, b) => (a > b ? a : b)) : null;
};
const earliest = (times: (string | null | undefined)[]): string | null => {
  const known = times.filter((t): t is string => !!t);
  return known.length ? known.reduce((a, b) => (a < b ? a : b)) : null;
};

export function orderTimeline(
  g: Pick<OrderGroup, "order" | "records" | "unassigned" | "shipments" | "invoiceId">,
  ctx: {
    invoice?: Pick<Invoice, "created_at" | "paid_at"> | null;
    request?: Pick<OrderRequest, "created_at"> | null;
  } = {}
): TimelineStep[] {
  const { invoice, request } = ctx;
  const total = g.records.length;
  const boxes = g.shipments;
  const boxedIds = new Set(boxes.flatMap((s) => s.record_ids ?? []));
  type Draft = Omit<TimelineStep, "state"> & { done: boolean };
  const steps: Draft[] = [];
  const add = (step: Draft) => steps.push(step);

  if (g.order?.request_id != null || request) {
    add({ key: "request", label: "Requested", done: true, at: request?.created_at ?? null });
  }
  if (g.invoiceId || invoice) {
    add({ key: "invoice", label: "Invoiced", done: true, at: invoice?.created_at ?? null });
  }
  // The card only exists for sold records, so the sale is paid — by the
  // invoice when there is one, else when the records were marked sold.
  add({
    key: "paid",
    label: "Paid",
    done: total > 0,
    at: invoice?.paid_at ?? earliest(g.records.map((r) => r.sold_at)),
  });

  // A record in a box came off the shelf, whether or not it was ticked.
  const pulled = g.records.filter((r) => !!r.picked_at || boxedIds.has(r.id));
  add({
    key: "pulled",
    label: "Pulled",
    done: total > 0 && pulled.length === total,
    at: latest(g.records.map((r) => r.picked_at)),
    detail: pulled.length > 0 && pulled.length < total ? `${pulled.length} of ${total}` : undefined,
  });

  const boxed = total - g.unassigned.length;
  const packed = total > 0 && g.unassigned.length === 0 && boxes.length > 0;
  add({
    key: "packed",
    label: "Packed",
    done: packed,
    at: packed ? latest(boxes.map((s) => s.packed_at ?? s.created_at)) : null,
    detail: boxed > 0 && !packed ? `${boxed} of ${total}` : undefined,
  });

  const mailed = boxes.filter((s) => !handDelivered(s));
  const inPerson = packed && mailed.length === 0;
  if (!inPerson) {
    const labeled = mailed.filter((s) => !!s.tracking_code).length;
    add({
      key: "labeled",
      label: "Labeled",
      done: packed && labeled === mailed.length,
      at: null,
      detail:
        labeled > 0 && labeled < mailed.length ? `${labeled} of ${mailed.length} boxes` : undefined,
    });
  }

  const sent = boxes.filter((s) => !!s.sent_at).length;
  const gone = orderGone(g);
  add({
    key: "sent",
    label: inPerson ? "Handed over" : "Dropped off",
    done: gone,
    at: gone ? latest(boxes.map((s) => s.sent_at)) : null,
    detail: sent > 0 && !gone ? `${sent} of ${boxes.length} boxes` : undefined,
  });

  let currentSet = false;
  return steps.map(({ done, ...step }) => {
    const state: TimelineStep["state"] = done ? "done" : currentSet ? "todo" : "current";
    if (!done) currentSet = true;
    return { ...step, state };
  });
}

// When the order started waiting on the seller: the order row's date, or
// for sales that predate the orders table the earliest sold date.
export function waitingSince(g: Pick<OrderGroup, "order" | "records">): number {
  if (g.order) return new Date(g.order.created_at).getTime();
  const times = g.records
    .map((r) => new Date(r.sold_at ?? r.updated_at).getTime())
    .filter((t) => Number.isFinite(t));
  return times.length ? Math.min(...times) : 0;
}

// The fulfillment panel's order: open orders longest-waiting first, then
// finished ones most recently shipped first.
export function byLongestWaiting(groups: OrderGroup[]): OrderGroup[] {
  return [...groups].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    return a.done
      ? b.lastActivity - a.lastActivity
      : waitingSince(a) - waitingSince(b) || a.key.localeCompare(b.key);
  });
}

// Orders PayPal refunded in full, newest refund first, with the records
// that stayed sold on them (already shipped when the money went back).
// The panel lists them read-only so a refunded sale isn't invisible.
export type RefundedOrder = { order: Order; records: DbRecord[] };

export function refundedOrders(orders: Order[], records: DbRecord[]): RefundedOrder[] {
  return orders
    .filter((o) => o.status === "refunded")
    .map((order) => ({
      order,
      records: records.filter((r) => r.sold && r.order_id === order.id),
    }))
    .sort((a, b) =>
      (b.order.refunded_at ?? b.order.updated_at).localeCompare(
        a.order.refunded_at ?? a.order.updated_at
      )
    );
}

// Sold records ready to come out of the owner's Discogs collection. The
// Discogs delete can't be undone, so it waits until the sale can't come
// back: every record of the order boxed and every box tracked or handed
// over in person. Before that a refund would put the record back on the
// shelf with its collection entry already gone. Records a refunded order
// kept sold had shipped, so they count too.
export function discogsReady(
  records: DbRecord[],
  shipments: Shipment[],
  orders: Order[]
): DbRecord[] {
  const onDiscogs = (r: DbRecord) =>
    kindOf(r) === "record" && r.sold && !!r.discogs_release_id && !r.discogs_removed;
  const refunded = new Set(
    orders.filter((o) => o.status === "refunded").map((o) => o.id)
  );
  const ready = new Set<number>();
  for (const g of groupOrders(records.filter((r) => r.sold), shipments, orders)) {
    if (g.done) for (const r of g.records) ready.add(r.id);
  }
  return records.filter(
    (r) =>
      onDiscogs(r) &&
      (ready.has(r.id) || (r.order_id != null && refunded.has(r.order_id)))
  );
}
