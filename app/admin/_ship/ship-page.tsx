"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { integrityIssues } from "@/lib/admin/integrity";
import { awaitingDropOff } from "@/lib/admin/pack-list";
import { useAdmin } from "../_shell/admin-provider";
import { FulfillmentPanel } from "../fulfillment-panel";
import { buttonClass } from "../_shell/ui";

// Send: everything after the labels are printed, in the order it happens —
// the boxes go to the post office (Mark dropped off), PayPal hears about
// tracking and the fee, and the buyer confirms the trade. The last stop
// of Pick → Pack → Labels → Send. "Needs fixing" on top lists states that
// went quietly wrong anywhere in a sale, each with a jump to its fix.
export function ShipPage() {
  const {
    supabase,
    records,
    setRecords,
    shipments,
    setShipments,
    invoices,
    setInvoices,
    orders,
    setOrders,
    postUrl,
    loading,
    renameBuyer,
    getAccessToken,
    copyText,
    pushToast,
    confirm,
    readdToDiscogs,
    discogsReadding,
  } = useAdmin();

  const issues = useMemo(
    () => integrityIssues({ records, shipments, invoices, orders }),
    [records, shipments, invoices, orders]
  );
  const dropOff = useMemo(
    () => awaitingDropOff(shipments, orders),
    [shipments, orders]
  );
  const byId = useMemo(() => new Map(records.map((r) => [r.id, r])), [records]);
  // Boxes ticked for this trip to the post office — all of them unless
  // the seller unticks one that stayed home.
  const [left, setLeft] = useState<Set<number>>(new Set());
  const going = dropOff.filter((s) => !left.has(s.id));
  const [droppingOff, setDroppingOff] = useState(false);
  const draftParcelCount = useMemo(
    () => shipments.filter((s) => s.status === "draft").length,
    [shipments]
  );

  async function markDroppedOff() {
    if (droppingOff || going.length === 0) return;
    const n = going.length;
    if (
      !(await confirm(
        `Mark ${n} labeled box${n === 1 ? "" : "es"} as dropped off?\n\n${going
          .map((s) => `• Box #${s.id} — u/${s.buyer_username || "?"}`)
          .join("\n")}\n\nThey come off the order sheet.`
      ))
    )
      return;
    setDroppingOff(true);
    const sentAt = new Date().toISOString();
    const ids = going.map((s) => s.id);
    const { error } = await supabase
      .from("shipments")
      .update({ sent_at: sentAt })
      .in("id", ids);
    setDroppingOff(false);
    if (error) {
      pushToast("error", `Couldn't mark dropped off: ${error.message}`);
      return;
    }
    setShipments((prev) =>
      prev.map((s) => (ids.includes(s.id) ? { ...s, sent_at: sentAt } : s))
    );
    setLeft(new Set());
    pushToast("success", `${n} box${n === 1 ? "" : "es"} marked dropped off`);
  }

  if (loading && records.length === 0) {
    return <p className="mt-6 text-neutral-400">Loading…</p>;
  }

  return (
    <>
      <h1 className="mt-6 text-3xl font-semibold">Send</h1>
      <p className="mt-1 text-sm text-neutral-400">
        After the labels: drop the boxes off, then let PayPal know — push
        tracking it can&rsquo;t see and sync the fee — and confirm the trade.
      </p>

      {issues.length > 0 ? (
        <section
          aria-label="Needs fixing"
          className="mt-6 rounded-2xl border border-red-500/40 bg-red-500/10 p-4"
        >
          <h2 className="font-medium text-red-200">
            Needs fixing{" "}
            <span className="text-sm font-normal text-red-300/80">
              ({issues.length})
            </span>
          </h2>
          <ul className="mt-2 grid gap-1.5 text-sm text-red-100">
            {issues.map((i) => (
              <li key={i.key} className="flex flex-wrap items-baseline gap-x-2">
                <span>{i.text}</span>
                {i.readdRecordId && byId.get(i.readdRecordId) ? (
                  <button
                    type="button"
                    disabled={discogsReadding.has(i.readdRecordId)}
                    onClick={() => readdToDiscogs(byId.get(i.readdRecordId!)!)}
                    className="text-xs text-red-200 underline underline-offset-2 transition hover:text-white disabled:opacity-50"
                  >
                    {discogsReadding.has(i.readdRecordId) ? "Re-adding…" : "Re-add →"}
                  </button>
                ) : null}
                <Link
                  href={i.href}
                  className="text-xs text-red-300 underline underline-offset-2 transition hover:text-white"
                >
                  Fix →
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <h2 id="drop-off" className="mt-10 scroll-mt-24 text-xl font-medium">
        Drop off{" "}
        <span className="text-sm text-neutral-400">
          ({dropOff.length} labeled box{dropOff.length === 1 ? "" : "es"} in
          the house)
        </span>
      </h2>
      {dropOff.length === 0 ? (
        <p className="mt-2 text-sm text-neutral-500">
          Every labeled box has left.{" "}
          <Link href="/admin/labels" className="underline underline-offset-2 hover:text-white">
            Labels →
          </Link>
        </p>
      ) : (
        <div className="mt-3 rounded-2xl border border-white/10 bg-white/5 p-4">
          <ul className="grid gap-1.5">
            {dropOff.map((s) => {
              const titles = (s.record_ids ?? [])
                .map((id) => byId.get(id))
                .filter(Boolean)
                .map((r) => `${r!.artist} — ${r!.title}`);
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
                        u/{s.buyer_username || "?"} · …
                        {(s.tracking_code ?? "").slice(-4)}
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
            onClick={markDroppedOff}
            disabled={going.length === 0 || droppingOff}
            className={`mt-3 ${buttonClass}`}
          >
            {droppingOff
              ? "Saving…"
              : `Mark ${going.length} dropped off`}
          </button>
        </div>
      )}

      <h2 id="fulfillment" className="mt-10 scroll-mt-24 text-xl font-medium">
        Orders{" "}
        <span className="text-sm text-neutral-400">
          ({draftParcelCount} parcel{draftParcelCount === 1 ? "" : "s"}{" "}
          awaiting tracking)
        </span>
      </h2>
      <FulfillmentPanel
        records={records.filter((r) => r.sold)}
        shipments={shipments}
        invoices={invoices}
        orders={orders}
        supabase={supabase}
        onShipmentsChange={setShipments}
        onInvoicesChange={setInvoices}
        onOrdersChange={setOrders}
        onRecordPatched={(id, patch) =>
          setRecords((prev) =>
            prev.map((r) => (r.id === id ? { ...r, ...patch } : r))
          )
        }
        onRenameBuyer={renameBuyer}
        getAccessToken={getAccessToken}
        copyText={copyText}
        pushToast={pushToast}
        confirm={confirm}
        defaultThreadUrl={postUrl}
      />
    </>
  );
}
