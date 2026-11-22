import type { Order, ReviewInvite, Shipment } from "../supabase.ts";
import { isRedditHandle } from "./buyers.ts";
import { handDelivered } from "./fulfillment.ts";

// Combined orders. A buyer who pays on two invoices makes two orders;
// "Combine" ties them into one sale by pointing the later order's
// combined_into at the first. Each order keeps its own invoice, boxes
// and money — only review requests and reviews count the sale as one.
// Pure — no React, no Supabase. The writes are in orders-db.ts.

type Linked = Pick<Order, "id" | "combined_into">;

// The orders.combined_into column exists (it reads as undefined until its
// migration is applied) — the admin leaves "Combine" out rather than
// offer a write that fails.
export const combineSupported = (order: Order | null | undefined) =>
  !!order && order.combined_into !== undefined;

// Each order's sale: the id of the order it was combined into, or its own.
// Members always point straight at the first order; the walk is only so a
// stray chain still lands in one sale.
function saleRoots<T extends Linked>(orders: T[]): Map<number, number> {
  const byId = new Map(orders.map((o) => [o.id, o]));
  const roots = new Map<number, number>();
  for (const o of orders) {
    let id = o.id;
    let up = o.combined_into ?? null;
    for (let hops = 0; up != null && hops < 8; hops++) {
      id = up;
      up = byId.get(up)?.combined_into ?? null;
    }
    roots.set(o.id, id);
  }
  return roots;
}

// Orders grouped by sale, keyed by the first order's id: that order first,
// then the ones combined into it, oldest first.
export function saleGroups<T extends Linked>(orders: T[]): Map<number, T[]> {
  const roots = saleRoots(orders);
  const groups = new Map<number, T[]>();
  for (const o of orders) {
    const root = roots.get(o.id)!;
    const list = groups.get(root) ?? [];
    list.push(o);
    groups.set(root, list);
  }
  for (const [root, list] of groups) {
    list.sort((a, b) => (a.id === root ? -1 : b.id === root ? 1 : a.id - b.id));
  }
  return groups;
}

export type SaleShipping = {
  lastSent: string | null; // when the sale's last box went out
  unsent: boolean; // a box is still at home (or a paid order has no box yet)
  mailed: boolean; // at least one box was mailed, not handed over
};

// Where a sale's boxes stand, over its paid orders (a refunded order's
// boxes don't hold the sale up). Keyed like saleGroups.
export function saleShipping(
  orders: (Linked & Pick<Order, "status">)[],
  shipments: (Pick<Shipment, "order_id" | "sent_at"> & { mode?: string | null })[]
): Map<number, SaleShipping> {
  const byOrder = new Map<number, typeof shipments>();
  for (const s of shipments) {
    if (s.order_id == null) continue;
    const list = byOrder.get(s.order_id) ?? [];
    list.push(s);
    byOrder.set(s.order_id, list);
  }
  const out = new Map<number, SaleShipping>();
  for (const [root, members] of saleGroups(orders)) {
    const sale: SaleShipping = { lastSent: null, unsent: false, mailed: false };
    for (const o of members) {
      if (o.status !== "paid") continue;
      const boxes = byOrder.get(o.id) ?? [];
      if (boxes.length === 0) sale.unsent = true;
      for (const s of boxes) {
        if (!handDelivered(s)) sale.mailed = true;
        if (!s.sent_at) sale.unsent = true;
        else if (!sale.lastSent || Date.parse(s.sent_at) > Date.parse(sale.lastSent)) {
          sale.lastSent = s.sent_at;
        }
      }
    }
    out.set(root, sale);
  }
  return out;
}

// The sale's review link, when its orders hold more than one: the one the
// buyer used, else one that was emailed, else the oldest.
export function saleInvite<
  T extends Pick<ReviewInvite, "order_id"> &
    Partial<Pick<ReviewInvite, "sent_at" | "used_at" | "created_at">>,
>(invites: T[], orderIds: number[]): T | null {
  const ids = new Set(orderIds);
  const rank = (i: T) => (i.used_at ? 0 : i.sent_at ? 1 : 2);
  let best: T | null = null;
  for (const i of invites) {
    if (!ids.has(i.order_id)) continue;
    if (
      !best ||
      rank(i) < rank(best) ||
      (rank(i) === rank(best) && (i.created_at ?? "") < (best.created_at ?? ""))
    ) {
      best = i;
    }
  }
  return best;
}

// What an order card needs to show the review step of a combined sale:
// null when the order stands alone (its own boxes and link then decide).
export type SaleReviewContext = {
  orderIds: number[]; // every order in the sale
  lastSent: string | null; // when the sale's last box went out
  unsent: boolean; // one of the sale's boxes is still at home
  email: boolean; // one of its paid orders has an email on file
};

export function saleReviewContext(
  order: Order,
  orders: Order[],
  shipments: (Pick<Shipment, "order_id" | "sent_at"> & { mode?: string | null })[]
): SaleReviewContext | null {
  const mates = saleMates(order, orders);
  if (mates.length === 0) return null;
  const members = [order, ...mates];
  const sale = [...saleShipping(members, shipments).values()][0];
  return {
    orderIds: members.map((o) => o.id),
    lastSent: sale?.lastSent ?? null,
    unsent: sale?.unsent ?? false,
    email: members.some((o) => o.status === "paid" && !!o.buyer_email),
  };
}

