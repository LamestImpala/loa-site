"use client";

import { useMemo, useState } from "react";
import { bundleBreakdown } from "@/lib/records";
import { bundleKindSummary, itemSpecShort } from "@/lib/items";
import type { DbRecord, Invoice } from "@/lib/supabase";
import { recordFlags } from "@/lib/order-parse";
import { HOLD_HOURS, holdExpiry, liveInvoiceOn, requestForOrder } from "@/lib/admin/orders";
import { parseMoney, saleItem, saleReplyText } from "@/lib/admin/sales";
import { buyerLabel } from "@/lib/admin/buyers";
import { DEFAULT_FILTERS, filterRecords } from "@/lib/admin/catalog-filter";
import type { PhotoAttachment } from "@/lib/admin/attachments";
import { useAdmin } from "../_shell/admin-provider";
import { PhotoPicker } from "../_shell/photo-picker";
import { buttonClass, inputClass, useCopied } from "../_shell/ui";
import { PasteDm, type PasteDmState } from "./paste-dm";
import type { Desk } from "./use-desk";

const SEARCH_RESULTS = 8;

// The sale desk: always on the Sell page, where a sale is put together —
// the records, each one's agreed price, a credit, the buyer — and then
// quoted, held, invoiced or marked sold. It fills from a conversation, an
// order awaiting payment, a pasted DM, the Catalog, or its own search.
export function SaleDesk({ desk, paste }: { desk: Desk; paste: PasteDmState }) {
  const {
    supabase,
    records,
    setRecords,
    orders,
    orderRequests,
    sendShopEmail,
    loadData,
    pushToast,
    copyText,
    upsertInvoiceLocal,
    markRecordsSold,
    placeOrder,
    applyPlacedOrder,
    saleIds,
    saleBuyer,
    setSaleBuyer,
    saleEmail,
    setSaleEmail,
    saleChannel,
    setSaleChannel,
    salePrices,
    setSalePrices,
    saleCredit,
    setSaleCredit,
    saleCreditNote,
    setSaleCreditNote,
    saleGearShipping,
    setSaleGearShipping,
    clearSaleDesk,
    confirm,
  } = useAdmin();

  const [saleBusy, setSaleBusy] = useState<
    null | "hold" | "sold" | "invoice" | "email"
  >(null);
  // Photos riding along with the desk's emailed breakdown.
  const [salePhotos, setSalePhotos] = useState<PhotoAttachment[]>([]);
  const [saleShowPhotos, setSaleShowPhotos] = useState(false);
  // What the last invoice attempt said. Tied to the records it was for
  // (`key`), so it disappears by itself once the desk holds something else.
  const [saleStatus, setSaleStatus] = useState<null | { key: string; text: string }>(null);
  const [saleInvoice, setSaleInvoice] = useState<null | {
    key: string;
    id: string;
    url: string | null;
    status: string;
    warning?: string;
  }>(null);
  // Which copy button just fired: "reply" or "invoice-link".
  const { isCopied, flash } = useCopied();

  // From records, in catalog order — and still there if a filter elsewhere hides them.
  const selectedRecords = useMemo(
    () => records.filter((r) => saleIds.has(r.id)),
    [records, saleIds]
  );
  const saleRecords = useMemo(
    () => selectedRecords.filter((r) => !r.sold),
    [selectedRecords]
  );
  const deskKey = useMemo(
    () => saleRecords.map((r) => r.id).join(","),
    [saleRecords]
  );
  // What each record sells for at the desk: the typed price, else the
  // listed price. The desk is the source of truth while a record is on it
  // — a cleared box means "back to the listed price", even for a record
  // that carries a negotiated price from its held order.
  const deskPrices = useMemo(() => {
    const m = new Map<number, number>();
    for (const r of saleRecords) {
      const typed = parseMoney(salePrices[r.id] ?? "");
      m.set(r.id, typed == null ? Number(r.price) : typed);
    }
    return m;
  }, [saleRecords, salePrices]);
  const badPriceCount = saleRecords.filter(
    (r) => parseMoney(salePrices[r.id] ?? "") === undefined
  ).length;
  const creditParsed = parseMoney(saleCredit);
  const deskCredit = creditParsed ?? 0;
  // Equipment ships at a quoted rate the desk types in; the shop charged
  // $0 for it on the request. It rides on top of the per-kind shipping.
  const gearParsed = parseMoney(saleGearShipping);
  const deskGear = gearParsed ?? 0;
  const saleTotals = useMemo(() => {
    const b = bundleBreakdown(
      saleRecords.map((r) => saleItem(r, deskPrices.get(r.id))),
      deskCredit
    );
    if (!b.gearQuoted || deskGear === 0) return b;
    const q = b.shippingQuote;
    const parts = [
      q.counts.record > 0 ? (q.records === 0 ? "free on 3+ records" : `$${q.records} records`) : "",
      q.counts.poster > 0 ? `$${q.posters} poster tube` : "",
      `$${deskGear} equipment`,
    ].filter(Boolean);
    return {
      ...b,
      shipping: b.shipping + deskGear,
      total: b.total + deskGear,
      shippingDetail: parts.length > 1 ? parts.join(" + ") : "",
      shippingNote: null,
    };
  }, [saleRecords, deskPrices, deskCredit, deskGear]);
  const creditTooBig = deskCredit > saleTotals.subtotal;
  const termsError =
    badPriceCount > 0
      ? `${badPriceCount} negotiated price${badPriceCount === 1 ? " isn't" : "s aren't"} a valid amount.`
      : creditParsed === undefined
        ? "The credit isn't a valid amount."
        : gearParsed === undefined
          ? "The equipment shipping isn't a valid amount."
          : creditTooBig
            ? `A $${deskCredit} credit is more than the $${saleTotals.subtotal} subtotal.`
            : "";
  // A desk record already on a live PayPal invoice: holding would cut its
  // until-paid hold to 48h, and a second invoice would orphan the first.
  // Mark sold stays open (paid some other way).
  const deskInvoice = useMemo(
    () => liveInvoiceOn(saleRecords, new Map(orders.map((o) => [o.id, o]))),
    [saleRecords, orders]
  );
  // What the desk hands to the writes: every record's agreed price and the
  // credit with its reason.
  const saleTerms = useMemo(
    () => ({
      prices: deskPrices,
      credit: deskCredit,
      creditNote: saleCreditNote.trim(),
      gearShipping: deskGear,
    }),
    [deskPrices, deskCredit, saleCreditNote, deskGear]
  );
  const soldOnDesk = useMemo(
    () => selectedRecords.filter((r) => r.sold),
    [selectedRecords]
  );
  const empty = saleRecords.length === 0;

  function setSalePrice(id: number, raw: string) {
    setSalePrices((prev) => ({ ...prev, [id]: raw }));
  }
  function clearDesk() {
    clearSaleDesk();
    setSaleStatus(null);
    setSaleInvoice(null);
    setSalePhotos([]);
    setSaleShowPhotos(false);
  }

  // --- Add a record: search the unsold catalog ---
  const [query, setQuery] = useState("");
  const results = useMemo(() => {
    if (query.trim().length < 2) return [] as DbRecord[];
    return filterRecords(
      records,
      { ...DEFAULT_FILTERS, search: query, sold: "unsold" },
      { interest: {}, market: {} }
    )
      .filter((r) => !saleIds.has(r.id))
      .slice(0, SEARCH_RESULTS);
  }, [records, query, saleIds]);

  function addResult(r: DbRecord) {
    desk.addToDesk(r.id);
    setQuery("");
  }

  // An email buyer on the desk: their order carries the address, the label
  // drops the u/, and replies can go out as orders@ from here.
  const deskEmail = saleChannel === "email" ? saleEmail.trim() || null : null;
  // The saved request these desk records came from, for the ref code in
  // an emailed reply's subject.
  const deskRequest = useMemo(
    () => requestForOrder(saleRecords.map((r) => r.id), orderRequests),
    [saleRecords, orderRequests]
  );

  function saleReply() {
    return saleReplyText({
      buyer: saleBuyer,
      email: deskEmail,
      lines: saleTotals.lines,
      subtotal: saleTotals.subtotal,
      credit: saleTotals.credit,
      creditNote: saleCreditNote,
      shipping: saleTotals.shipping,
      shippingDetail: saleTotals.shippingDetail,
      shippingNote: saleTotals.shippingNote,
      total: saleTotals.total,
    });
  }

  async function copySaleReply() {
    if (empty) return;
    if (await copyText(saleReply(), "Copy this reply")) flash("reply");
  }

  async function emailSaleReply() {
    if (!deskEmail || empty || saleBusy) return;
    setSaleBusy("email");
    try {
      const ok = await sendShopEmail({
        to: deskEmail,
        subject: deskRequest
          ? `Your record request (Ref ${deskRequest.ref_code})`
          : "Your record request",
        text: saleReply(),
        requestId: deskRequest?.id ?? null,
        attachments: salePhotos.map(({ url, filename }) => ({ url, filename })),
      });
      if (ok) {
        const n = salePhotos.length;
        pushToast(
          "success",
          `Reply emailed to ${deskEmail}${n ? ` with ${n} photo${n === 1 ? "" : "s"}` : ""} ✓`
        );
        setSalePhotos([]);
        setSaleShowPhotos(false);
      }
    } finally {
      setSaleBusy(null);
    }
  }

  async function holdSelected() {
    const buyer = saleBuyer.trim().replace(/^u\//, "");
    const ids = saleRecords.map((r) => r.id);
    if (!buyer || ids.length === 0 || saleBusy || termsError || deskInvoice) return;
    setSaleBusy("hold");
    // The order is the durable home for the hold (and the credit); the
    // records point at it and carry their negotiated prices.
    const placed = await placeOrder(saleRecords, buyer, "held", {
      credit: saleTerms.credit,
      credit_note: saleTerms.creditNote,
      ...(deskEmail ? { buyer_email: deskEmail } : {}),
    });
    if (!placed) {
      setSaleBusy(null);
      return;
    }
    const hold = {
      hold_buyer: buyer,
      hold_until: holdExpiry(),
    };
    const negotiated = (r: DbRecord) => {
      const agreed = deskPrices.get(r.id) ?? Number(r.price);
      return agreed !== Number(r.price) ? agreed : null;
    };
    const results = await Promise.all(
      saleRecords.map((r) =>
        supabase
          .from("records")
          .update({
            ...hold,
            negotiated_price: negotiated(r),
            updated_at: new Date().toISOString(),
          })
          .eq("id", r.id)
      )
    );
    setSaleBusy(null);
    const error = results.find((x) => x.error)?.error;
    if (error) {
      pushToast("error", `Hold failed: ${error.message}`);
      return;
    }
    const byRecord = new Map(saleRecords.map((r) => [r.id, negotiated(r)]));
    setRecords((prev) =>
      prev.map((r) =>
        byRecord.has(r.id)
          ? { ...r, ...hold, negotiated_price: byRecord.get(r.id) ?? null }
          : r
      )
    );
    pushToast(
      "success",
      `Held ${ids.length} record${ids.length === 1 ? "" : "s"} for ${HOLD_HOURS}h ✓ — listed under Awaiting payment.`
    );
  }

  async function markSelectedSold() {
    const buyer = saleBuyer.trim().replace(/^u\//, "");
    const targets = saleRecords;
    if (targets.length === 0 || saleBusy || termsError) return;
    if (
      !(await confirm(
        `Mark ${targets.length} record${targets.length > 1 ? "s" : ""} sold${buyer ? ` to ${buyerLabel(buyer, deskEmail)}` : ""} for $${saleTotals.subtotal}${
          saleTotals.credit > 0 ? ` less a $${saleTotals.credit} credit` : ""
        }? Each record's sold price is set to its agreed price.`,
        "Mark sold"
      ))
    )
      return;
    setSaleBusy("sold");
    try {
      const sold = await markRecordsSold(targets, buyer, {
        ...saleTerms,
        buyerEmail: deskEmail,
      });
      // The sale is made and on the pick list: the desk is free for the next.
      if (sold) clearDesk();
    } finally {
      setSaleBusy(null);
    }
  }

  async function createInvoice() {
    const buyer = saleBuyer.trim().replace(/^u\//, "");
    const targets = saleRecords;
    if (!buyer || targets.length === 0 || saleBusy || termsError || deskInvoice) return;
    const key = deskKey;
    setSaleBusy("invoice");
    setSaleStatus(null);
    setSaleInvoice(null);
    try {
      const {
        data: { session: current },
      } = await supabase.auth.getSession();
      const res = await fetch("/api/paypal-invoice", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${current?.access_token ?? ""}`,
        },
        body: JSON.stringify({
          ids: targets.map((r) => r.id),
          buyer,
          email: saleEmail.trim() || undefined,
          channel: saleChannel,
          prices: Object.fromEntries(deskPrices),
          credit: saleTerms.credit,
          creditNote: saleTerms.creditNote,
          gearShipping: saleTerms.gearShipping,
        }),
      });
      const body = await res.json();
      if (res.status === 409 && body.invoiceId) {
        setSaleStatus({ key, text: body.error });
        return;
      }
      if (res.status === 409) {
        setSaleStatus({
          key,
          text: `Already sold: ${(body.soldIds ?? []).join(", ")} — refreshing records…`,
        });
        await loadData();
        return;
      }
      if (!res.ok) {
        setSaleStatus({ key, text: body.error || "Invoice failed" });
        return;
      }
      setSaleInvoice({
        key,
        id: body.invoiceId,
        url: body.recipientViewUrl,
        status: body.status,
        warning: body.warning,
      });
      // The route stamps paypal_invoice_id + an until-resolved hold on the
      // records — mirror it locally so the Awaiting payment card and the
      // fulfillment panel link up without a reload, but only when the
      // stamp actually landed (otherwise the panel would show a link that
      // vanishes on reload).
      if (body.invoiceStamped !== false) {
        const invoicedIds = new Set(targets.map((r) => r.id));
        setRecords((prev) =>
          prev.map((r) => {
            if (!invoicedIds.has(r.id)) return r;
            const agreed = deskPrices.get(r.id) ?? Number(r.price);
            return {
              ...r,
              paypal_invoice_id: body.invoiceId,
              hold_buyer: buyer,
              hold_until: body.holdUntil ?? r.hold_until,
              negotiated_price: agreed !== Number(r.price) ? agreed : null,
            };
          })
        );
      }
      // The saved invoice row keeps the payment link after Clear.
      if (body.invoice) upsertInvoiceLocal(body.invoice as Invoice);
      // The route put the records in an order (invoiced) — mirror it so
      // the Awaiting payment card appears without a reload.
      if (body.placed) applyPlacedOrder(body.placed);
    } catch {
      setSaleStatus({ key, text: "Request failed" });
    } finally {
      setSaleBusy(null);
    }
  }

  async function copyInvoiceLink() {
    if (!saleInvoice?.url) return;
    if (await copyText(saleInvoice.url, "Copy the payment link")) flash("invoice-link");
  }

  const status = saleStatus?.key === deskKey ? saleStatus.text : "";
  const invoice = saleInvoice?.key === deskKey ? saleInvoice : null;

  return (
    <section
      id="sale-desk"
      aria-label="Sale desk"
      className={`scroll-mt-24 rounded-2xl border bg-neutral-950 p-4 ${
        empty ? "border-white/10" : "border-amber-400/30"
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-medium">Sale desk</h2>
        {saleIds.size > 0 || saleBuyer || saleEmail ? (
          <button
            type="button"
            onClick={clearDesk}
            title="Take everything off the desk — records, buyer and terms. Holds and invoices already made stay under Awaiting payment."
            className="text-xs text-neutral-500 underline transition hover:text-white"
          >
            Clear
          </button>
        ) : null}
      </div>

      {/* Add a record */}
      <div className="relative mt-3">
        <div className="flex gap-2">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && results[0]) {
                e.preventDefault();
                addResult(results[0]);
              } else if (e.key === "Escape") setQuery("");
            }}
            placeholder="Add a record — artist, title, pressing…"
            aria-label="Search the catalog to add a record to the sale desk"
            className={`min-w-0 flex-1 ${inputClass}`}
          />
          <button
            type="button"
            className={buttonClass}
            aria-expanded={paste.open}
            onClick={() => paste.setOpen((v) => !v)}
            title="Fill the desk from a buyer's Reddit DM or email text"
          >
            Paste a DM
          </button>
        </div>
        {query.trim().length >= 2 ? (
          <ul className="mt-2 divide-y divide-white/5 overflow-hidden rounded-xl border border-white/10 text-sm">
            {results.length === 0 ? (
              <li className="px-3 py-2 text-neutral-400">
                Nothing unsold matches &ldquo;{query.trim()}&rdquo;.
              </li>
            ) : (
              results.map((r, i) => {
                const flags = [
                  ...recordFlags(r),
                  ...(r.listed ? [] : ["hidden from the shop"]),
                ];
                return (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => addResult(r)}
                      className={`flex w-full flex-wrap items-baseline gap-x-2 px-3 py-2 text-left transition hover:bg-white/10 ${
                        i === 0 ? "bg-white/5" : ""
                      }`}
                    >
                      <span className="min-w-0 flex-1">
                        {r.artist} — {r.title}{" "}
                        <span className="text-neutral-500">{itemSpecShort(r)}</span>
                        {flags.length > 0 ? (
                          <span className="text-amber-400"> · {flags.join(" · ")}</span>
                        ) : null}
                      </span>
                      <span className="text-neutral-300">${r.price}</span>
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        ) : null}
      </div>
      {/* Always here, so an old link to #paste-dm still lands on the desk. */}
      <div id="paste-dm" className="scroll-mt-24">
        {paste.open ? <PasteDm paste={paste} desk={desk} /> : null}
      </div>

      {soldOnDesk.length > 0 ? (
        <p className="mt-3 text-xs text-amber-400">
          {soldOnDesk.length} record{soldOnDesk.length === 1 ? "" : "s"} on the desk{" "}
          {soldOnDesk.length === 1 ? "has" : "have"} already sold and{" "}
          {soldOnDesk.length === 1 ? "is" : "are"} left out.{" "}
          <button
            type="button"
            className="underline hover:text-amber-200"
            onClick={() => desk.removeFromDesk(soldOnDesk.map((r) => r.id))}
          >
            Take {soldOnDesk.length === 1 ? "it" : "them"} off
          </button>
        </p>
      ) : null}

      {empty ? (
        <p className="mt-3 rounded-xl border border-dashed border-white/10 px-3 py-4 text-center text-sm text-neutral-400">
          Nothing on the desk. Search for a record above, load a request or an
          order from the list, or paste a buyer&rsquo;s DM.
        </p>
      ) : (
        <>
          <p className="mt-3 text-sm text-white">
            <span className="font-medium">{bundleKindSummary(saleRecords)}</span>{" "}
            <span className="text-neutral-400">
              · Subtotal ${saleTotals.subtotal}
              {saleTotals.credit > 0 ? ` · Credit −$${saleTotals.credit}` : ""} ·
              Shipping ${saleTotals.shipping}
              {saleTotals.shippingDetail
                ? ` (${saleTotals.shippingDetail})`
                : saleTotals.shipping === 0 && !saleTotals.gearQuoted
                  ? " (free)"
                  : ""}{" "}
              ·{" "}
            </span>
            <span className="font-semibold">Total ${saleTotals.total}</span>
          </p>
          {/* Per-record agreed prices: blank = listed. The listed price
              stays put; a lower agreed price shows on the invoice as a
              discount off it. */}
          <ul className="mt-3 max-h-56 space-y-1 overflow-y-auto pr-1 text-sm">
            {saleRecords.map((r) => {
              const agreed = deskPrices.get(r.id) ?? Number(r.price);
              const bad = parseMoney(salePrices[r.id] ?? "") === undefined;
              return (
                <li key={r.id} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate" title={`${r.artist} — ${r.title}`}>
                    {r.artist} — {r.title}{" "}
                    <span className="text-neutral-500">{itemSpecShort(r)}</span>
                  </span>
                  <span
                    className={`text-xs ${
                      agreed !== Number(r.price)
                        ? "text-neutral-500 line-through"
                        : "text-neutral-400"
                    }`}
                  >
                    ${r.price}
                  </span>
                  <span className="inline-flex items-center gap-0.5">
                    <span className="text-xs text-neutral-500">$</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={salePrices[r.id] ?? ""}
                      onChange={(e) => setSalePrice(r.id, e.target.value)}
                      placeholder={String(r.price)}
                      aria-label={`Agreed price for ${r.artist} — ${r.title}`}
                      title="Negotiated price for this sale — blank keeps the listed price. The invoice shows the listed price with the difference as a discount."
                      className={`w-16 px-2 py-1 ${inputClass} ${bad ? "border-red-400/60" : ""}`}
                    />
                  </span>
                  <button
                    type="button"
                    onClick={() => desk.removeFromDesk([r.id])}
                    aria-label={`Take ${r.artist} — ${r.title} off the desk`}
                    title="Take off the desk"
                    className="px-1 text-neutral-500 transition hover:text-white"
                  >
                    ×
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-neutral-400">Credit</span>
            <span className="inline-flex items-center gap-0.5">
              <span className="text-xs text-neutral-500">$</span>
              <input
                type="text"
                inputMode="decimal"
                value={saleCredit}
                onChange={(e) => setSaleCredit(e.target.value)}
                placeholder="0"
                aria-label="Credit off the whole order"
                title="Taken off the whole order — a make-good for an unavailable record, or a bundle deal. Shows on the PayPal invoice as a discount line; the reason goes in the note to the buyer."
                className={`w-16 px-2 py-1 ${inputClass} ${
                  creditParsed === undefined || creditTooBig ? "border-red-400/60" : ""
                }`}
              />
            </span>
            <input
              type="text"
              value={saleCreditNote}
              onChange={(e) => setSaleCreditNote(e.target.value)}
              placeholder="reason (goes in the invoice note)"
              aria-label="Reason for the credit"
              className={`min-w-0 flex-1 px-2 py-1 ${inputClass}`}
            />
          </div>
          {saleTotals.gearQuoted ? (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
              <span className="text-neutral-400">Equipment shipping</span>
              <span className="inline-flex items-center gap-0.5">
                <span className="text-xs text-neutral-500">$</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={saleGearShipping}
                  onChange={(e) => setSaleGearShipping(e.target.value)}
                  placeholder="0"
                  aria-label="Equipment shipping"
                  title="What you quoted the buyer to ship the equipment (the shop charged $0 on the request). Added to the invoice's shipping. Leave blank for local pickup."
                  className={`w-16 px-2 py-1 ${inputClass} ${gearParsed === undefined ? "border-red-400/60" : ""}`}
                />
              </span>
              <span className="text-xs text-neutral-500">blank = local pickup</span>
            </div>
          ) : null}
          {termsError ? <p className="mt-2 text-xs text-red-400">{termsError}</p> : null}
          {deskInvoice ? (
            <p className="mt-2 text-xs text-amber-300">
              On PayPal invoice {deskInvoice} — held until it&apos;s paid or
              cancelled. To change the deal, cancel it under Awaiting payment
              first, then hold or invoice again.
            </p>
          ) : null}
        </>
      )}

      {/* The buyer — typed any time, even before the records are on. */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setSaleChannel((c) => (c === "email" ? "reddit" : "email"))}
          title={
            saleChannel === "email"
              ? "Email buyer — their name and email go on the order. Click for a Reddit buyer."
              : "Reddit buyer. Click if this buyer wrote in by email instead."
          }
          className="rounded-full border border-white/15 px-2 py-0.5 text-xs text-neutral-400 transition hover:border-white/40 hover:text-white"
        >
          {saleChannel === "email" ? "email" : "u/"}
        </button>
        <input
          type="text"
          value={saleBuyer}
          onChange={(e) => setSaleBuyer(e.target.value)}
          placeholder={saleChannel === "email" ? "buyer name" : "reddit buyer"}
          aria-label="Buyer"
          className={`w-32 min-w-0 flex-1 ${inputClass}`}
        />
        <input
          type="email"
          value={saleEmail}
          onChange={(e) => setSaleEmail(e.target.value)}
          placeholder={saleChannel === "email" ? "buyer email" : "PayPal email (optional)"}
          aria-label={saleChannel === "email" ? "Buyer email" : "PayPal email"}
          className={`w-44 min-w-0 flex-1 ${inputClass}`}
        />
      </div>

      {empty ? null : (
        <>
          {deskEmail && saleShowPhotos ? (
            <PhotoPicker records={saleRecords} selected={salePhotos} onChange={setSalePhotos} />
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className={buttonClass} onClick={copySaleReply}>
              {isCopied("reply") ? "Copied!" : "Copy reply"}
            </button>
            {deskEmail ? (
              <>
                <button
                  type="button"
                  className={buttonClass}
                  disabled={saleBusy !== null}
                  onClick={emailSaleReply}
                  title={`Send the breakdown to ${deskEmail} as orders@curiouserrecords.com`}
                >
                  {saleBusy === "email" ? "Sending…" : "Email reply"}
                </button>
                <button
                  type="button"
                  className={buttonClass}
                  disabled={saleBusy !== null}
                  onClick={() => setSaleShowPhotos((v) => !v)}
                  aria-expanded={saleShowPhotos}
                  title="Pick listing photos or upload new ones to attach to the emailed reply"
                >
                  {salePhotos.length ? `Photos (${salePhotos.length})` : "Photos"}
                </button>
              </>
            ) : null}
            <button
              type="button"
              className={buttonClass}
              disabled={!saleBuyer.trim() || saleBusy !== null || !!termsError || !!deskInvoice}
              onClick={holdSelected}
              title={saleBuyer.trim() ? undefined : "Type the buyer first"}
            >
              {saleBusy === "hold" ? "Holding…" : `Hold ${HOLD_HOURS}h`}
            </button>
            <button
              type="button"
              className={buttonClass}
              disabled={!saleBuyer.trim() || saleBusy !== null || !!termsError || !!deskInvoice}
              onClick={createInvoice}
              title={saleBuyer.trim() ? undefined : "Type the buyer first"}
            >
              {saleBusy === "invoice" ? "Creating…" : "PayPal invoice"}
            </button>
            <button
              type="button"
              className={buttonClass}
              disabled={saleBusy !== null || !!termsError}
              onClick={markSelectedSold}
              title="Paid some other way — mark these sold now"
            >
              {saleBusy === "sold" ? "Saving…" : "Mark sold"}
            </button>
          </div>
          {status ? <p className="mt-2 text-xs text-red-400">{status}</p> : null}
          {invoice ? (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              <span className="text-emerald-400">
                Invoice {invoice.id} · {invoice.status}
                {saleEmail.trim() && !invoice.warning
                  ? " — PayPal also emailed the buyer."
                  : ""}
                {invoice.warning ? "" : " Saved under Awaiting payment — safe to Clear."}
              </span>
              {invoice.url ? (
                <>
                  <button
                    type="button"
                    className="rounded-lg border border-white/15 px-2 py-1 text-white transition hover:bg-white hover:text-black"
                    onClick={copyInvoiceLink}
                  >
                    {isCopied("invoice-link") ? "Copied!" : "Copy payment link"}
                  </button>
                  <a
                    href={invoice.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-neutral-400 underline hover:text-white"
                  >
                    Open ↗
                  </a>
                </>
              ) : null}
              {invoice.warning ? (
                <span className="text-amber-400">
                  {invoice.warning}{" "}
                  <a
                    href="https://www.paypal.com/invoices"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline"
                  >
                    PayPal dashboard ↗
                  </a>
                </span>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
