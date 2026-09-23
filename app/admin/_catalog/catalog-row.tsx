"use client";

import { memo } from "react";
import type { DbRecord, RecordInterest } from "@/lib/supabase";
import { holdActive, holdUntilText, invoiceHold } from "@/lib/admin/records";
import type { MarketStats } from "@/lib/admin/market";
import { buttonClass, inputClass, pct } from "../_shell/ui";

// One catalog table row. Memoised: the page passes only this record's own
// slice of state (selected, open, saving, its draft price, its market and
// interest rows) plus stable callbacks, so editing one row's price or
// toggling one checkbox re-renders that row alone, not all 500.
type Props = {
  r: DbRecord;
  selected: boolean;
  isOpen: boolean;
  saving: boolean;
  priceDraft: string | undefined;
  stats: MarketStats | undefined;
  interest: RecordInterest | undefined;
  onToggleSelected: (id: number) => void;
  onOpen: (id: number | null) => void;
  onDraftPrice: (id: number, value: string) => void;
  onSavePrice: (r: DbRecord, raw: string | undefined) => void;
  onToggleListed: (r: DbRecord, listed: boolean) => void;
};

export const CatalogRow = memo(function CatalogRow({
  r,
  selected,
  isOpen,
  saving,
  priceDraft,
  stats,
  interest,
  onToggleSelected,
  onOpen,
  onDraftPrice,
  onSavePrice,
  onToggleListed,
}: Props) {
  const edited = priceDraft !== undefined && priceDraft !== String(r.price);
  const photoCount = (r.photo_urls ?? []).length;
  return (
    <tr
      className={`border-b border-white/5 last:border-b-0 ${
        isOpen ? "bg-white/5" : ""
      }`}
    >
      <td className="px-3 py-2 text-center align-top">
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggleSelected(r.id)}
          className="admin-checkbox"
        />
      </td>
      <td className="px-4 py-2">
        <button
          type="button"
          onClick={() => onOpen(isOpen ? null : r.id)}
          aria-expanded={isOpen}
          title="Open details — grades, notes, photos, hold, sold"
          className="block text-left"
        >
          <p className="font-medium text-white hover:underline">
            {r.artist} — {r.title}
          </p>
        </button>
        <p className="text-xs text-neutral-500">{r.pressing}</p>
        <p className="mt-0.5 text-xs text-neutral-600">
          {[
            `${r.media}/${r.sleeve}`,
            (r.genres ?? []).join(", ") || null,
            r.collection || null,
            photoCount ? `${photoCount} photo${photoCount === 1 ? "" : "s"}` : null,
            (r.notes ?? "").trim() ? "notes" : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </td>
      <td className="px-3 py-2 align-top">
        <div className="flex items-center gap-2">
          <span className="text-neutral-500">$</span>
          <input
            type="number"
            min="0"
            value={priceDraft ?? String(r.price)}
            onChange={(e) => onDraftPrice(r.id, e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && edited) onSavePrice(r, priceDraft);
            }}
            className={`w-20 ${inputClass}`}
          />
          {edited ? (
            <button
              type="button"
              disabled={saving}
              onClick={() => onSavePrice(r, priceDraft)}
              className={buttonClass}
            >
              {saving ? "…" : "Save"}
            </button>
          ) : null}
        </div>
        <p className="mt-1 text-xs text-neutral-500">
          {r.manual_price ? (
            <span title="Manual price: the daily run leaves it alone">manual</span>
          ) : null}
          {stats?.suggested ? (
            <span title="Discogs suggestion for this grade">
              {r.manual_price ? " · " : ""}sugg ${Math.round(stats.suggested)}
            </span>
          ) : null}
          {r.prev_price != null &&
          Number(r.prev_price) > 0 &&
          Number(r.prev_price) !== r.price ? (
            <span
              className={
                r.price > Number(r.prev_price) ? "text-green-400" : "text-red-400"
              }
              title={`Was $${r.prev_price} before the last change`}
            >
              {r.manual_price || stats?.suggested ? " · " : ""}
              {pct((r.price - Number(r.prev_price)) / Number(r.prev_price))}
            </span>
          ) : null}
        </p>
      </td>
      <td className="px-3 py-2 whitespace-nowrap align-top">
        {interest ? (
          <button
            type="button"
            onClick={() => onOpen(r.id)}
            className="text-neutral-300 underline decoration-white/30 decoration-dotted underline-offset-4 transition hover:text-white"
            title={`${interest.interest_events} clicks · ${interest.request_events} requests · last ${new Date(interest.last_event_at).toLocaleDateString()} — open for the day-by-day history`}
          >
            {interest.interest_sessions} looked
            {interest.request_sessions > 0 ? (
              <span className="text-green-400">
                {" "}
                · {interest.request_sessions} asked
              </span>
            ) : null}
          </button>
        ) : (
          <span className="text-neutral-600">—</span>
        )}
      </td>
      <td className="px-3 py-2 text-center align-top">
        <input
          type="checkbox"
          checked={r.listed}
          disabled={saving}
          onChange={(e) => onToggleListed(r, e.target.checked)}
          className="admin-checkbox"
        />
      </td>
      <td className="px-3 py-2 align-top text-xs">
        {r.sold ? (
          <span className="rounded-full border border-emerald-500/40 px-2 py-0.5 text-emerald-300">
            Sold{(r.buyer_username ?? "").trim() ? ` · u/${r.buyer_username}` : ""}
          </span>
        ) : holdActive(r) ? (
          <span
            className="rounded-full border border-amber-400/40 px-2 py-0.5 text-amber-300"
            title={`Held ${holdUntilText(r)}`}
          >
            {invoiceHold(r) ? "Invoiced" : "Held"} · u/{r.hold_buyer}
          </span>
        ) : r.listed ? (
          <span className="text-neutral-500">on shop</span>
        ) : (
          <span className="text-neutral-600">hidden</span>
        )}
        {r.discogs_removed && !r.sold ? (
          // Back for sale (un-sold, or a refund relisted it) but already
          // out of the Discogs collection — the drawer re-adds it.
          <span
            className="ml-2 rounded-full border border-amber-400/40 px-2 py-0.5 text-amber-300"
            title="This record is for sale again but was removed from your Discogs collection — open the drawer to re-add it"
          >
            Re-add to Discogs
          </span>
        ) : r.discogs_removed ? (
          <span
            className="ml-2 text-neutral-600"
            title="Removed from your Discogs collection"
          >
            ✓ Discogs
          </span>
        ) : null}
      </td>
    </tr>
  );
});