export type CombinePlan =
  | { ok: true; rootId: number; ids: number[] } // set combined_into = rootId on ids
  | { ok: false; error: string };

// Combine the sales of two orders. The lower-numbered sale stays first,
// whichever order was clicked, and every order of the other sale is
// pointed straight at it — so chains are never stored.
export function combinePlan(orders: Order[], aId: number, bId: number): CombinePlan {
  const a = orders.find((o) => o.id === aId);
  const b = orders.find((o) => o.id === bId);
  if (!a || !b) return { ok: false, error: "Order not found — refresh and try again" };
  if (a.id === b.id) return { ok: false, error: "Pick a different order to combine with" };
  if (a.status !== "paid" || b.status !== "paid") {
    return { ok: false, error: "Only paid orders can be combined" };
  }
  const roots = saleRoots(orders);
  const ra = roots.get(a.id)!;
  const rb = roots.get(b.id)!;
  if (ra === rb) return { ok: false, error: "Those orders are already one sale" };
  const rootId = Math.min(ra, rb);
  const other = Math.max(ra, rb);
  const ids = orders.filter((o) => roots.get(o.id) === other).map((o) => o.id);
  return { ok: true, rootId, ids };
}

// The orders to clear combined_into on: just this one when it was
// combined into another, or everything combined into it when it's the
// sale's first order. Empty when the order isn't combined.
export function splitPlan(orders: Order[], orderId: number): number[] {
  const order = orders.find((o) => o.id === orderId);
  if (!order) return [];
  if (order.combined_into != null) return [order.id];
  return orders.filter((o) => o.combined_into === order.id).map((o) => o.id);
}

// The other orders in this order's sale (empty when it stands alone).
export function saleMates<T extends Linked>(order: Linked, orders: T[]): T[] {
  const roots = saleRoots(orders);
  const root = roots.get(order.id) ?? order.combined_into ?? order.id;
  return orders.filter((o) => o.id !== order.id && roots.get(o.id) === root);
}

const SAME_BUYER_WINDOW_DAYS = 14;
const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

// Looks like one buyer paying twice: the two orders were placed within
// two weeks of each other and share an email, a shipping address, or
// (Reddit buyers, who have no email) a handle. Only a hint — any two paid
// orders can be combined.
export function sameBuyer(
  a: Pick<Order, "buyer_username" | "buyer_email" | "ship_to" | "created_at">,
  b: Pick<Order, "buyer_username" | "buyer_email" | "ship_to" | "created_at">
): boolean {
  const apart = Math.abs(Date.parse(a.created_at) - Date.parse(b.created_at));
  if (!(apart <= SAME_BUYER_WINDOW_DAYS * 86_400_000)) return false;
  const emailA = norm(a.buyer_email);
  if (emailA && emailA === norm(b.buyer_email)) return true;
  const address = (o: typeof a) => {
    const parts = [o.ship_to?.name, o.ship_to?.line1, o.ship_to?.postal_code].map(norm);
    return parts.every(Boolean) ? parts.join("|") : "";
  };
  const addressA = address(a);
  if (addressA && addressA === address(b)) return true;
  const handleA = norm(a.buyer_username);
  return (
    !emailA &&
    !norm(b.buyer_email) &&
    isRedditHandle(handleA) &&
    handleA === norm(b.buyer_username)
  );
}

export type CombineCandidate = {
  order: Order; // the other sale's first paid order
  ids: number[]; // every order in that sale
  same: boolean; // looks like the same buyer
};

const MAX_OTHER_CANDIDATES = 20;

// The sales this order could be combined with: paid orders outside its
// own sale, one entry per sale. Likely same-buyer sales come first, then
// the most recent others.
export function combineCandidates(order: Order, orders: Order[]): CombineCandidate[] {
  const roots = saleRoots(orders);
  const mine = roots.get(order.id) ?? order.id;
  const mineOrders = orders.filter((o) => roots.get(o.id) === mine);
  const same: CombineCandidate[] = [];
  const rest: CombineCandidate[] = [];
  for (const [root, members] of saleGroups(orders)) {
    if (root === mine) continue;
    const paid = members.filter((o) => o.status === "paid");
    if (paid.length === 0) continue;
    const match = paid.some((o) => mineOrders.some((m) => sameBuyer(m, o)));
    (match ? same : rest).push({ order: paid[0], ids: members.map((o) => o.id), same: match });
  }
  const newest = (x: CombineCandidate, y: CombineCandidate) =>
    y.order.created_at.localeCompare(x.order.created_at);
  return [...same.sort(newest), ...rest.sort(newest).slice(0, MAX_OTHER_CANDIDATES)];
}

// "#27 + #29" — how a sale's orders are named on a row.
export const orderNumbers = (ids: number[]) => ids.map((id) => `#${id}`).join(" + ");
