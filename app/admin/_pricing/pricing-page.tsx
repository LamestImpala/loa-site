"use client";

import { useCallback, useMemo, useState } from "react";
import type { PendingPriceChange } from "@/lib/supabase";
import { useAdmin } from "../_shell/admin-provider";
import { buttonClass, pct } from "../_shell/ui";

// Pricing: approve or reject the daily run's flagged moves, and read the
// run history behind them.
export function PricingPage() {
  const { supabase, pending, setPending, runs, setRecords, updateRecord, pushToast } =
    useAdmin();

  const [expandedRun, setExpandedRun] = useState<number | null>(null);
  const [pendingFilter, setPendingFilter] = useState<"all" | "act" | "other">(
    "all"
  );
  const [bulkPendingBusy, setBulkPendingBusy] = useState(false);

  // copies-for-sale per record, from the most recent run summaries — used
  // to split pending cuts the same way the email report does.
  const forSaleById = useMemo(() => {
    const m = new Map<number, number>();
    for (const run of runs) {
      for (const s of run.summary ?? []) {
        if (s.for_sale != null && !m.has(s.record_id)) {
          m.set(s.record_id, s.for_sale);
        }
      }
    }
    return m;
  }, [runs]);

  // Site-wide daily activity for the "Interest by day" strip: a contiguous
  // run of the last 14 local days, zero-filled so quiet days show as gaps.
  const isActionable = useCallback(
    (p: PendingPriceChange) => {
      if (p.pct_change >= 0) return false;
      const forSale = forSaleById.get(p.record_id) ?? 0;
      return forSale >= 30 || (Math.abs(p.pct_change) <= 0.3 && forSale >= 3);
    },
    [forSaleById]
  );

  const visiblePending = useMemo(
    () =>
      pending.filter((p) =>
        pendingFilter === "all"
          ? true
          : pendingFilter === "act"
            ? isActionable(p)
            : !isActionable(p)
      ),
    [pending, pendingFilter, isActionable]
  );

  async function bulkResolvePending(
    list: PendingPriceChange[],
    approve: boolean
  ) {
    if (list.length === 0 || bulkPendingBusy) return;
    const ok = window.confirm(
      `${approve ? "Approve" : "Reject"} ${list.length} pending price change${
        list.length > 1 ? "s" : ""
      }?${approve ? " This updates the listed prices immediately." : ""}`
    );
    if (!ok) return;
    setBulkPendingBusy(true);
    // Track what actually landed so the UI always matches the DB, even when
    // a chunk fails partway through.
    const applied: PendingPriceChange[] = [];
    let failure: string | null = null;
    if (approve) {
      const chunk = 10;
      for (let i = 0; i < list.length && !failure; i += chunk) {
        const slice = list.slice(i, i + chunk);
        const results = await Promise.all(
          slice.map((p) =>
            supabase
              .from("records")
              .update({
                price: p.suggested_price,
                prev_price: p.old_price,
                updated_at: new Date().toISOString(),
              })
              .eq("id", p.record_id)
          )
        );
        slice.forEach((p, j) => {
          if (results[j].error) failure = failure ?? results[j].error!.message;
          else applied.push(p);
        });
      }
    } else {
      applied.push(...list);
    }
    const ids = applied.map((p) => p.id);
    const resolvedIds: number[] = [];
    for (let i = 0; i < ids.length && !failure; i += 200) {
      const slice = ids.slice(i, i + 200);
      const { error } = await supabase
        .from("pending_price_changes")
        .update({
          status: approve ? "approved" : "rejected",
          resolved_at: new Date().toISOString(),
        })
        .in("id", slice);
      if (error) failure = error.message;
      else resolvedIds.push(...slice);
    }
    const resolvedSet = new Set(resolvedIds);
    setPending((prev) => prev.filter((x) => !resolvedSet.has(x.id)));
    if (approve && applied.length > 0) {
      const byRecord = new Map(applied.map((p) => [p.record_id, p]));
      setRecords((prev) =>
        prev.map((r) => {
          const p = byRecord.get(r.id);
          return p
            ? { ...r, price: p.suggested_price, prev_price: p.old_price }
            : r;
        })
      );
    }
    if (failure) {
      pushToast(
        "error",
        `Bulk ${approve ? "approve" : "reject"} stopped early — ${resolvedIds.length} of ${list.length} completed: ${failure}`
      );
    } else {
      pushToast(
        "success",
        `${approve ? "Approved" : "Rejected"} ${resolvedIds.length} price change${resolvedIds.length === 1 ? "" : "s"} ✓`
      );
    }
    setBulkPendingBusy(false);
  }

  async function resolvePending(p: PendingPriceChange, approve: boolean) {
    if (approve) {
      const ok = await updateRecord(p.record_id, {
        price: p.suggested_price,
        prev_price: p.old_price,
      });
      if (!ok) return;
    }
    const { error } = await supabase
      .from("pending_price_changes")
      .update({
        status: approve ? "approved" : "rejected",
        resolved_at: new Date().toISOString(),
      })
      .eq("id", p.id);
    if (error) {
      pushToast("error", `Couldn't resolve the price change: ${error.message}`);
      return;
    }
    setPending((prev) => prev.filter((x) => x.id !== p.id));
  }

  return (
    <>
      <h1 className="mt-6 text-3xl font-semibold">Pricing</h1>
        <h2 className="mt-10 text-xl font-medium">
          Pending price changes{" "}
          <span className="text-sm text-neutral-400">
            ({pending.length} waiting · moves over ±5% from the daily Discogs
            run)
          </span>
        </h2>
        {pending.length === 0 ? (
          <p className="mt-3 text-sm text-neutral-400">
            Nothing waiting for approval.
          </p>
        ) : (
          <>
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              {(
                [
                  ["all", `All (${pending.length})`],
                  [
                    "act",
                    `Worth acting on (${pending.filter(isActionable).length})`,
                  ],
                  [
                    "other",
                    `Noise / scarce / raises (${pending.filter((p) => !isActionable(p)).length})`,
                  ],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setPendingFilter(key)}
                  className={`rounded-lg border px-2.5 py-1.5 text-xs transition ${
                    pendingFilter === key
                      ? "border-white bg-white text-black"
                      : "border-white/15 text-neutral-300 hover:bg-white hover:text-black"
                  }`}
                >
                  {label}
                </button>
              ))}
              <span className="mx-2 text-neutral-700">|</span>
              <button
                type="button"
                disabled={bulkPendingBusy || visiblePending.length === 0}
                onClick={() => bulkResolvePending(visiblePending, true)}
                className={`rounded-lg border border-white/15 px-2.5 py-1.5 text-xs text-neutral-300 transition hover:bg-white hover:text-black disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-neutral-300`}
              >
                {bulkPendingBusy
                  ? "Working…"
                  : `Approve all shown (${visiblePending.length})`}
              </button>
              <button
                type="button"
                disabled={bulkPendingBusy || visiblePending.length === 0}
                onClick={() => bulkResolvePending(visiblePending, false)}
                className={`rounded-lg border border-white/15 px-2.5 py-1.5 text-xs text-neutral-300 transition hover:bg-white hover:text-black disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-neutral-300`}
              >
                {bulkPendingBusy
                  ? "Working…"
                  : `Reject all shown (${visiblePending.length})`}
              </button>
            </div>
            <div className="mt-4 flex flex-col gap-3">
              {visiblePending.map((p) => (
                <div
                  key={p.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/5 p-4"
                >
                  <div>
                    <p className="font-medium">
                      {p.records?.artist} — {p.records?.title}
                    </p>
                    <p className="mt-1 text-sm text-neutral-400">
                      ${p.old_price} → ${p.suggested_price}{" "}
                      <span
                        className={
                          p.pct_change > 0 ? "text-green-400" : "text-red-400"
                        }
                      >
                        ({pct(p.pct_change)})
                      </span>
                      {forSaleById.has(p.record_id) ? (
                        <span className="text-neutral-500">
                          {" "}
                          · {forSaleById.get(p.record_id)} for sale
                        </span>
                      ) : null}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => resolvePending(p, true)}
                      className={buttonClass}
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      onClick={() => resolvePending(p, false)}
                      className={buttonClass}
                    >
                      Reject
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
        <h2 className="mt-12 text-xl font-medium">Daily price runs</h2>
        {runs.length === 0 ? (
          <p className="mt-3 text-sm text-neutral-400">No runs yet.</p>
        ) : (
          <div className="mt-4 flex flex-col gap-3">
            {runs.map((run) => (
              <div
                key={run.id}
                className="rounded-2xl border border-white/10 bg-white/5 p-4"
              >
                <button
                  type="button"
                  onClick={() =>
                    setExpandedRun(expandedRun === run.id ? null : run.id)
                  }
                  className="flex w-full flex-wrap items-center justify-between gap-2 text-left"
                >
                  <span className="font-medium">
                    {new Date(run.ran_at).toLocaleString()}
                  </span>
                  <span className="text-sm text-neutral-400">
                    {run.checked} checked · {run.auto_applied} auto-applied ·{" "}
                    {run.flagged} flagged
                    {run.undercuts ? ` · ${run.undercuts} auto-undercut` : ""}
                    {run.above_lowest
                      ? ` · ${run.above_lowest} above lowest listing`
                      : ""}
                    {run.errors ? ` · ${run.errors} errors` : ""}
                  </span>
                </button>
                {expandedRun === run.id ? (
                  run.summary.length === 0 ? (
                    <p className="mt-3 text-sm text-neutral-400">
                      No price movement.
                    </p>
                  ) : (
                    <ul className="mt-3 flex flex-col gap-1 text-sm text-neutral-300">
                      {run.summary.map((s, i) => (
                        <li key={i}>
                          {s.action === "above-lowest" ? (
                            <>
                              {s.artist} — {s.title}: yours ${s.old_price},
                              suggested ${s.new_price}
                              {s.lowest ? <> (lowest listing ${s.lowest})</> : null}{" "}
                              <span className="text-yellow-400">
                                ({pct(s.pct)})
                              </span>{" "}
                              <span className="text-neutral-500">
                                above cheapest Discogs listing
                                {s.for_sale != null
                                  ? ` · ${s.for_sale} for sale`
                                  : ""}
                                {s.ebay_median != null
                                  ? ` · eBay median $${s.ebay_median}`
                                  : ""}{" "}
                                — approve the cut under Pending price changes
                              </span>
                            </>
                          ) : s.action === "undercut" ? (
                            <>
                              {s.artist} — {s.title}: ${s.old_price} → $
                              {s.new_price}{" "}
                              <span className="text-red-400">
                                ({pct(s.pct)})
                              </span>{" "}
                              <span className="text-neutral-500">
                                auto-undercut cheapest listing
                                {s.for_sale != null
                                  ? ` · ${s.for_sale} for sale`
                                  : ""}
                                {s.ebay_median != null
                                  ? ` · eBay median $${s.ebay_median}`
                                  : ""}
                              </span>
                            </>
                          ) : (
                            <>
                              {s.artist} — {s.title}: ${s.old_price} → $
                              {s.new_price}{" "}
                              <span
                                className={
                                  s.pct > 0 ? "text-green-400" : "text-red-400"
                                }
                              >
                                ({pct(s.pct)})
                              </span>{" "}
                              <span className="text-neutral-500">
                                {s.action === "applied"
                                  ? "auto-applied"
                                  : "flagged for approval"}
                                {s.reason === "stocked"
                                  ? " · stocked release (30+ copies), 70% of suggestion"
                                  : s.reason === "scarce"
                                    ? " · scarce & wanted, full suggestion"
                                    : s.reason === "decay"
                                      ? " · unsold 30+ days, 5% time decay"
                                      : s.reason === "ebay"
                                        ? " · capped at eBay median for this pressing"
                                        : s.reason === "lowest"
                                          ? " · $1 under comparable cheapest listing"
                                          : ""}
                                {s.lowest != null
                                  ? ` · lowest listing $${s.lowest}${
                                      s.lowest_plausible === false
                                        ? " (not comparable)"
                                        : ""
                                    }`
                                  : ""}
                                {s.for_sale != null
                                  ? ` · ${s.for_sale} for sale`
                                  : ""}
                                {s.ebay_median != null
                                  ? ` · eBay median $${s.ebay_median}`
                                  : ""}
                              </span>
                            </>
                          )}
                        </li>
                      ))}
                    </ul>
                  )
                ) : null}
              </div>
            ))}
          </div>
        )}
    </>
  );
}
