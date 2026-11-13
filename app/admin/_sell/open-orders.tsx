"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { bundleKindSummary, itemSpecShort } from "@/lib/items";
import type { Invoice } from "@/lib/supabase";
import {
  RECENTLY_PAID_DAYS,
  STALE_INVOICE_HOURS,
  recentlyPaid,
  type OpenOrder,
} from "@/lib/admin/orders";
import { buyerLabel } from "@/lib/admin/buyers";
import { useAdmin } from "../_shell/admin-provider";
import { BuyerField } from "../_shell/buyer-field";
import { MoneyField, NoteField } from "../_shell/inline-fields";
import { usePaypalCheck, paypalInvoiceFetch } from "../_shell/paypal-check";
import { Pill } from "../_shell/primitives";
import { buttonClass, timeAgo, useCopied } from "../_shell/ui";
import { EmailBuyer } from "../_ship/email-buyer";
import type { Desk } from "./use-desk";

const quietButton =
  "text-xs text-neutral-500 underline transition hover:text-red-300 disabled:opacity-50";

// Awaiting payment: orders held or invoiced, not yet paid. This is the
// durable "order in progress": it survives clearing the sale desk, and
// leaves the list once it's paid (it then shows under Just paid and on the
// pick list) or cancelled.
export function AwaitingPayment({ open, desk }: { open: OpenOrder[]; desk: Desk }) {
  const {
    supabase,
    setRecords,
    setInvoices,
    setOrders,
    pushToast,
    copyText,
    markRecordsSold,
    renameBuyer,
    releaseOrder,
    saveOrderCredit,
    updateRecord,
    confirm,
  } = useAdmin();
  const { isCopied, flash } = useCopied();

  // One order busy at a time, keyed by order id, so a slow PayPal call on
  // one card never disables the others.
  const [orderBusy, setOrderBusy] = useState<null | {
    id: number;
    action: "cancel" | "paid" | "release";
  }>(null);

  // A held order whose buyer paid off-PayPal: mark its records sold.
  async function markOrderPaid(o: OpenOrder) {
    if (orderBusy || o.recs.length === 0) return;
    if (
      !(await confirm(
        `Mark ${o.recs.length} record${o.recs.length > 1 ? "s" : ""} sold to ${buyerLabel(o.buyer, o.order.buyer_email, "?")} for $${o.totals.subtotal}${
          o.totals.credit > 0 ? ` less a $${o.totals.credit} credit` : ""
        }? Each record's sold price is set to its agreed price.`,
        "Mark paid"
      ))
    )
      return;
    setOrderBusy({ id: o.order.id, action: "paid" });
    try {
      await markRecordsSold(o.recs, o.buyer);
    } finally {
      setOrderBusy(null);
    }
  }

  // Release a held order: the records go back on the shop. A hold that
  // has already run out put them back by itself, so there's nothing to
  // ask about — one click clears the order away.
  async function releaseHeldOrder(o: OpenOrder) {
    if (orderBusy) return;
    if (
      !o.expired &&
      !(await confirm(
        `Release ${o.recs.length} record${o.recs.length === 1 ? "" : "s"} held for ${buyerLabel(o.buyer, o.order.buyer_email, "?")}? They go back on the shop immediately.`,
        "Release hold"
      ))
    )
      return;
    setOrderBusy({ id: o.order.id, action: "release" });
    try {
      await releaseOrder(o.order);
    } finally {
      setOrderBusy(null);
    }
  }

  async function copyPendingLink(inv: Invoice) {
    if (!inv.recipient_view_url) return;
    if (await copyText(inv.recipient_view_url, "Copy the payment link")) {
      flash(`pending-${inv.paypal_invoice_id}`);
    }
  }

  // Asking PayPal about an invoice is the shell's job (paypal-check.tsx):
  // it runs by itself whichever page the admin opens on, and these buttons
  // share its one-at-a-time lock.
  const { checkInvoice, checkAllInvoices, checkingAll, checkingOrderId } = usePaypalCheck();
  const hasInvoiced = open.some(
    (o) => o.order.status === "invoiced" && !!o.order.paypal_invoice_id
  );

  function checkOrderInvoice(o: OpenOrder) {
    if (orderBusy || checkingAll || checkingOrderId != null) return;
    void checkInvoice(o);
  }

  // Cancel on PayPal, end the order, and put the records back on the shelf.
  async function cancelOrderInvoice(o: OpenOrder) {
    const id = o.order.paypal_invoice_id;
    if (!id || orderBusy) return;
    if (
      !(await confirm(
        `Cancel invoice ${id}${o.buyer ? ` for ${buyerLabel(o.buyer, o.order.buyer_email)}` : ""} on PayPal and release ${o.recs.length} record${o.recs.length === 1 ? "" : "s"}? The buyer's payment link stops working.`,
        "Cancel invoice"
      ))
    )
      return;
    setOrderBusy({ id: o.order.id, action: "cancel" });
    try {
      const body = await paypalInvoiceFetch(supabase, id, "DELETE");
      const released = new Set<number>(body.releasedIds ?? []);
      const cancelled = new Set<number>([
        o.order.id,
        ...((body.cancelledOrderIds ?? []) as number[]),
      ]);
      const now = new Date().toISOString();
      setInvoices((prev) =>
        prev.map((i) =>
          i.paypal_invoice_id === id
            ? { ...i, status: "CANCELLED", cancelled_at: now, updated_at: now }
            : i
        )
      );
      setRecords((prev) =>
        prev.map((r) =>
          released.has(r.id)
            ? {
                ...r,
                paypal_invoice_id: null,
                hold_buyer: null,
                hold_until: null,
                order_id: null,
              }
            : r
        )
      );
      setOrders((prev) =>
        prev.map((x) =>
          cancelled.has(x.id) && x.status !== "paid" ? { ...x, status: "cancelled" } : x
        )
      );
      pushToast(
        "success",
        `Invoice ${id} cancelled — ${released.size} record${released.size === 1 ? "" : "s"} released.`
      );
    } catch (e) {
      pushToast("error", e instanceof Error ? e.message : "Cancel failed");
    } finally {
      setOrderBusy(null);
    }
  }

  if (open.length === 0) return null;

  return (
    <section aria-labelledby="open-orders" className="mt-10">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="open-orders" className="scroll-mt-24 text-xl font-medium">
          Awaiting payment{" "}
          <span className="text-sm text-neutral-400">({open.length})</span>
        </h2>
        {hasInvoiced ? (
          <button
            type="button"
            className={buttonClass}
            disabled={checkingAll || !!orderBusy || checkingOrderId != null}
            onClick={() => checkAllInvoices()}
            title="Ask PayPal about every invoiced order, one after another. Paid ones are marked sold and go to the pick list."
          >
            {checkingAll ? "Checking…" : "Check all PayPal"}
          </button>
        ) : null}
      </div>
      <p className="mt-1 text-sm text-neutral-400">
        Held or invoiced, not yet paid — the ones that need you first: lapsed
        holds, then the longest-unpaid invoices. Opening the admin checks
        PayPal by itself; a paid invoice is marked sold and goes to the pick
        list.
      </p>
      <div className="mt-3 grid gap-3">
        {open.map((o) => {
          const order = o.order;
          const inv = o.invoice;
          const invoiceId = order.paypal_invoice_id;
          const invoiced = order.status === "invoiced";
          const busy =
            checkingOrderId === order.id
              ? "check"
              : orderBusy?.id === order.id
                ? orderBusy.action
                : null;
          const anyBusy = !!orderBusy || checkingAll || checkingOrderId != null;
          const hoursLeft = Math.round((o.holdUntil - Date.now()) / 3600000);
          const invStatus = (inv?.status ?? "SENT").toLowerCase();
          return (
            <div
              key={order.id}
              className={`rounded-2xl border bg-white/5 p-4 ${
                invoiced ? "border-emerald-500/30" : "border-amber-400/30"
              }`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <BuyerField
                  value={o.buyer}
                  email={o.order.buyer_email}
                  disabled={anyBusy}
                  onSave={(next) => renameBuyer(order, next)}
                />
                {invoiced ? (
                  <Pill tone={invStatus === "draft" ? "neutral" : "green"}>
                    invoice {invStatus}
                  </Pill>
                ) : (
                  <Pill tone="amber">{o.expired ? "hold expired" : "on hold"}</Pill>
                )}
                {invoiceId ? (
                  <span className="font-mono text-xs text-neutral-500">{invoiceId}</span>
                ) : null}
                {o.stale ? (
                  <span
                    title={`Invoiced more than ${STALE_INVOICE_HOURS}h ago and still unpaid — nudge the buyer, or cancel the invoice to put the records back on the shop`}
                  >
                    <Pill tone="amber">unpaid · sent {timeAgo(order.created_at)}</Pill>
                  </span>
                ) : null}
                <span className="ml-auto text-xs text-neutral-500">
                  {timeAgo(order.created_at)}
                  {invoiced
                    ? " · held until paid"
                    : o.holdUntil > Date.now()
                      ? ` · ~${hoursLeft}h hold left`
                      : ""}
                </span>
              </div>
              {o.expired ? (
                <p className="mt-2 text-xs text-amber-400">
                  The hold ran out, so these are back on the shop. Release
                  clears the order away; load it into the desk to hold or
                  invoice again.
                </p>
              ) : null}
              {o.recs.length === 0 ? (
                <p className="mt-3 text-sm text-amber-400">
                  No records left on this order — they were sold or moved
                  elsewhere. Cancel the invoice, or Check PayPal to close it
                  as paid.
                </p>
              ) : (
                <>
                  <ul className="mt-3 space-y-1 text-sm">
                    {o.recs.map((r) => {
                      const agreed =
                        r.negotiated_price != null
                          ? Number(r.negotiated_price)
                          : Number(r.price);
                      const dealt = agreed !== Number(r.price);
                      return (
                        <li key={r.id} className="flex flex-wrap items-center gap-2">
                          <span className="min-w-0 flex-1">
                            {r.artist} — {r.title}{" "}
                            <span className="text-neutral-500">{itemSpecShort(r)}</span>
                          </span>
                          {invoiced ? (
                            <span>
                              {dealt ? (
                                <span className="mr-1 text-xs text-neutral-500 line-through">
                                  ${r.price}
                                </span>
                              ) : null}
                              ${agreed}
                            </span>
                          ) : (
                            <>
                              {dealt ? (
                                <span className="text-xs text-neutral-500 line-through">
                                  ${r.price}
                                </span>
                              ) : null}
                              <MoneyField
                                value={r.negotiated_price ?? null}
                                placeholder={String(r.price)}
                                disabled={anyBusy}
                                title="Negotiated price for this sale — blank keeps the listed price"
                                onSave={(next) =>
                                  updateRecord(r.id, {
                                    negotiated_price:
                                      next != null && next !== Number(r.price) ? next : null,
                                  })
                                }
                              />
                            </>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                    <span className="text-neutral-400">Credit</span>
                    {invoiced ? (
                      <span className="text-neutral-300">
                        {o.totals.credit > 0
                          ? `−$${o.totals.credit}${order.credit_note ? ` (${order.credit_note})` : ""}`
                          : "none"}
                      </span>
                    ) : (
                      <>
                        <MoneyField
                          value={Number(order.credit ?? 0) > 0 ? Number(order.credit) : null}
                          placeholder="0"
                          disabled={anyBusy}
                          title="Taken off the whole order — shows on the PayPal invoice as a discount line"
                          onSave={(next) =>
                            saveOrderCredit(order, next ?? 0, order.credit_note ?? "")
                          }
                        />
                        <NoteField
                          value={order.credit_note ?? ""}
                          placeholder="reason"
                          disabled={anyBusy}
                          onSave={(next) =>
                            saveOrderCredit(order, Number(order.credit ?? 0), next)
                          }
                        />
                      </>
                    )}
                  </div>
                  <p className="mt-2 text-sm text-neutral-400">
                    Subtotal ${o.totals.subtotal}
                    {o.totals.credit > 0 ? ` · Credit −$${o.totals.credit}` : ""} · Shipping $
                    {o.totals.shipping} ·{" "}
                    <span className="font-medium text-white">
                      Total ${inv?.total ?? o.totals.total}
                    </span>
                  </p>
                </>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {invoiced ? (
                  <>
                    {inv?.recipient_view_url ? (
                      <>
                        <button
                          type="button"
                          className={buttonClass}
                          onClick={() => copyPendingLink(inv)}
                        >
                          {isCopied(`pending-${invoiceId}`) ? "Copied!" : "Copy payment link"}
                        </button>
                        <a
                          href={inv.recipient_view_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-neutral-400 underline hover:text-white"
                        >
                          Open ↗
                        </a>
                      </>
                    ) : (
                      <span className="text-xs text-neutral-500">
                        No payment link saved — Check PayPal fetches it.
                      </span>
                    )}
                    <button
                      type="button"
                      className={buttonClass}
                      disabled={anyBusy}
                      onClick={() => checkOrderInvoice(o)}
                    >
                      {busy === "check" ? "Checking…" : "Check PayPal"}
                    </button>
                    {o.recs.length > 0 ? (
                      <button
                        type="button"
                        className={buttonClass}
                        onClick={() => desk.loadOrder(o)}
                      >
                        Load into sale desk
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className={quietButton}
                      disabled={anyBusy}
                      onClick={() => cancelOrderInvoice(o)}
                    >
                      {busy === "cancel" ? "Cancelling…" : "Cancel invoice"}
                    </button>
                  </>
                ) : o.expired ? (
                  <>
                    <button
                      type="button"
                      className={buttonClass}
                      disabled={anyBusy}
                      title="Clear this lapsed order away — its records are already back on the shop"
                      onClick={() => releaseHeldOrder(o)}
                    >
                      {busy === "release" ? "Releasing…" : "Release"}
                    </button>
                    <button
                      type="button"
                      className={buttonClass}
                      onClick={() => desk.loadOrder(o)}
                    >
                      Load into sale desk
                    </button>
                    <button
                      type="button"
                      className={quietButton}
                      disabled={anyBusy}
                      title="The buyer paid outside PayPal — mark the records sold to them"
                      onClick={() => markOrderPaid(o)}
                    >
                      {busy === "paid" ? "Saving…" : "Mark paid"}
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className={buttonClass}
                      onClick={() => desk.loadOrder(o)}
                    >
                      Load into sale desk
                    </button>
                    <button
                      type="button"
                      className={buttonClass}
                      disabled={anyBusy}
                      title="The buyer paid outside PayPal — mark the records sold to them"
                      onClick={() => markOrderPaid(o)}
                    >
                      {busy === "paid" ? "Saving…" : "Mark paid"}
                    </button>
                    <button
                      type="button"
                      className={quietButton}
                      disabled={anyBusy}
                      onClick={() => releaseHeldOrder(o)}
                    >
                      {busy === "release" ? "Releasing…" : "Release"}
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// Just paid: where an order lands when the Sell page's job is done. It's
// on the pick list now; a buyer who came in by email can be told their
// payment arrived, right here, without a trip to the Ship pages.
export function JustPaid() {
  const { orders, records } = useAdmin();
  const paid = useMemo(() => recentlyPaid(orders, records), [orders, records]);
  if (paid.length === 0) return null;
  return (
    <section aria-labelledby="just-paid" className="mt-10">
      <h2 id="just-paid" className="scroll-mt-24 text-xl font-medium">
        Just paid <span className="text-sm text-neutral-400">({paid.length})</span>
      </h2>
      <p className="mt-1 text-sm text-neutral-400">
        Paid in the last {RECENTLY_PAID_DAYS} days and on the{" "}
        <Link href="/admin/pick" className="underline underline-offset-2 hover:text-white">
          pick list
        </Link>
        . Email buyers can get a &ldquo;payment received&rdquo; note from here.
      </p>
      <ul className="mt-3 divide-y divide-white/10 rounded-2xl border border-white/10 bg-white/5">
        {paid.map((p) => (
          <li key={p.order.id} className="flex flex-wrap items-center gap-2 px-4 py-3 text-sm">
            <span className="font-medium text-white">
              {buyerLabel(p.buyer, p.order.buyer_email)}
            </span>
            <Pill tone="green">paid {timeAgo(p.paidAt)}</Pill>
            <span
              className="min-w-0 flex-1 truncate text-neutral-400"
              title={p.recs.map((r) => `${r.artist} — ${r.title}`).join("\n")}
            >
              {bundleKindSummary(p.recs)} ·{" "}
              {p.recs.map((r) => `${r.artist} — ${r.title}`).join(", ")}
            </span>
            {p.order.buyer_email ? (
              <EmailBuyer
                order={p.order}
                email={p.order.buyer_email}
                buyer={p.buyer}
                records={p.recs}
                paid
              />
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
