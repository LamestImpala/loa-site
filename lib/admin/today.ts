import type { Worklist } from "./worklist.ts";

// The Today page's to-do list: every job in the worklist as a row that
// links to the exact spot it gets cleared, grouped the way a sale moves.
// Also where the old Inbox's #anchors went. Pure — no React, no Supabase.

export type TodayRow = {
  key: string;
  n: number;
  label: string; // reads after the number: "2 new requests"
  href: string;
  urgent?: boolean; // a buyer is waiting on the seller
  waiting?: boolean; // the buyer's move, not the seller's — shown, not counted
};

export type TodayGroup = {
  key: "sell" | "ship" | "stock" | "after";
  label: string;
  href: string; // the group's own page
  count: number; // jobs that are the seller's move
  rows: TodayRow[]; // only rows with something in them
};

const pl = (n: number, one: string, many: string) => (n === 1 ? one : many);

export function todayGroups(w: Worklist): TodayGroup[] {
  const waiting = Math.max(0, w.openOrders - w.expiredHolds - w.staleInvoices);
  const groups: Omit<TodayGroup, "count">[] = [
    {
      key: "sell",
      label: "Sell",
      href: "/admin/sell",
      rows: [
        {
          key: "requests",
          n: w.newRequests,
          label: pl(w.newRequests, "new request", "new requests"),
          href: "/admin/sell#requests",
          urgent: true,
        },
        {
          key: "messages",
          n: w.newMessages,
          label: pl(w.newMessages, "new message", "new messages"),
          href: "/admin/sell#messages",
          urgent: true,
        },
        {
          key: "expired",
          n: w.expiredHolds,
          label: pl(w.expiredHolds, "hold expired", "holds expired"),
          href: "/admin/sell#open-orders",
          urgent: true,
        },
        {
          key: "stale",
          n: w.staleInvoices,
          label: pl(w.staleInvoices, "invoice unpaid 24h+", "invoices unpaid 24h+"),
          href: "/admin/sell#open-orders",
          urgent: true,
        },
        {
          key: "waiting",
          n: waiting,
          label: pl(waiting, "order awaiting payment", "orders awaiting payment"),
          href: "/admin/sell#open-orders",
          waiting: true,
        },
      ],
    },
    {
      key: "ship",
      label: "Ship",
      href: "/admin/pick",
      rows: [
        {
          key: "pull",
          n: w.toPull,
          label: "to pull from the shelf",
          href: "/admin/pick",
        },
        { key: "pack", n: w.toPack, label: "to pack", href: "/admin/pack" },
        {
          key: "labels",
          n: w.needLabels,
          label: pl(w.needLabels, "box needs a label", "boxes need a label"),
          href: "/admin/labels",
        },
        {
          key: "send",
          n: w.toSend,
          label: pl(w.toSend, "box to drop off", "boxes to drop off"),
          href: "/admin/ship#drop-off",
        },
      ],
    },
    {
      key: "stock",
      label: "Stock",
      href: "/admin/catalog",
      rows: [
        {
          key: "prices",
          n: w.priceApprovals,
          label: pl(w.priceApprovals, "price change to approve", "price changes to approve"),
          href: "/admin/pricing",
        },
      ],
    },
    {
      key: "after",
      label: "After the sale",
      href: "/admin/ship/orders",
      rows: [
        {
          key: "push",
          n: w.toPush,
          label: pl(
            w.toPush,
            "order with tracking to push to PayPal",
            "orders with tracking to push to PayPal"
          ),
          href: "/admin/ship/orders",
        },
        {
          key: "sync",
          n: w.toSync,
          label: pl(w.toSync, "order to sync from PayPal", "orders to sync from PayPal"),
          href: "/admin/ship/orders",
        },
        {
          key: "finish",
          n: w.toFinish,
          label: pl(w.toFinish, "shipped order to mark done", "shipped orders to mark done"),
          href: "/admin/ship/orders#after-sale",
        },
        {
          key: "discogs",
          n: w.toUnlist,
          label: pl(
            w.toUnlist,
            "shipped record to remove from Discogs",
            "shipped records to remove from Discogs"
          ),
          href: "/admin/catalog",
        },
        {
          key: "reviews",
          n: w.pendingReviews,
          label: pl(w.pendingReviews, "review to publish", "reviews to publish"),
          href: "/admin/reviews",
        },
      ],
    },
  ];
  return groups.map((g) => {
    const rows = g.rows.filter((r) => r.n > 0);
    return {
      ...g,
      rows,
      count: rows.reduce((n, r) => n + (r.waiting ? 0 : r.n), 0),
    };
  });
}

// Everything that is the seller's move, across all groups.
export function todayCount(groups: TodayGroup[]) {
  return groups.reduce((n, g) => n + g.count, 0);
}

// /admin used to be the Inbox, and emails already in the owner's mailbox
// link to its sections. Where each old #anchor lives now; null when the
// hash isn't one of them (stay on Today).
const MOVED: Record<string, string> = {
  "#requests": "/admin/sell#requests",
  "#sale-desk": "/admin/sell#sale-desk",
  "#open-orders": "/admin/sell#open-orders",
  "#messages": "/admin/sell#messages",
  "#paste-dm": "/admin/sell#paste-dm",
  "#reviews": "/admin/reviews",
};

export function movedInboxHash(hash: string): string | null {
  return MOVED[hash] ?? null;
}

// /admin/ship used to hold the order cards under #fulfillment; they have
// their own page now. Where an old Ship #anchor lives; null = stay put.
export function movedShipHash(hash: string): string | null {
  return hash === "#fulfillment" ? "/admin/ship/orders" : null;
}
