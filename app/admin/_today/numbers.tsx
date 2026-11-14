"use client";

import { useMemo } from "react";
import { dayLabel, localDayKey, recentDays } from "@/lib/admin/interest";
import { salesStats } from "@/lib/admin/stats";
import { useAdmin, useSlice } from "../_shell/admin-provider";

// The numbers: what the shelf is worth, what has sold and netted, and how
// many shoppers came by each day. Read-only, so they sit below the work.
export function Numbers() {
  const { records, shipments, invoices, orders, events, visits, loading } = useAdmin();

  // Live collection value — recomputed from local state, so it updates the
  // moment a price is edited, a change is approved, or a record is sold.
  const stats = useMemo(
    () => salesStats({ records, shipments, invoices, orders }),
    [records, shipments, invoices, orders]
  );

  useSlice("events");
  useSlice("visits");
  const dailyStrip = useMemo(() => recentDays(events, visits), [events, visits]);
  const stripMax = Math.max(1, ...dailyStrip.map((d) => d.visited));
  // Oldest logged visit (visits load newest first), to flag days before
  // visit tracking existed. Undefined until the slice loads.
  const visitsSince = visits.length
    ? localDayKey(new Date(visits[visits.length - 1].created_at))
    : undefined;

  return (
    <section aria-labelledby="numbers">
      <h2 id="numbers" className="mt-12 scroll-mt-24 text-xl font-medium">
        Numbers
      </h2>
      {/* Collection value summary */}
      {loading && records.length === 0 ? (
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {["For sale", "Sold", "Net", "Hidden"].map((label) => (
            <div
              key={label}
              className="animate-pulse rounded-2xl border border-white/10 bg-white/5 p-5"
            >
              <p className="text-sm text-neutral-400">{label}</p>
              <p className="mt-2 h-7 w-24 rounded bg-white/10" />
              <p className="mt-2 h-3 w-32 rounded bg-white/5" />
            </div>
          ))}
        </div>
      ) : (
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
          <p className="text-sm text-neutral-400">For sale</p>
          <p className="mt-1 text-2xl font-semibold">
            ${stats.askingTotal.toLocaleString()}
          </p>
          <p className="mt-1 text-xs text-neutral-500">
            {stats.forSaleCount} records at asking price
          </p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
          <p className="text-sm text-neutral-400">Sold</p>
          <p className="mt-1 text-2xl font-semibold text-green-400">
            ${stats.soldTotal.toLocaleString()}
          </p>
          <p
            className="mt-1 text-xs text-neutral-500"
            title="Uses the final sold price when entered, listed price otherwise, less any credits and partial refunds on paid orders. Fully refunded orders don't count, and neither does a refund for an item that couldn't be found — its price left with it."
          >
            {stats.soldCount} sold · ${stats.asp.toFixed(2)} avg selling price
            {stats.creditTotal > 0
              ? ` · $${stats.creditTotal.toFixed(2)} in credits`
              : ""}
            {stats.refundedTotal > 0
              ? ` · $${stats.refundedTotal.toFixed(2)} refunded`
              : ""}
          </p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
          <p className="text-sm text-neutral-400">Net</p>
          <p
            className="mt-1 text-2xl font-semibold text-green-400"
            title="Sold total + shipping collected − PayPal fees − postage. Fees and postage are entered per order in the fulfillment section."
          >
            ${stats.netTotal.toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </p>
          <p className="mt-1 text-xs text-neutral-500">
            ${stats.feesTotal.toFixed(2)} fees · ${stats.postageTotal.toFixed(2)}{" "}
            postage · ${stats.shippingCharged.toFixed(2)} shipping collected
          </p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
          <p className="text-sm text-neutral-400">Hidden</p>
          <p className="mt-1 text-2xl font-semibold text-neutral-300">
            ${stats.hiddenTotal.toLocaleString()}
          </p>
          <p className="mt-1 text-xs text-neutral-500">
            {stats.hiddenCount} records not shown on the site
          </p>
        </div>
      </div>
      )}

      {/* Interest by day — daily distinct shoppers across the shop */}
      {events.length > 0 || visits.length > 0 ? (
        <div className="mt-3 rounded-2xl border border-white/10 bg-white/5 p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm text-neutral-400">Interest by day</p>
            <p className="text-xs text-neutral-500">
              <span className="text-neutral-400">▮</span>{" "}
              {dailyStrip.reduce((n, d) => n + d.visited, 0)} visited ·{" "}
              <span className="text-neutral-200">▮</span>{" "}
              {dailyStrip.reduce((n, d) => n + d.looked, 0)} clicked a record ·{" "}
              <span className="text-green-400">●</span>{" "}
              {dailyStrip.reduce((n, d) => n + d.asked, 0)} asked to buy · last
              14 days
            </p>
          </div>
          <div className="mt-3 flex items-end gap-1.5">
            {dailyStrip.map((d) => (
              <div
                key={d.key}
                className="flex min-w-0 flex-1 flex-col items-center gap-1"
                title={`${d.label} · ${d.visited} visited · ${d.looked} clicked a record (${d.clicks} clicks) · ${d.asked} asked${
                  d.topReferrer ? ` · most from ${d.topReferrer}` : ""
                }`}
              >
                <div className="flex h-16 w-full max-w-8 items-end">
                  <div
                    className={`flex w-full items-end overflow-hidden rounded-t ${
                      d.visited > 0 ? "bg-neutral-500" : "bg-white/10"
                    }`}
                    style={{
                      height:
                        d.visited > 0
                          ? `${Math.max(10, (d.visited / stripMax) * 100)}%`
                          : "2px",
                    }}
                  >
                    {d.looked > 0 ? (
                      <div
                        className="w-full bg-neutral-200"
                        style={{ height: `${(d.looked / d.visited) * 100}%` }}
                      />
                    ) : null}
                  </div>
                </div>
                <p className="h-3 text-[10px] leading-none text-neutral-400">
                  {d.visited > 0 ? d.visited : ""}
                </p>
                <div className="h-1.5">
                  {d.asked > 0 ? (
                    <div className="mx-auto h-1.5 w-1.5 rounded-full bg-green-400" />
                  ) : null}
                </div>
                <p className="text-[10px] leading-none text-neutral-500">
                  {d.key.slice(8).replace(/^0/, "")}
                </p>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[11px] text-neutral-500">
            {visitsSince && visitsSince > dailyStrip[0].key
              ? `Page visits are logged from ${dayLabel(visitsSince)}; earlier days only show people who clicked. `
              : ""}
            Counted per browser; your own browsing is skipped on any browser
            you&rsquo;ve opened the admin in. Hover a day for where people came
            from.
          </p>
        </div>
      ) : null}
    </section>
  );
}
