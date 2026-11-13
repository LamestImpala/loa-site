import type { Order, ReviewInvite, ShopReview } from "../supabase.ts";
import { kindOf } from "../items.ts";
import { INVITE_AFTER_DAYS, INVITE_UNTIL_DAYS } from "../review.ts";
import type { OrderGroup } from "./fulfillment.ts";

// What's left on an order once its boxes have gone: ask for a review,
// take the records out of the Discogs collection, and (Reddit buyers)
// post the trade confirmation. Shown as a checklist on the order card;
// "Mark done" closes the order whatever is still open. Pure — no React,
// no Supabase.

export type AfterSaleItem = {
  key: "review" | "discogs" | "reddit";
  label: string;
  // done      the tables show it happened
  // scheduled nothing to do: the daily job emails the review link itself
  // todo      the seller's move
  // manual    can't be seen from here (a Reddit comment) — the seller
  //           ticks it by marking the order done
  state: "done" | "scheduled" | "todo" | "manual";
  detail: string;
};

const DAY = 86_400_000;
const shortDate = (iso: string | number) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export function afterSaleChecklist(
  g: Pick<OrderGroup, "order" | "buyer" | "buyerEmail" | "records" | "shipments">,
  ctx: {
    invites: Pick<ReviewInvite, "order_id" | "sent_at" | "used_at" | "created_at">[];
    reviews: Pick<ShopReview, "order_id">[];
  },
  now: number = Date.now()
): AfterSaleItem[] {
  const items: AfterSaleItem[] = [];
  const finished = !!g.order?.completed_at;

  // Reviews hang off the order row, so pre-orders sales have none.
  if (g.order) items.push(reviewItem(g.order, g, ctx, now));

  const onDiscogs = g.records.filter(
    (r) => kindOf(r) === "record" && !!r.discogs_release_id
  );
  if (onDiscogs.length > 0) {
    const left = onDiscogs.filter((r) => !r.discogs_removed).length;
    items.push({
      key: "discogs",
      label: "Removed from Discogs",
      state: left === 0 ? "done" : "todo",
      detail:
        left === 0
          ? onDiscogs.length === 1
            ? "out of your collection"
            : `all ${onDiscogs.length} out of your collection`
          : `${left} still in your collection`,
    });
  }

  // The swap bot only counts a new comment on the sale thread, which the
  // admin can't see — so this one is the seller's word.
  if (!g.buyerEmail && g.buyer) {
    items.push({
      key: "reddit",
      label: "Trade confirmed on Reddit",
      state: finished ? "done" : "manual",
      detail: finished ? "marked done" : "copy the confirmation, post it on the sale thread",
    });
  }
  return items;
}

function reviewItem(
  order: Order,
  g: Pick<OrderGroup, "buyerEmail" | "shipments">,
  ctx: {
    invites: Pick<ReviewInvite, "order_id" | "sent_at" | "used_at" | "created_at">[];
    reviews: Pick<ShopReview, "order_id">[];
  },
  now: number
): AfterSaleItem {
  const base = { key: "review" as const, label: "Review asked" };
  if (ctx.reviews.some((r) => r.order_id === order.id)) {
    return { ...base, state: "done", detail: "review received" };
  }
  const invite = ctx.invites.find((i) => i.order_id === order.id);
  if (invite) {
    return {
      ...base,
      state: "done",
      detail: invite.used_at
        ? "review received"
        : invite.sent_at
          ? `emailed ${shortDate(invite.sent_at)}`
          : `link copied ${shortDate(invite.created_at)}`,
    };
  }
  // Email buyers get the link from the daily job, INVITE_AFTER_DAYS after
  // the last box left — as long as that day is still inside its window.
  const sentAt = g.shipments
    .map((s) => (s.sent_at ? Date.parse(s.sent_at) : NaN))
    .filter((t) => Number.isFinite(t))
    .reduce((a, b) => Math.max(a, b), 0);
  if (g.buyerEmail && sentAt > 0 && now <= sentAt + INVITE_UNTIL_DAYS * DAY) {
    return {
      ...base,
      state: "scheduled",
      detail: `emails itself ${shortDate(sentAt + INVITE_AFTER_DAYS * DAY)}`,
    };
  }
  return {
    ...base,
    state: "todo",
    detail: g.buyerEmail ? "the automatic email didn't go — copy a link" : "copy a review DM",
  };
}

// The items still waiting on the seller — what "Mark done" warns about.
export function openAfterSale(items: AfterSaleItem[]): AfterSaleItem[] {
  return items.filter((i) => i.state === "todo");
}
