"use client";

import Link from "next/link";
import { useWorklist } from "../_shell/use-worklist";

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

// The top of the inbox: one chip per job that has work waiting, in the
// order a sale moves. Section chips jump down this page; the rest go to
// the page that clears them. Nothing waiting says so.
export function NextUp() {
  const w = useWorklist();
  const waiting = w.openOrders - w.expiredHolds - w.staleInvoices;
  const chips: {
    key: string;
    n: number;
    href: string;
    text: string;
    urgent?: boolean;
  }[] = [
    {
      key: "requests",
      n: w.newRequests,
      href: "#requests",
      text: plural(w.newRequests, "new request", "new requests"),
      urgent: true,
    },
    {
      key: "expired",
      n: w.expiredHolds,
      href: "#open-orders",
      text: plural(w.expiredHolds, "hold expired", "holds expired"),
      urgent: true,
    },
    {
      key: "stale",
      n: w.staleInvoices,
      href: "#open-orders",
      text: plural(w.staleInvoices, "invoice unpaid 24h+", "invoices unpaid 24h+"),
      urgent: true,
    },
    {
      key: "waiting",
      n: waiting,
      href: "#open-orders",
      text: plural(waiting, "order awaiting payment", "orders awaiting payment"),
    },
    { key: "pull", n: w.toPull, href: "/admin/pick", text: `${w.toPull} to pull →` },
    { key: "pack", n: w.toPack, href: "/admin/pack", text: `${w.toPack} to pack →` },
    {
      key: "labels",
      n: w.needLabels,
      href: "/admin/labels",
      text: `${plural(w.needLabels, "box needs", "boxes need")} a label →`,
    },
    {
      key: "sync",
      n: w.toSync,
      href: "#fulfillment",
      text: plural(w.toSync, "order to sync from PayPal", "orders to sync from PayPal"),
    },
    {
      key: "discogs",
      n: w.toUnlist,
      href: "/admin/catalog",
      text: `${w.toUnlist} shipped to remove from Discogs →`,
    },
  ].filter((c) => c.n > 0);

  return (
    <div
      aria-label="Next up"
      className="mt-4 flex flex-wrap items-center gap-2 text-sm"
    >
      <span className="text-neutral-500">Next up</span>
      {chips.length === 0 ? (
        <span className="text-neutral-400">Nothing waiting on you.</span>
      ) : (
        chips.map((c) => {
          const className = `rounded-full border px-3 py-1 transition hover:bg-white hover:text-black ${
            c.urgent
              ? "border-amber-400/50 text-amber-300"
              : "border-white/15 text-neutral-200"
          }`;
          return c.href.startsWith("#") ? (
            <a key={c.key} href={c.href} className={className}>
              {c.text}
            </a>
          ) : (
            <Link key={c.key} href={c.href} className={className}>
              {c.text}
            </Link>
          );
        })
      )}
    </div>
  );
}
