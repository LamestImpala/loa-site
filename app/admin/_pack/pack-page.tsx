"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { DbRecord, Shipment } from "@/lib/supabase";
import {
  openParcels,
  packList,
  packProgress,
  slipsForParcels,
  type PackOrder,
} from "@/lib/admin/pack-list";
import { packingSlips, shipManifest } from "@/lib/admin/packing-slips";
import { createParcel } from "@/lib/admin/shipments-db";
import { useAdmin } from "../_shell/admin-provider";
import { NextStep, nextStepLinkClass } from "../_shell/next-step";
import { buttonClass, smallButtonClass } from "../_shell/ui";

// The packing table: one card per paid order still on the table. Each
// record is checked into the box as it goes in, then the box is sealed —
// that writes the parcel (with packed_at) and gives it a Box # for the
// mailer. Sealed boxes leave the phone pick list. "Print packing slips"
// makes one 4×6 slip per sealed box, in box order, for the thermal
// printer; the slip is the box's tag until the label is on it. "Print
// manifest" is one 4×6 checklist of those same boxes, ticked as each
// label goes on.
export function PackPage() {
  const {
    records,
    shipments,
    orders,
    ordersById,
    invoices,
    byId,
    supabase,
    loading,
    pushToast,
    upsertShipmentLocal,
    setShipments,
    confirm,
  } = useAdmin();
  const [checked, setChecked] = useState<Record<string, number[]>>({});
  const [busy, setBusy] = useState<string | null>(null); // order key or `box-${id}`
  const [printing, setPrinting] = useState<"slips" | "manifest" | null>(null);

  const list = useMemo(() => packList(records, shipments, orders), [records, shipments, orders]);
  const progress = packProgress(list);
  const openBoxes = useMemo(() => openParcels(shipments), [shipments]);
  const invoiceById = useMemo(
    () => new Map(invoices.map((inv) => [inv.paypal_invoice_id, inv])),
    [invoices]
  );

  function toggle(o: PackOrder, id: number, on: boolean) {
    setChecked((prev) => {
      const current = prev[o.key] ?? [];
      return {
        ...prev,
        [o.key]: on ? [...new Set([...current, id])] : current.filter((x) => x !== id),
      };
    });
  }

  function checkAll(o: PackOrder) {
    setChecked((prev) => ({ ...prev, [o.key]: o.loose.map((r) => r.id) }));
  }

  async function seal(o: PackOrder) {
    const ids = (checked[o.key] ?? []).filter((id) => o.loose.some((r) => r.id === id));
    if (ids.length === 0 || busy) return;
    const unpulled = o.loose.filter((r) => ids.includes(r.id) && !r.picked_at);
    if (
      unpulled.length > 0 &&
      !(await confirm(
        `${unpulled.length} of these ${ids.length === 1 ? "isn't" : "aren't"} marked pulled on the pick list:\n\n${unpulled
          .map((r) => `• ${r.artist} — ${r.title}`)
          .join("\n")}\n\nSeal the box anyway?`
      ))
    )
      return;
    setBusy(o.key);
    try {
      const created = await createParcel(supabase, {
        buyer: o.buyer,
        orderId: o.order?.id ?? null,
        recordIds: ids,
        invoiceId: o.invoiceId || null,
        mode: "paypal",
        packedAt: new Date().toISOString(),
        toAddress: o.shipTo,
      });
      upsertShipmentLocal(created);
      setChecked((prev) => ({ ...prev, [o.key]: [] }));
      pushToast(
        "success",
        `Box #${created.id} sealed — ${ids.length} record${ids.length === 1 ? "" : "s"} for u/${o.buyer || "?"}`
      );
    } catch (e) {
      pushToast("error", e instanceof Error ? e.message : "Couldn't seal the box");
    } finally {
      setBusy(null);
    }
  }

  // Undo a seal before a label exists: the records go back to loose.
  async function unseal(s: Shipment) {
    if (busy) return;
    if (!(await confirm(`Unseal Box #${s.id}? Its records go back to the loose list.`))) return;
    setBusy(`box-${s.id}`);
    const { error } = await supabase.from("shipments").delete().eq("id", s.id);
    setBusy(null);
    if (error) {
      pushToast("error", `Couldn't unseal: ${error.message}`);
      return;
    }
    setShipments((prev) => prev.filter((x) => x.id !== s.id));
  }

  // Open a built PDF in a new tab. Popup blockers may refuse this; the
  // toast's link still works.
  function openPdf(bytes: Uint8Array, message: string) {
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
    const win = window.open(url, "_blank", "noopener");
    pushToast(
      "success",
      message,
      win ? undefined : { label: "Open", onClick: () => window.open(url, "_blank", "noopener") }
    );
  }

  async function print(kind: "slips" | "manifest") {
    if (openBoxes.length === 0 || printing) return;
    setPrinting(kind);
    try {
      const slips = slipsForParcels(openBoxes, shipments, byId, ordersById);
      if (kind === "slips") {
        openPdf(
          await packingSlips(slips),
          `${slips.length} slip${slips.length === 1 ? "" : "s"} ready — print at 100% on 4×6.`
        );
      } else {
        openPdf(
          await shipManifest(slips),
          `Manifest for ${slips.length} box${slips.length === 1 ? "" : "es"} ready — print at 100% on 4×6.`
        );
      }
    } catch (e) {
      pushToast(
        "error",
        e instanceof Error ? e.message : `Couldn't build the ${kind === "slips" ? "slips" : "manifest"}`
      );
    } finally {
      setPrinting(null);
    }
  }

  if (loading && records.length === 0) {
    return <p className="mt-6 text-neutral-400">Loading…</p>;
  }

  return (
    <div className="mt-4">
      <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div>
          <h1 className="text-lg font-semibold">Pack</h1>
          <p className="text-sm text-neutral-400" aria-live="polite">
            {list.length === 0
              ? "Nothing on the table"
              : [
                  `${progress.orders} order${progress.orders === 1 ? "" : "s"}`,
                  `${progress.loose} record${progress.loose === 1 ? "" : "s"} loose`,
                  `${progress.boxes} box${progress.boxes === 1 ? "" : "es"} awaiting a label`,
                ].join(" · ")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => print("manifest")}
            disabled={openBoxes.length === 0 || !!printing}
            title="One 4×6 checklist of every box without a label yet, in Box # order — tick each as its label goes on"
            className={buttonClass}
          >
            {printing === "manifest" ? "Building…" : "Print manifest"}
          </button>
          <button
            type="button"
            onClick={() => print("slips")}
            disabled={openBoxes.length === 0 || !!printing}
            title="One 4×6 slip per box without a label yet (sealed here or made on the fulfillment card), in Box # order — for the thermal printer"
            className={buttonClass}
          >
            {printing === "slips"
              ? "Building…"
              : `Print packing slips${openBoxes.length ? ` (${openBoxes.length})` : ""}`}
          </button>
        </div>
      </header>
      <p className="mt-2 text-sm text-neutral-400">
        Check each record into the mailer as it goes in, then seal the box.
        Sealing writes the parcel and gives it a Box # — the packing slip
        carries it, so keep the boxes in Box # order on the table and the
        labels will print in the same order.
      </p>

      {progress.loose === 0 && progress.boxes > 0 ? (
        <NextStep>
          <span>
            Everything&rsquo;s boxed — {progress.boxes} box
            {progress.boxes === 1 ? " needs" : "es need"} a label.
          </span>
          <a
            href="https://www.paypal.com/activities"
            target="_blank"
            rel="noopener noreferrer"
            className={nextStepLinkClass}
          >
            Buy labels in PayPal ↗
          </a>
          <span>then</span>
          <Link href="/admin/labels" className={nextStepLinkClass}>
            drop the PDFs on Labels →
          </Link>
        </NextStep>
      ) : null}

      {list.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-white/10 p-6 text-center text-neutral-400">
          Nothing to pack — every paid order has its labels.
        </div>
      ) : (
        <div className="mt-4 grid gap-3">
          {list.map((o) => {
            const sel = checked[o.key] ?? [];
            const orderBusy = busy === o.key;
            const invoice = o.invoiceId ? invoiceById.get(o.invoiceId) : undefined;
            const place = [o.shipTo?.city, o.shipTo?.state].filter(Boolean).join(", ");
            return (
              <section
                key={o.key}
                aria-label={`Order for u/${o.buyer}`}
                className="rounded-2xl border border-white/10 bg-white/5 p-4"
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <h2 className="font-medium">u/{o.buyer || "(no buyer)"}</h2>
                  {o.shipTo?.name ? (
                    <span className="text-sm text-neutral-300">
                      {o.shipTo.name}
                      {place ? <span className="text-neutral-500"> · {place}</span> : null}
                    </span>
                  ) : (
                    <span
                      className="text-sm text-neutral-500"
                      title="Check PayPal on the invoice to pull the buyer's address; off-PayPal sales never have one"
                    >
                      no address on file
                    </span>
                  )}
                  {invoice?.paid_at ? (
                    <span className="text-xs text-neutral-500">
                      paid {new Date(invoice.paid_at).toLocaleDateString()}
                    </span>
                  ) : null}
                  <span className="ml-auto text-xs text-neutral-500">
                    {o.loose.length} loose · {o.parcels.length} box
                    {o.parcels.length === 1 ? "" : "es"}
                  </span>
                </div>

                {o.loose.length > 0 ? (
                  <div className="mt-3 rounded-xl border border-white/10 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs text-neutral-400">
                        In the mailer? {o.pulled} / {o.loose.length} pulled
                      </p>
                      <button
                        type="button"
                        onClick={() => checkAll(o)}
                        disabled={orderBusy || sel.length === o.loose.length}
                        className={smallButtonClass}
                      >
                        Check all
                      </button>
                    </div>
                    <ul className="mt-2 divide-y divide-white/5">
                      {o.loose.map((r) => (
                        <li key={r.id}>
                          <PackRow
                            record={r}
                            checked={sel.includes(r.id)}
                            disabled={orderBusy}
                            onChange={(on) => toggle(o, r.id, on)}
                          />
                        </li>
                      ))}
                    </ul>
                    <button
                      type="button"
                      onClick={() => seal(o)}
                      disabled={sel.length === 0 || orderBusy}
                      className={`mt-2 ${buttonClass}`}
                    >
                      {orderBusy
                        ? "Sealing…"
                        : `Seal box (${sel.length} record${sel.length === 1 ? "" : "s"})`}
                    </button>
                  </div>
                ) : null}

                {o.parcels.map((s) => {
                  const boxBusy = busy === `box-${s.id}`;
                  const members = (s.record_ids ?? [])
                    .map((id) => byId.get(id))
                    .filter((r): r is DbRecord => !!r);
                  return (
                    <div
                      key={s.id}
                      className="mt-3 flex flex-wrap items-start gap-x-3 gap-y-1 rounded-xl border border-white/10 p-3"
                    >
                      <span className="font-medium">Box #{s.id}</span>
                      {s.packed_at ? (
                        <span className="text-xs text-emerald-400">
                          sealed {new Date(s.packed_at).toLocaleString()}
                        </span>
                      ) : (
                        <span
                          className="text-xs text-neutral-500"
                          title="Made on the fulfillment card, not sealed here"
                        >
                          parcel
                        </span>
                      )}
                      {s.tracking_code ? (
                        <span className="rounded-full border border-green-500/40 bg-green-500/10 px-2 py-0.5 text-xs text-green-400">
                          {s.tracking_code}
                        </span>
                      ) : (
                        <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-xs text-amber-300">
                          needs label
                        </span>
                      )}
                      {!s.tracking_code && !s.paypal_tracker_id ? (
                        <button
                          type="button"
                          onClick={() => unseal(s)}
                          disabled={boxBusy}
                          className="ml-auto text-xs text-neutral-500 underline underline-offset-2 transition hover:text-white"
                        >
                          {boxBusy ? "Unsealing…" : "Unseal"}
                        </button>
                      ) : null}
                      <ul className="w-full text-sm text-neutral-300">
                        {members.map((r) => (
                          <li key={r.id}>
                            {r.artist} — {r.title}
                          </li>
                        ))}
                        {members.length === 0 ? (
                          <li className="text-neutral-500">No records assigned.</li>
                        ) : null}
                      </ul>
                    </div>
                  );
                })}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function PackRow({
  record: r,
  checked,
  disabled,
  onChange,
}: {
  record: DbRecord;
  checked: boolean;
  disabled: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <label
      className={`flex min-h-[56px] cursor-pointer items-center gap-3 py-2 ${
        checked ? "opacity-60" : ""
      }`}
    >
      <input
        type="checkbox"
        className="admin-checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      {r.cover_image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={r.cover_image}
          alt=""
          loading="lazy"
          className="h-10 w-10 shrink-0 rounded-md bg-white/5 object-cover"
        />
      ) : (
        <span aria-hidden className="h-10 w-10 shrink-0 rounded-md bg-white/5" />
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">
          {r.artist} — {r.title}
        </span>
        <span className="flex flex-wrap items-center gap-1.5 text-xs text-neutral-400">
          {r.pressing ? <span className="truncate">{r.pressing}</span> : null}
          <span>
            {r.media} / {r.sleeve}
          </span>
          {r.picked_at ? (
            <span className="text-emerald-400" title="Pulled from the shelf (pick list)">
              pulled ✓
            </span>
          ) : (
            <span className="text-amber-300" title="Not marked pulled on the pick list">
              not pulled
            </span>
          )}
        </span>
      </span>
    </label>
  );
}
