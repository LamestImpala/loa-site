"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Shipment } from "@/lib/supabase";
import { buyerLabel } from "@/lib/admin/buyers";
import { awaitingDropOff, recentlyDroppedOff, UNDO_DROP_OFF_DAYS } from "@/lib/admin/pack-list";
import { markDroppedOff, undoDropOff } from "@/lib/admin/shipments-db";
import { movedShipHash } from "@/lib/admin/today";
import { useAdmin } from "../_shell/admin-provider";
import { NextStep, nextStepLinkClass } from "../_shell/next-step";
import { EmptyState, PageHeader } from "../_shell/primitives";
import { buttonClass, smallButtonClass } from "../_shell/ui";

// Drop off: the last step of Pick → Pack → Labels → Drop off. Labeled
// boxes sit here until they're at the post office; marking them gone
// takes them off the order sheet and starts the review clock. A box
// ticked by mistake can be put back for a week. What's left on each order
// after that — telling PayPal, the fee, the after-sale checklist — is on
// its card under Orders.
export function DropOffPage() {
  const { supabase, records, shipments, setShipments, orders, loading, pushToast, confirm } =
    useAdmin();
  const router = useRouter();

  // The order cards used to live here under #fulfillment; links in old
  // tabs and bookmarks land on this page. Send them on to Orders.
  useEffect(() => {
    const moved = movedShipHash(window.location.hash);
    if (moved) router.replace(moved);
  }, [router]);

  // An email buyer's address lives on the order, not the box.
  const orderEmail = (s: { order_id?: number | null }) =>
    s.order_id != null ? (orders.find((o) => o.id === s.order_id)?.buyer_email ?? null) : null;
  const who = (s: Shipment) => buyerLabel(s.buyer_username, orderEmail(s), "?");

  const dropOff = useMemo(() => awaitingDropOff(shipments, orders), [shipments, orders]);
  const recent = useMemo(() => recentlyDroppedOff(shipments), [shipments]);
  const byId = useMemo(() => new Map(records.map((r) => [r.id, r])), [records]);
  const titlesOf = (s: Shipment) =>
    (s.record_ids ?? [])
      .map((id) => byId.get(id))
      .filter((r) => !!r)
      .map((r) => `${r!.artist} — ${r!.title}`);

  // Boxes ticked for this trip to the post office — all of them unless
  // the seller unticks one that stayed home.
  const [left, setLeft] = useState<Set<number>>(new Set());
  const going = dropOff.filter((s) => !left.has(s.id));
  const [busy, setBusy] = useState<"drop" | number | null>(null);

  async function putBack(ids: number[]) {
    if (busy) return;
    setBusy(ids.length === 1 ? ids[0] : "drop");
    try {
      await undoDropOff(supabase, ids);
      setShipments((prev) => prev.map((s) => (ids.includes(s.id) ? { ...s, sent_at: null } : s)));
      pushToast(
        "info",
        ids.length === 1
          ? `Box #${ids[0]} is back on the drop-off list`
          : `${ids.length} boxes are back on the drop-off list`
      );
    } catch (e) {
      pushToast("error", e instanceof Error ? e.message : "Couldn't undo the drop-off");
    } finally {
      setBusy(null);
    }
  }

  async function dropOffGoing() {
    if (busy || going.length === 0) return;
    const n = going.length;
    if (
      !(await confirm(
        `Mark ${n} labeled box${n === 1 ? "" : "es"} as dropped off?\n\n${going
          .map((s) => `• Box #${s.id} — ${who(s)}`)
          .join("\n")}\n\nThey come off the order sheet.`,
        "Mark dropped off"
      ))
    )
      return;
    setBusy("drop");
    const ids = going.map((s) => s.id);
    try {
      const sentAt = await markDroppedOff(supabase, ids);
      setShipments((prev) => prev.map((s) => (ids.includes(s.id) ? { ...s, sent_at: sentAt } : s)));
      setLeft(new Set());
      pushToast("success", `${n} box${n === 1 ? "" : "es"} marked dropped off`, {
        label: "Undo",
        onClick: () => putBack(ids),
      });
    } catch (e) {
      pushToast("error", e instanceof Error ? e.message : "Couldn't mark dropped off");
    } finally {
      setBusy(null);
    }
  }

  if (loading && records.length === 0) {
    return <p className="mt-6 text-neutral-400">Loading…</p>;
  }

  return (
    <>
      <PageHeader
        title="Drop off"
        description="Labeled boxes still in the house. After the post office run, mark them gone — that takes them off the order sheet and starts the clock on the review ask."
      />

      {dropOff.length === 0 ? (
        <>
          <NextStep>
            <span>Every labeled box has left.</span>
            <Link href="/admin/ship/orders" className={nextStepLinkClass}>
              Finish the orders →
            </Link>
          </NextStep>
          <EmptyState>
            Nothing to drop off. Boxes show up here once they have a label —{" "}
            <Link href="/admin/labels" className="underline underline-offset-2 hover:text-white">
              Labels
            </Link>
            .
          </EmptyState>
        </>
      ) : (
        <section
          id="drop-off"
          aria-label="Boxes to drop off"
          className="mt-6 scroll-mt-24 rounded-2xl border border-white/10 bg-white/5 p-4"
        >
          <h2 className="font-medium">
            {dropOff.length} labeled box{dropOff.length === 1 ? "" : "es"} in the house
          </h2>
          <p className="mt-1 text-sm text-neutral-400">
            Untick any that are staying home this trip.
          </p>
          <ul className="mt-3 grid gap-1.5">
            {dropOff.map((s) => {
              const titles = titlesOf(s);
              return (
                <li key={s.id}>
                  <label className="flex items-start gap-2 text-sm text-neutral-200">
                    <input
                      type="checkbox"
                      checked={!left.has(s.id)}
                      onChange={(e) =>
                        setLeft((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.delete(s.id);
                          else next.add(s.id);
                          return next;
                        })
                      }
                      className="admin-checkbox mt-0.5"
                    />
                    <span>
                      <span className="font-medium">Box #{s.id}</span>{" "}
                      <span className="text-neutral-400">
                        {who(s)} · …{(s.tracking_code ?? "").slice(-4)}
                      </span>
                      {titles.length ? (
                        <span className="block text-xs text-neutral-500">
                          {titles.join(" · ")}
                        </span>
                      ) : null}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
          <button
            type="button"
            onClick={dropOffGoing}
            disabled={going.length === 0 || busy !== null}
            className={`mt-3 ${buttonClass}`}
          >
            {busy === "drop" ? "Saving…" : `Mark ${going.length} dropped off`}
          </button>
        </section>
      )}

      {recent.length > 0 ? (
        <section aria-label="Dropped off lately" className="mt-10">
          <h2 className="text-xl font-medium">
            Dropped off lately{" "}
            <span className="text-sm text-neutral-400">(last {UNDO_DROP_OFF_DAYS} days)</span>
          </h2>
          <p className="mt-1 text-sm text-neutral-400">
            Marked one that stayed home? Undo puts it back on the list above.
          </p>
          <ul className="mt-3 grid gap-2">
            {recent.map((s) => {
              const titles = titlesOf(s);
              return (
                <li
                  key={s.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-white/10 px-3 py-2 text-sm"
                >
                  <span className="font-medium">Box #{s.id}</span>
                  <span className="text-neutral-400">
                    {who(s)} · …{(s.tracking_code ?? "").slice(-4)}
                  </span>
                  <span className="text-xs text-neutral-500">
                    dropped off{" "}
                    {new Date(s.sent_at as string).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                  <button
                    type="button"
                    onClick={() => putBack([s.id])}
                    disabled={busy !== null}
                    title="Clear the drop-off: the box goes back on the list above and on the order sheet"
                    className={`ml-auto ${smallButtonClass}`}
                  >
                    {busy === s.id ? "Undoing…" : "Undo"}
                  </button>
                  {titles.length ? (
                    <span className="basis-full text-xs text-neutral-500">
                      {titles.join(" · ")}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </>
  );
}
