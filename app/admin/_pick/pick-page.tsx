"use client";

import { useMemo, useState } from "react";
import type { DbRecord } from "@/lib/supabase";
import {
  byLetter,
  byOrder,
  orderCounts,
  pickList,
  pickPatch,
  pickProgress,
  type PickRow,
} from "@/lib/admin/pick-list";
import { useAdmin } from "../_shell/admin-provider";
import { smallButtonClass } from "../_shell/ui";

// The phone page for pulling records off the shelf: every record in a paid
// order that isn't in a tracked parcel yet, walked A→Z, tapped off one by
// one. The pulled mark lives on the record (picked_at) so it survives a
// refresh and shows on the desktop fulfillment panel.
export function PickPage() {
  const {
    records,
    shipments,
    orders,
    loading,
    setRecords,
    updateRecord,
    updateRecords,
    savingIds,
  } = useAdmin();
  const [view, setView] = useState<"shelf" | "order">("shelf");
  const [resetting, setResetting] = useState(false);

  const rows = useMemo(
    () => pickList(records, shipments, orders),
    [records, shipments, orders]
  );
  const { picked, total } = pickProgress(rows);
  const counts = useMemo(() => orderCounts(rows), [rows]);

  function patchLocal(id: number, patch: Partial<DbRecord>) {
    setRecords((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  // Optimistic: flip the row now, put it back if the write fails (the
  // provider already toasted the error).
  async function toggle(row: PickRow) {
    const id = row.record.id;
    if (savingIds.has(id)) return;
    const before = row.record.picked_at ?? null;
    const patch = pickPatch(row.record);
    patchLocal(id, patch);
    const ok = await updateRecord(id, patch, { quiet: true });
    if (!ok) patchLocal(id, { picked_at: before });
  }

  async function reset() {
    const ids = rows.filter((r) => r.picked).map((r) => r.record.id);
    if (ids.length === 0 || resetting) return;
    if (
      !window.confirm(
        `Clear the pulled mark on ${ids.length} record${ids.length === 1 ? "" : "s"}?`
      )
    )
      return;
    setResetting(true);
    await updateRecords(ids, { picked_at: null });
    setResetting(false);
  }

  if (loading && records.length === 0) {
    return <p className="mt-6 text-neutral-400">Loading…</p>;
  }

  return (
    <div className="mt-4">
      <header className="sticky top-0 z-10 -mx-4 border-b border-white/10 bg-black/95 px-4 py-3 backdrop-blur md:-mx-8 md:px-8">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div>
            <h1 className="text-lg font-semibold">Pick list</h1>
            <p className="text-sm text-neutral-400" aria-live="polite">
              {total === 0
                ? "Nothing to pull"
                : `${picked} / ${total} pulled${counts.size > 1 ? ` · ${counts.size} orders` : ""}`}
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <div
              role="group"
              aria-label="View"
              className="flex overflow-hidden rounded-md border border-white/15"
            >
              {(["shelf", "order"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setView(v)}
                  aria-pressed={view === v}
                  className={`px-2.5 py-1 text-xs transition ${
                    view === v
                      ? "bg-white/15 text-white"
                      : "text-neutral-400 hover:text-white"
                  }`}
                >
                  {v === "shelf" ? "Shelf" : "By order"}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={reset}
              disabled={picked === 0 || resetting}
              className={smallButtonClass}
            >
              {resetting ? "Resetting…" : "Reset"}
            </button>
          </div>
        </div>
        {total > 0 ? (
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={picked}
            className="mt-2 h-1 overflow-hidden rounded-full bg-white/10"
          >
            <div
              className="h-full bg-white transition-[width]"
              style={{ width: `${(picked / total) * 100}%` }}
            />
          </div>
        ) : null}
      </header>

      {total === 0 ? (
        <div className="mt-8 rounded-2xl border border-white/10 p-6 text-center text-neutral-400">
          Nothing to pull — every paid order is packed.
        </div>
      ) : view === "shelf" ? (
        byLetter(rows).map(([letter, rs]) => (
          <section key={letter} aria-label={`Artists starting with ${letter}`}>
            <h2 className="mt-5 border-b border-white/10 pb-1 text-xs uppercase tracking-widest text-neutral-500">
              {letter}
            </h2>
            <ul className="divide-y divide-white/5">
              {rs.map((row) => (
                <li key={row.record.id}>
                  <PickRowButton
                    row={row}
                    count={counts.get(row.orderKey) ?? 1}
                    busy={savingIds.has(row.record.id)}
                    onToggle={() => toggle(row)}
                  />
                </li>
              ))}
            </ul>
          </section>
        ))
      ) : (
        <div className="mt-4 flex flex-col gap-3">
          {byOrder(rows).map((g) => (
            <section
              key={g.key}
              aria-label={`Order for u/${g.buyer}`}
              className="rounded-2xl border border-white/10 px-3 py-2"
            >
              <div className="flex items-center justify-between gap-3 border-b border-white/10 pb-2">
                <h2 className="font-medium">u/{g.buyer || "(no buyer)"}</h2>
                <span
                  className={`text-xs ${
                    g.picked === g.rows.length ? "text-emerald-400" : "text-neutral-400"
                  }`}
                >
                  {g.picked} / {g.rows.length} pulled
                </span>
              </div>
              <ul className="divide-y divide-white/5">
                {g.rows.map((row) => (
                  <li key={row.record.id}>
                    <PickRowButton
                      row={row}
                      count={1}
                      showBuyer={false}
                      busy={savingIds.has(row.record.id)}
                      onToggle={() => toggle(row)}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

// One record: the whole row is the tap target. Picked rows dim but stay in
// place — walking the shelf is positional.
function PickRowButton({
  row,
  count,
  busy,
  onToggle,
  showBuyer = true,
}: {
  row: PickRow;
  count: number;
  busy: boolean;
  onToggle: () => void;
  showBuyer?: boolean;
}) {
  const r = row.record;
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={busy}
      aria-pressed={row.picked}
      className={`flex min-h-[64px] w-full items-center gap-3 py-2 text-left transition active:bg-white/10 ${
        row.picked ? "opacity-50" : ""
      }`}
    >
      {r.cover_image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={r.cover_image}
          alt=""
          loading="lazy"
          className="h-12 w-12 shrink-0 rounded-md bg-white/5 object-cover"
        />
      ) : (
        <span aria-hidden className="h-12 w-12 shrink-0 rounded-md bg-white/5" />
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">
          {r.artist} — {r.title}
        </span>
        {r.pressing ? (
          <span className="block truncate text-xs text-neutral-400">{r.pressing}</span>
        ) : null}
        <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-neutral-400">
          <span>
            {r.media} / {r.sleeve}
          </span>
          {showBuyer ? (
            <span className="rounded-full border border-white/15 px-2 text-neutral-300">
              u/{row.buyer || "(no buyer)"}
            </span>
          ) : null}
          {showBuyer && count > 1 ? (
            <span
              title={`${count} records in this order`}
              className="rounded-full bg-white/10 px-1.5 text-neutral-200"
            >
              ×{count}
            </span>
          ) : null}
        </span>
      </span>
      <span
        aria-hidden
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-sm ${
          row.picked
            ? "border-white bg-white text-black"
            : "border-white/30 text-transparent"
        }`}
      >
        ✓
      </span>
    </button>
  );
}
