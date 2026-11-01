"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { bundleBreakdown, makeRefCode } from "@/lib/records";
import { bundleKindSummary, itemSpecShort, itemSubtitle } from "@/lib/items";
import type {
  DbRecord,
  Invoice,
  Order,
  OrderRequest,
  ShopMessage,
  ShopMessageStatus,
} from "@/lib/supabase";
import {
  extractRefCode,
  matchLines,
  parseOrderText,
  recordFlags,
  type LineMatch,
} from "@/lib/order-parse";
import { dayLabel, localDayKey, recentDays } from "@/lib/admin/interest";
import {
  HOLD_HOURS,
  STALE_INVOICE_HOURS,
  holdExpiry,
  liveInvoiceOn,
  openOrders,
  requestForOrder,
  type OpenOrder,
} from "@/lib/admin/orders";
import { INVOICE_HOLD_UNTIL } from "@/lib/admin/records";
import { parseMoney, saleItem, saleReplyText } from "@/lib/admin/sales";
import { buyerLabel } from "@/lib/admin/buyers";
import {
  bodyText,
  latestReplyTo,
  messageSummary,
  replyGreeting,
  replySubject,
  requestReplySubject,
} from "@/lib/admin/messages";
import { salesStats } from "@/lib/admin/stats";
import type { PhotoAttachment } from "@/lib/admin/attachments";
import { useAdmin, useSlice } from "../_shell/admin-provider";
import { NextUp } from "./next-up";
import { PhotoPicker } from "./photo-picker";
import { ReviewsSection } from "./reviews-section";
import { BuyerField } from "../_shell/buyer-field";
import { MoneyField, NoteField } from "../_shell/inline-fields";
import { buttonClass, inputClass, timeAgo, useCopied } from "../_shell/ui";

// When the inbox last checked every invoice with PayPal (ms), so reloads
// inside the window don't ask again.
const CHECKED_AT_KEY = "admin-paypal-checked-at";
const AUTO_CHECK_MINUTES = 15;

// The inbox: everything between "a buyer wants records" and "paid" —
// requests, the sale desk, open orders (held or invoiced) and pasted
// DMs — in one top-to-bottom flow. Once paid, an order moves down the
// Ship pages: Pick → Pack → Labels → Send.
export function InboxPage() {
  const {
    supabase,
    records,
    setRecords,
    shipments,
    invoices,
    setInvoices,
    orders,
    setOrders,
    orderRequests,
    setOrderRequests,
    messages,
    setMessages,
    sentMessages,
    setSentMessages,
    events,
    visits,
    loading,
    loadData,
    pushToast,
    copyText,
    upsertInvoiceLocal,
    upsertOrderLocal,
    byId,
    markRecordsSold,
    placeOrder,
    applyPlacedOrder,
    renameBuyer,
    releaseOrder,
    saveOrderCredit,
    updateRecord,
    selectedIds,
    setSelectedIds,
    selectionMode,
    setSelectionMode,
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
    clearSelection,
    confirm,
  } = useAdmin();

  useSlice("events");
  useSlice("visits");
  const dailyStrip = useMemo(() => recentDays(events, visits), [events, visits]);
  const stripMax = Math.max(1, ...dailyStrip.map((d) => d.visited));
  // Oldest logged visit (visits load newest first), to flag days before
  // visit tracking existed. Undefined until the slice loads.
  const visitsSince = visits.length
    ? localDayKey(new Date(visits[visits.length - 1].created_at))
    : undefined;

  // --- Sale desk: multi-select records for a Reddit-DM sale ---
  // selectedIds / selectionMode / saleBuyer / saleEmail live in the admin
  // provider so the selection survives navigating between admin pages.
  // Weekly mode swaps the sticky sale-desk box for a slim picks bar so
  // random picks don't look like a pending sale. Only explicit actions
  // change the mode — checkbox toggles keep it.
  const [saleBusy, setSaleBusy] = useState<
    null | "hold" | "sold" | "invoice" | "email"
  >(null);
  const [saleStatus, setSaleStatus] = useState("");
  // Photos riding along with the desk's emailed breakdown.
  const [salePhotos, setSalePhotos] = useState<PhotoAttachment[]>([]);
  const [saleShowPhotos, setSaleShowPhotos] = useState(false);
  const [saleInvoice, setSaleInvoice] = useState<null | {
    id: string;
    url: string | null;
    status: string;
    warning?: string;
  }>(null);
  // Which copy button just fired: "reply", "invoice-link", `ref-${id}`,
  // or `pending-${invoiceId}`.
  const { isCopied, flash } = useCopied();

  // From records, not filteredRecords — selection survives filter changes.
  const selectedRecords = useMemo(
    () => records.filter((r) => selectedIds.has(r.id)),
    [records, selectedIds]
  );
  const saleRecords = useMemo(
    () => selectedRecords.filter((r) => !r.sold),
    [selectedRecords]
  );
  // What each record sells for at the desk: the typed price, else the
  // listed price. The desk is the source of truth while it's open — a
  // cleared box means "back to the listed price", even for a record that
  // carries a negotiated price from its held order.
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
  const saleSoldCount = selectedRecords.length - saleRecords.length;
  function setSalePrice(id: number, raw: string) {
    setSalePrices((prev) => ({ ...prev, [id]: raw }));
  }
  function clearSaleDesk() {
    clearSelection();
    setSaleStatus("");
    setSaleInvoice(null);
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
    if (saleRecords.length === 0) return;
    if (await copyText(saleReply(), "Copy this reply")) {
      flash("reply");
    }
  }

  // Send mail as orders@ through the server (the Resend key lives there).
  // False when it didn't go — already toasted. A reply filed against a
  // request joins sentMessages so its card shows it was answered.
  async function sendShopEmail(body: {
    to: string;
    subject: string;
    text: string;
    inReplyTo?: string | null;
    messageId?: number;
    requestId?: number | null;
    attachments?: { url: string; filename: string }[];
  }): Promise<boolean> {
    try {
      const {
        data: { session: current },
      } = await supabase.auth.getSession();
      const res = await fetch("/api/email-reply", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${current?.access_token ?? ""}`,
        },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        sent?: ShopMessage | null;
      };
      if (!res.ok) {
        pushToast("error", json.error || `Email failed (${res.status})`);
        return false;
      }
      const sent = json.sent;
      if (sent && sent.request_id != null) {
        setSentMessages((prev) => [sent, ...prev.filter((m) => m.id !== sent.id)]);
      }
      return true;
    } catch {
      pushToast("error", "Email failed — couldn't reach the server");
      return false;
    }
  }

  async function emailSaleReply() {
    if (!deskEmail || saleRecords.length === 0 || saleBusy) return;
    setSaleBusy("email");
    try {
      const ok = await sendShopEmail({
        to: deskEmail,
        subject: deskRequest
          ? `Your record request (Ref ${deskRequest.ref_code})`
          : "Your record request",
        text: saleReply(),
        requestId: deskRequest?.id ?? null,
        attachments: toAttachments(salePhotos),
      });
      if (ok) {
        pushToast("success", `Reply emailed to ${deskEmail}${withPhotos(salePhotos)} ✓`);
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
    pushToast("success", `Held ${ids.length} record${ids.length === 1 ? "" : "s"} for ${HOLD_HOURS}h ✓`);
  }

  async function markSelectedSold() {
    const buyer = saleBuyer.trim().replace(/^u\//, "");
    const targets = saleRecords;
    if (targets.length === 0 || saleBusy || termsError) return;
    if (
      !(await confirm(
        `Mark ${targets.length} record${targets.length > 1 ? "s" : ""} sold${buyer ? ` to ${buyerLabel(buyer, deskEmail)}` : ""} for $${saleTotals.subtotal}${
          saleTotals.credit > 0 ? ` less a $${saleTotals.credit} credit` : ""
        }? Each record's sold price is set to its agreed price.`
      ))
    )
      return;
    setSaleBusy("sold");
    try {
      await markRecordsSold(targets, buyer, { ...saleTerms, buyerEmail: deskEmail });
    } finally {
      setSaleBusy(null);
    }
  }

  async function createInvoice() {
    const buyer = saleBuyer.trim().replace(/^u\//, "");
    const targets = saleRecords;
    if (!buyer || targets.length === 0 || saleBusy || termsError || deskInvoice) return;
    setSaleBusy("invoice");
    setSaleStatus("");
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
        setSaleStatus(body.error);
        return;
      }
      if (res.status === 409) {
        setSaleStatus(
          `Already sold: ${(body.soldIds ?? []).join(", ")} — refreshing records…`
        );
        await loadData();
        return;
      }
      if (!res.ok) {
        setSaleStatus(body.error || "Invoice failed");
        return;
      }
      setSaleInvoice({
        id: body.invoiceId,
        url: body.recipientViewUrl,
        status: body.status,
        warning: body.warning,
      });
      // The route stamps paypal_invoice_id + an until-resolved hold on the records —
      // mirror it locally so the pending card and fulfillment panel link
      // up without a reload, but only when the stamp actually landed
      // (otherwise the panel would show a link that vanishes on reload).
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
      // The saved pending-order row keeps the payment link after Clear.
      if (body.invoice) upsertInvoiceLocal(body.invoice as Invoice);
      // The route put the records in an order (invoiced) — mirror it so
      // the Open orders card appears without a reload.
      if (body.placed) applyPlacedOrder(body.placed);
    } catch {
      setSaleStatus("Request failed");
    } finally {
      setSaleBusy(null);
    }
  }

  async function copyInvoiceLink() {
    if (!saleInvoice?.url) return;
    if (await copyText(saleInvoice.url, "Copy the payment link")) {
      flash("invoice-link");
    }
  }

  const newRequestCount = orderRequests.filter((r) => r.status === "new").length;

  const [pasteText, setPasteText] = useState("");
  const [parseResult, setParseResult] = useState<null | {
    ref: string | null;
    refRequest: OrderRequest | null;
    rows: LineMatch[];
    choices: Record<number, number>; // row index -> chosen record id
  }>(null);
  const [saveParsedChecked, setSaveParsedChecked] = useState(true);

  // Orders in progress: held or invoiced, with the unsold records they
  // cover. This is the durable "order in progress": it survives clearing
  // the sale desk, and leaves the list once its records are marked sold
  // (the order then shows up on Send) or it's cancelled.
  const open = useMemo(
    () => openOrders(orders, records, invoices),
    [orders, records, invoices]
  );
  const invoicedRecordIds = useMemo(
    () =>
      new Set(
        open
          .filter((o) => o.order.status === "invoiced")
          .flatMap((o) => o.recs.map((r) => r.id))
      ),
    [open]
  );

  // Replace the sale-desk selection (with confirmation when it differs),
  // open the Listings section, and scroll to the sticky bar.
  async function applySaleSelection(ids: number[]): Promise<boolean> {
    const next = new Set(ids);
    const differs =
      selectedIds.size !== next.size ||
      [...selectedIds].some((id) => !next.has(id));
    if (selectedIds.size > 0 && differs) {
      if (
        !(await confirm(
          `Replace the current sale desk selection (${selectedIds.size} record${selectedIds.size === 1 ? "" : "s"})?`
        ))
      )
        return false;
    }
    setSelectedIds(next);
    setSelectionMode("sale");
    // The sticky bar only exists once the selection renders.
    setTimeout(() => {
      document
        .getElementById("sale-desk")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 100);
    return true;
  }

  async function loadRequestIntoSaleDesk(req: OrderRequest) {
    const available = req.record_ids.filter((id) => {
      const r = byId.get(id);
      return r && !r.sold;
    });
    if (available.length === 0) {
      pushToast("info", "None of this request's records are still available.");
      return;
    }
    if (!(await applySaleSelection(available))) return;
    // Seed the buyer fields from what the buyer typed on the shop, without
    // clobbering a name the admin already entered. An email request also
    // brings its address (the PayPal invoice goes there) and its channel.
    const name =
      req.channel === "email"
        ? req.buyer_name || req.buyer_email || ""
        : req.buyer_username || "";
    if (name) setSaleBuyer((prev) => (prev.trim() ? prev : name));
    if (req.channel === "email" && req.buyer_email) {
      const email = req.buyer_email;
      setSaleEmail((prev) => (prev.trim() ? prev : email));
    }
    setSaleChannel(req.channel);
    if (req.status === "new") {
      const { error } = await supabase
        .from("order_requests")
        .update({ status: "loaded", updated_at: new Date().toISOString() })
        .eq("id", req.id);
      if (!error) {
        setOrderRequests((prev) =>
          prev.map((r) => (r.id === req.id ? { ...r, status: "loaded" } : r))
        );
      }
    }
  }

  // --- Open orders: held or invoiced, not yet paid ---
  // One order busy at a time, keyed by order id, so a slow PayPal call on
  // one card never disables the others.
  const [orderBusy, setOrderBusy] = useState<null | {
    id: number;
    action: "check" | "cancel" | "paid" | "release";
  }>(null);

  async function loadOrderIntoSaleDesk(o: OpenOrder) {
    if (!(await applySaleSelection(o.recs.map((r) => r.id)))) return;
    // Seed the buyer field without clobbering a name the admin typed.
    setSaleBuyer((prev) => (prev.trim() ? prev : o.buyer));
    // The order's terms come along: its negotiated prices and credit.
    setSalePrices(
      Object.fromEntries(
        o.recs
          .filter((r) => r.negotiated_price != null)
          .map((r) => [r.id, String(r.negotiated_price)])
      )
    );
    const credit = Number(o.order.credit ?? 0);
    setSaleCredit(credit > 0 ? String(credit) : "");
    setSaleCreditNote(o.order.credit_note ?? "");
  }

  // A held order whose buyer paid off-PayPal: mark its records sold.
  async function markOrderPaid(o: OpenOrder) {
    if (orderBusy || o.recs.length === 0) return;
    if (
      !(await confirm(
        `Mark ${o.recs.length} record${o.recs.length > 1 ? "s" : ""} sold to ${buyerLabel(o.buyer, o.order.buyer_email, "?")} for $${o.totals.subtotal}${
          o.totals.credit > 0 ? ` less a $${o.totals.credit} credit` : ""
        }? Each record's sold price is set to its agreed price.`
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

  // Release a held order: the records go back on the shop.
  async function releaseHeldOrder(o: OpenOrder) {
    if (orderBusy) return;
    if (
      !(await confirm(
        `Release ${o.recs.length} record${o.recs.length === 1 ? "" : "s"} held for ${buyerLabel(o.buyer, o.order.buyer_email, "?")}? They go back on the shop immediately.`
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

  async function pendingInvoiceFetch(id: string, method: "GET" | "DELETE") {
    const {
      data: { session: current },
    } = await supabase.auth.getSession();
    const res = await fetch(
      `/api/paypal-invoice?id=${encodeURIComponent(id)}`,
      {
        method,
        headers: { Authorization: `Bearer ${current?.access_token ?? ""}` },
      }
    );
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
    return body;
  }

  // Ask PayPal where the invoice stands. Paid → the route marks the
  // records sold to the buyer on the server (usually the webhook already
  // has) and the order moves to Pick → Pack → Send.
  // `quiet` (a check-all pass) leaves "not paid yet" and errors to the
  // caller's one summary toast.
  async function checkInvoice(
    o: OpenOrder,
    quiet = false,
    onError?: (message: string) => void
  ): Promise<"paid" | "unpaid" | "error"> {
    const id = o.order.paypal_invoice_id;
    if (!id) return "unpaid";
    setOrderBusy({ id: o.order.id, action: "check" });
    try {
      const body = await pendingInvoiceFetch(id, "GET");
      if (body.invoice) upsertInvoiceLocal(body.invoice as Invoice);
      // Still payable: the route re-held any records whose hold had lapsed.
      if (Array.isArray(body.heldIds) && body.heldIds.length > 0) {
        const held = new Set<number>(body.heldIds);
        setRecords((prev) =>
          prev.map((r) =>
            held.has(r.id) ? { ...r, hold_until: INVOICE_HOLD_UNTIL } : r
          )
        );
      }
      // The route stamps the buyer's ship-to on the order once paid.
      if (body.order) upsertOrderLocal(body.order as Order);
      if (body.paid) {
        // The route already made the sale on the server (the same write
        // the PayPal webhook makes); reload to show it. A check-all pass
        // reloads once at the end instead.
        const settled = body.settled as
          | { kind: "sold"; soldIds: number[]; failure: string | null }
          | { kind: "closed" }
          | { kind: "none" }
          | undefined;
        if (settled?.kind === "sold" && settled.failure) {
          const message = `Invoice ${id} is paid, but only ${settled.soldIds.length} of its records were marked sold: ${settled.failure}`;
          if (quiet) onError?.(message);
          else pushToast("error", message);
          if (!quiet) await loadData();
          return "error";
        }
        if (!quiet) {
          pushToast(
            "success",
            settled?.kind === "sold"
              ? `Invoice ${id} is ${body.status} ✓ — ${settled.soldIds.length} record${settled.soldIds.length === 1 ? "" : "s"} sold to ${buyerLabel(o.buyer, o.order.buyer_email, "?")}`
              : `Invoice ${id} is ${body.status} ✓ — order closed.`
          );
          await loadData();
        }
        return "paid";
      }
      if (!quiet) {
        pushToast(
          "info",
          `Invoice ${id}: not paid yet (${body.status}).${
            body.recipientViewUrl && !o.invoice?.recipient_view_url
              ? " Payment link saved."
              : ""
          }`
        );
      }
      return "unpaid";
    } catch (e) {
      const message = e instanceof Error ? e.message : "PayPal check failed";
      if (quiet) onError?.(message);
      else pushToast("error", message);
      return "error";
    } finally {
      setOrderBusy(null);
    }
  }

  function checkOrderInvoice(o: OpenOrder) {
    if (orderBusy || checkingAll) return;
    void checkInvoice(o);
  }

  // Every invoiced order in one pass, one at a time, with one summary.
  // `auto` is the pass the inbox runs by itself on load: it only speaks
  // up when something was paid or PayPal couldn't be reached.
  const [checkingAll, setCheckingAll] = useState(false);
  async function checkAllInvoices(auto = false) {
    const targets = open.filter(
      (o) => o.order.status === "invoiced" && !!o.order.paypal_invoice_id
    );
    if (targets.length === 0 || orderBusy || checkingAll) return;
    setCheckingAll(true);
    let paid = 0;
    let failed = 0;
    let firstError = "";
    for (const o of targets) {
      const result = await checkInvoice(o, true, (m) => {
        firstError ||= m;
      });
      if (result === "paid") paid++;
      else if (result === "error") failed++;
    }
    setCheckingAll(false);
    // Paid ones were sold on the server; one reload shows them all.
    if (paid > 0) await loadData();
    // A pass PayPal never answered doesn't count — the next load retries.
    if (failed < targets.length) {
      try {
        window.localStorage.setItem(CHECKED_AT_KEY, String(Date.now()));
      } catch {
        // Private mode — the next load just checks again.
      }
    }
    const unpaid = targets.length - paid - failed;
    const parts = [
      paid > 0 ? `${paid} paid — on the pick list now` : "",
      unpaid > 0 ? `${unpaid} still unpaid` : "",
      failed > 0 ? `${failed} couldn't be checked` : "",
    ].filter(Boolean);
    if (auto && paid === 0 && failed === 0) return;
    pushToast(
      failed > 0 ? "error" : paid > 0 ? "success" : "info",
      `PayPal: ${parts.join(" · ")}.${firstError ? ` ${firstError.slice(0, 160)}` : ""}`
    );
  }

  // Opening the inbox checks the invoices itself, at most once per
  // AUTO_CHECK_MINUTES, so a payment shows up without a click per order.
  const checkAllRef = useRef(checkAllInvoices);
  useEffect(() => {
    checkAllRef.current = checkAllInvoices;
  });
  const autoChecked = useRef(false);
  const hasInvoiced = open.some(
    (o) => o.order.status === "invoiced" && !!o.order.paypal_invoice_id
  );
  useEffect(() => {
    if (loading || !hasInvoiced || autoChecked.current) return;
    autoChecked.current = true;
    let last = 0;
    try {
      last = Number(window.localStorage.getItem(CHECKED_AT_KEY) ?? 0);
    } catch {
      // Private mode — check.
    }
    if (Date.now() - last < AUTO_CHECK_MINUTES * 60 * 1000) return;
    void checkAllRef.current(true);
  }, [loading, hasInvoiced]);

  // Cancel on PayPal, end the order, and put the records back on the shelf.
  async function cancelOrderInvoice(o: OpenOrder) {
    const id = o.order.paypal_invoice_id;
    if (!id || orderBusy) return;
    if (
      !(await confirm(
        `Cancel invoice ${id}${o.buyer ? ` for ${buyerLabel(o.buyer, o.order.buyer_email)}` : ""} on PayPal and release ${o.recs.length} record${o.recs.length === 1 ? "" : "s"}? The buyer's payment link stops working.`
      ))
    )
      return;
    setOrderBusy({ id: o.order.id, action: "cancel" });
    try {
      const body = await pendingInvoiceFetch(id, "DELETE");
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
          cancelled.has(x.id) && x.status !== "paid"
            ? { ...x, status: "cancelled" }
            : x
        )
      );
      pushToast("success", `Invoice ${id} cancelled — ${released.size} record${released.size === 1 ? "" : "s"} released.`);
    } catch (e) {
      pushToast("error", e instanceof Error ? e.message : "Cancel failed");
    } finally {
      setOrderBusy(null);
    }
  }

  // Track a paste-parsed order in the inbox like any buyer-submitted request.
  // The insert goes through the same validation trigger, so ids are
  // revalidated and totals recomputed server-side.
  async function saveParsedRequest(ids: number[]) {
    const { data, error } = await supabase
      .from("order_requests")
      .insert({ ref_code: makeRefCode(), record_ids: ids })
      .select()
      .single();
    if (error || !data) {
      console.warn("could not save parsed order as request:", error?.message);
      return;
    }
    // It's going straight onto the sale desk, so it starts out loaded.
    const { error: statusError } = await supabase
      .from("order_requests")
      .update({ status: "loaded", updated_at: new Date().toISOString() })
      .eq("id", data.id);
    const saved = {
      ...(data as OrderRequest),
      status: statusError ? "new" : "loaded",
    } as OrderRequest;
    setOrderRequests((prev) => [saved, ...prev]);
  }

  async function updateRequestStatus(
    req: OrderRequest,
    status: "completed" | "dismissed"
  ) {
    const { error } = await supabase
      .from("order_requests")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", req.id);
    if (error) {
      pushToast("error", `Couldn't update the request: ${error.message}`);
      return;
    }
    setOrderRequests((prev) => prev.filter((r) => r.id !== req.id));
    // The card disappears from the open list, so offer a way back.
    pushToast(
      "info",
      `Request ${req.ref_code} ${status === "dismissed" ? "dismissed" : "marked completed"}.`,
      { label: "Undo", onClick: () => restoreRequest(req) }
    );
  }

  // Reply to an email request from its card, as orders@. One draft at a
  // time, like the Messages section; photos picked for it go as
  // attachments.
  const [replyRequestId, setReplyRequestId] = useState<number | null>(null);
  const [requestReplyDraft, setRequestReplyDraft] = useState("");
  const [requestReplyBusy, setRequestReplyBusy] = useState<number | null>(null);
  const [replyPhotos, setReplyPhotos] = useState<PhotoAttachment[]>([]);

  function toAttachments(photos: PhotoAttachment[]) {
    return photos.map(({ url, filename }) => ({ url, filename }));
  }
  function withPhotos(photos: PhotoAttachment[]) {
    return photos.length ? ` with ${photos.length} photo${photos.length === 1 ? "" : "s"}` : "";
  }

  function toggleRequestReply(req: OrderRequest) {
    const opening = replyRequestId !== req.id;
    setReplyRequestId(opening ? req.id : null);
    setRequestReplyDraft(opening ? replyGreeting(req.buyer_name) : "");
    setReplyPhotos([]);
  }

  async function sendRequestReply(req: OrderRequest) {
    const text = requestReplyDraft.trim();
    if (!text || !req.buyer_email || requestReplyBusy) return;
    setRequestReplyBusy(req.id);
    try {
      const ok = await sendShopEmail({
        to: req.buyer_email,
        subject: requestReplySubject(req.ref_code),
        text,
        requestId: req.id,
        attachments: toAttachments(replyPhotos),
      });
      if (!ok) return;
      setReplyRequestId(null);
      setRequestReplyDraft("");
      pushToast("success", `Reply sent to ${req.buyer_email}${withPhotos(replyPhotos)} ✓`);
      setReplyPhotos([]);
    } finally {
      setRequestReplyBusy(null);
    }
  }

  async function restoreRequest(req: OrderRequest) {
    const { error } = await supabase
      .from("order_requests")
      .update({ status: "new", updated_at: new Date().toISOString() })
      .eq("id", req.id);
    if (error) {
      pushToast("error", `Couldn't restore the request: ${error.message}`);
      return;
    }
    setOrderRequests((prev) =>
      prev.some((r) => r.id === req.id)
        ? prev
        : [...prev, { ...req, status: "new" as const }].sort((a, b) =>
            b.created_at.localeCompare(a.created_at)
          )
    );
  }

  // --- Messages: mail to orders@, filed by the Resend webhook ---
  const [openMessageId, setOpenMessageId] = useState<number | null>(null);
  const [replyDraft, setReplyDraft] = useState("");
  const [messageBusy, setMessageBusy] = useState<number | null>(null);
  const newMessageCount = messages.filter((m) => m.status === "new").length;

  async function setMessageStatus(
    m: ShopMessage,
    status: ShopMessageStatus,
    opts: { quiet?: boolean } = {}
  ) {
    const { error } = await supabase
      .from("shop_messages")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", m.id);
    if (error) {
      pushToast("error", `Couldn't update the message: ${error.message}`);
      return;
    }
    if (status === "archived") {
      setMessages((prev) => prev.filter((x) => x.id !== m.id));
      if (openMessageId === m.id) setOpenMessageId(null);
      if (!opts.quiet) {
        pushToast("info", `Message from ${m.from_name || m.from_email} archived.`, {
          label: "Undo",
          onClick: () => restoreMessage(m),
        });
      }
    } else {
      setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, status } : x)));
    }
  }

  async function restoreMessage(m: ShopMessage) {
    const { error } = await supabase
      .from("shop_messages")
      .update({ status: "read", updated_at: new Date().toISOString() })
      .eq("id", m.id);
    if (error) {
      pushToast("error", `Couldn't restore the message: ${error.message}`);
      return;
    }
    setMessages((prev) =>
      prev.some((x) => x.id === m.id)
        ? prev
        : [...prev, { ...m, status: "read" as const }].sort((a, b) =>
            b.received_at.localeCompare(a.received_at)
          )
    );
  }

  // Opening a message shows the whole body and marks a new one read.
  function toggleMessage(m: ShopMessage) {
    const opening = openMessageId !== m.id;
    setOpenMessageId(opening ? m.id : null);
    if (opening) {
      setReplyDraft(replyGreeting(m.from_name));
      if (m.status === "new") void setMessageStatus(m, "read", { quiet: true });
    }
  }

  async function sendMessageReply(m: ShopMessage) {
    const text = replyDraft.trim();
    if (!text || messageBusy) return;
    setMessageBusy(m.id);
    try {
      const ok = await sendShopEmail({
        to: m.from_email,
        subject: replySubject(m.subject),
        text,
        inReplyTo: m.message_id,
        messageId: m.id,
        requestId: m.request_id,
      });
      if (!ok) return;
      setMessages((prev) =>
        prev.map((x) => (x.id === m.id ? { ...x, status: "replied" } : x))
      );
      setReplyDraft("");
      pushToast("success", `Reply sent to ${m.from_email} ✓`);
    } finally {
      setMessageBusy(null);
    }
  }

  // Put the message's records on the desk: through its saved request when
  // the ref code matched, else by parsing the body like a pasted DM. The
  // sender becomes the desk's email buyer either way.
  async function loadMessageIntoSaleDesk(m: ShopMessage) {
    const seedBuyer = () => {
      setSaleChannel("email");
      setSaleEmail((prev) => (prev.trim() ? prev : m.from_email));
      if (m.from_name) {
        const name = m.from_name;
        setSaleBuyer((prev) => (prev.trim() ? prev : name));
      }
    };
    if (m.request_id != null) {
      let req = orderRequests.find((r) => r.id === m.request_id) ?? null;
      if (!req) {
        const { data } = await supabase
          .from("order_requests")
          .select("*")
          .eq("id", m.request_id)
          .maybeSingle();
        req = (data as OrderRequest | null) ?? null;
      }
      if (req) {
        await loadRequestIntoSaleDesk(req);
        seedBuyer();
        return;
      }
    }
    const text = bodyText(m);
    setPasteText(text);
    const rows = matchLines(parseOrderText(text), records);
    setParseResult({ ref: m.ref_code, refRequest: null, rows, choices: {} });
    seedBuyer();
    if (rows.length === 0) {
      pushToast("info", "No record lines found in this message — pick the records by hand.");
    }
    setTimeout(() => {
      document.getElementById("paste-dm")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 100);
  }

  async function copyRefCode(req: OrderRequest) {
    if (await copyText(req.ref_code, "Copy the ref code")) {
      flash(`ref-${req.id}`);
    }
  }

  async function parsePasted() {
    const text = pasteText;
    if (!text.trim()) return;
    const ref = extractRefCode(text);
    let refRequest = ref
      ? (orderRequests.find((r) => r.ref_code === ref) ?? null)
      : null;
    if (ref && !refRequest) {
      // Not in the open list — maybe already completed/dismissed or older
      // than the load window.
      const { data } = await supabase
        .from("order_requests")
        .select("*")
        .eq("ref_code", ref)
        .maybeSingle();
      refRequest = (data as OrderRequest | null) ?? null;
    }
    const rows = matchLines(parseOrderText(text), records);
    setParseResult({ ref, refRequest, rows, choices: {} });
  }

  // Records the review panel would put on the sale desk right now.
  const parsedIds = useMemo(() => {
    if (!parseResult) return [] as number[];
    const ids: number[] = [];
    parseResult.rows.forEach((row, i) => {
      if (row.status === "matched" && row.match && !row.match.sold) {
        ids.push(row.match.id);
      } else if (row.status === "ambiguous") {
        const chosen = parseResult.choices[i];
        if (chosen !== undefined && !byId.get(chosen)?.sold) ids.push(chosen);
      }
    });
    return [...new Set(ids)];
  }, [parseResult, byId]);

  async function applyParsedSelection() {
    if (parsedIds.length === 0) return;
    if (!(await applySaleSelection(parsedIds))) return;
    const matched = parseResult?.refRequest;
    const typedBuyer =
      matched?.channel === "email"
        ? matched.buyer_name || matched.buyer_email
        : matched?.buyer_username;
    if (typedBuyer) setSaleBuyer((prev) => (prev.trim() ? prev : typedBuyer));
    if (matched?.channel === "email" && matched.buyer_email) {
      const email = matched.buyer_email;
      setSaleEmail((prev) => (prev.trim() ? prev : email));
      setSaleChannel("email");
    }
    // Don't double-track: a DM whose ref matched a saved request is already
    // in the inbox.
    if (saveParsedChecked && !parseResult?.refRequest) {
      void saveParsedRequest(parsedIds);
    }
    setPasteText("");
    setParseResult(null);
  }

  // Live collection value — recomputed from local state, so it updates the
  // moment a price is edited, a change is approved, or a record is sold.
  const stats = useMemo(
    () => salesStats({ records, shipments, invoices, orders }),
    [records, shipments, invoices, orders]
  );


  return (
    <>
      <h1 className="mt-6 text-3xl font-semibold">Inbox</h1>
      <NextUp />
        {selectedIds.size > 0 && selectionMode === "sale" ? (
          <div
            id="sale-desk"
            className="sticky top-2 z-10 mt-6 rounded-2xl border border-amber-400/30 bg-neutral-950/95 p-4 backdrop-blur"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-white">
                <span className="font-medium">{bundleKindSummary(saleRecords) || "0 items"}</span>{" "}
                <span className="text-neutral-400">
                  · Subtotal ${saleTotals.subtotal}
                  {saleTotals.credit > 0 ? ` · Credit −$${saleTotals.credit}` : ""}
                  {" "}· Shipping ${saleTotals.shipping}
                  {saleTotals.shippingDetail ? ` (${saleTotals.shippingDetail})` : saleTotals.shipping === 0 && !saleTotals.gearQuoted ? " (free)" : ""} ·{" "}
                </span>
                <span className="font-semibold">Total ${saleTotals.total}</span>
              </p>
              <button
                type="button"
                onClick={clearSaleDesk}
                className="text-xs text-neutral-500 underline transition hover:text-white"
              >
                Clear
              </button>
            </div>
            {saleSoldCount > 0 ? (
              <p className="mt-2 text-xs text-amber-400">
                {saleSoldCount} selected record{saleSoldCount === 1 ? " is" : "s are"}{" "}
                already sold and will be skipped.
              </p>
            ) : null}
            {/* Per-record agreed prices: blank = listed. The listed price
                stays put; a lower agreed price shows on the invoice as a
                discount off it. */}
            <ul className="mt-3 max-h-40 space-y-1 overflow-y-auto pr-1 text-sm">
              {saleRecords.map((r) => {
                const agreed = deskPrices.get(r.id) ?? Number(r.price);
                const bad = parseMoney(salePrices[r.id] ?? "") === undefined;
                return (
                  <li key={r.id} className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 flex-1 truncate">
                      {r.artist} — {r.title}{" "}
                      <span className="text-neutral-500">
                        {itemSpecShort(r)}
                      </span>
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
                        title="Negotiated price for this sale — blank keeps the listed price. The invoice shows the listed price with the difference as a discount."
                        className={`w-20 ${inputClass} ${bad ? "border-red-400/60" : ""}`}
                      />
                    </span>
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
                  title="Taken off the whole order — a make-good for an unavailable record, or a bundle deal. Shows on the PayPal invoice as a discount line; the reason goes in the note to the buyer."
                  className={`w-20 ${inputClass} ${
                    creditParsed === undefined || creditTooBig ? "border-red-400/60" : ""
                  }`}
                />
              </span>
              <input
                type="text"
                value={saleCreditNote}
                onChange={(e) => setSaleCreditNote(e.target.value)}
                placeholder="reason (goes in the invoice note)"
                className={`w-64 ${inputClass}`}
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
                    title="What you quoted the buyer to ship the equipment (the shop charged $0 on the request). Added to the invoice's shipping. Leave blank for local pickup."
                    className={`w-20 ${inputClass} ${gearParsed === undefined ? "border-red-400/60" : ""}`}
                  />
                </span>
                <span className="text-xs text-neutral-500">
                  quoted for the gear on the desk · blank = local pickup
                </span>
              </div>
            ) : null}
            {termsError ? (
              <p className="mt-2 text-xs text-red-400">{termsError}</p>
            ) : null}
            {deskInvoice ? (
              <p className="mt-2 text-xs text-amber-300">
                On PayPal invoice {deskInvoice} — held until it&apos;s paid or
                cancelled. To change the deal, cancel it under Open orders
                first, then hold or invoice again.
              </p>
            ) : null}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  setSaleChannel((c) => (c === "email" ? "reddit" : "email"))
                }
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
                className={`w-36 ${inputClass}`}
              />
              <input
                type="email"
                value={saleEmail}
                onChange={(e) => setSaleEmail(e.target.value)}
                placeholder={
                  saleChannel === "email" ? "buyer email" : "PayPal email (optional)"
                }
                className={`w-56 ${inputClass}`}
              />
            </div>
            {deskEmail && saleShowPhotos && saleRecords.length > 0 ? (
              <PhotoPicker
                records={saleRecords}
                selected={salePhotos}
                onChange={setSalePhotos}
              />
            ) : null}
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                className={buttonClass}
                disabled={saleRecords.length === 0}
                onClick={copySaleReply}
              >
                {isCopied("reply") ? "Copied!" : "Copy reply"}
              </button>
              {deskEmail ? (
                <button
                  type="button"
                  className={buttonClass}
                  disabled={saleRecords.length === 0 || saleBusy !== null}
                  onClick={emailSaleReply}
                  title={`Send the breakdown to ${deskEmail} as orders@curiouserrecords.com`}
                >
                  {saleBusy === "email" ? "Sending…" : "Email reply"}
                </button>
              ) : null}
              {deskEmail ? (
                <button
                  type="button"
                  className={buttonClass}
                  disabled={saleRecords.length === 0 || saleBusy !== null}
                  onClick={() => setSaleShowPhotos((v) => !v)}
                  aria-expanded={saleShowPhotos}
                  title="Pick listing photos or upload new ones to attach to the emailed reply"
                >
                  {salePhotos.length ? `Photos (${salePhotos.length})` : "Photos"}
                </button>
              ) : null}
              <button
                type="button"
                className={buttonClass}
                disabled={!saleBuyer.trim() || saleRecords.length === 0 || saleBusy !== null || !!termsError || !!deskInvoice}
                onClick={holdSelected}
              >
                {saleBusy === "hold" ? "Holding…" : `Hold all ${HOLD_HOURS}h`}
              </button>
              <button
                type="button"
                className={buttonClass}
                disabled={saleRecords.length === 0 || saleBusy !== null || !!termsError}
                onClick={markSelectedSold}
              >
                {saleBusy === "sold" ? "Saving…" : "Mark all sold"}
              </button>
              <button
                type="button"
                className={buttonClass}
                disabled={!saleBuyer.trim() || saleRecords.length === 0 || saleBusy !== null || !!termsError || !!deskInvoice}
                onClick={createInvoice}
              >
                {saleBusy === "invoice" ? "Creating…" : "PayPal invoice"}
              </button>
            </div>
            {saleStatus ? (
              <p className="mt-2 text-xs text-red-400">{saleStatus}</p>
            ) : null}
            {saleInvoice ? (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                <span className="text-emerald-400">
                  Invoice {saleInvoice.id} · {saleInvoice.status}
                  {saleEmail.trim() && !saleInvoice.warning
                    ? " — PayPal also emailed the buyer."
                    : ""}
                  {saleInvoice.warning
                    ? ""
                    : " Saved under Open orders — safe to Clear."}
                </span>
                {saleInvoice.url ? (
                  <>
                    <button
                      type="button"
                      className="rounded-lg border border-white/15 px-2 py-1 text-white transition hover:bg-white hover:text-black"
                      onClick={copyInvoiceLink}
                    >
                      {isCopied("invoice-link") ? "Copied!" : "Copy payment link"}
                    </button>
                    <a
                      href={saleInvoice.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-neutral-400 underline hover:text-white"
                    >
                      Open ↗
                    </a>
                  </>
                ) : null}
                {saleInvoice.warning ? (
                  <span className="text-amber-400">
                    {saleInvoice.warning}{" "}
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
          </div>
        ) : null}
        {/* Incoming order requests */}
        <h2 id="requests" className="mt-10 scroll-mt-24 text-xl font-medium">
            Incoming requests{" "}
            {newRequestCount > 0 ? (
              <span className="text-sm text-amber-400">
                ({newRequestCount} new)
              </span>
            ) : (
              <span className="text-sm text-neutral-400">
                ({orderRequests.length} open)
              </span>
            )}
        </h2>
            <p className="mt-1 text-sm text-neutral-400">
              Saved automatically when a buyer clicks &ldquo;Request to
              buy&rdquo; on the site — the ref code also appears in their DM.
              Load one to check its records into the sale desk, or paste the DM
              itself below.
            </p>
            {orderRequests.length === 0 ? (
              <p className="mt-3 text-sm text-neutral-400">No open requests.</p>
            ) : (
              <div className="mt-3 grid gap-3 lg:grid-cols-2">
                {orderRequests.map((req) => {
                  const unavailable = req.record_ids.filter((id) => {
                    const r = byId.get(id);
                    return !r || r.sold;
                  }).length;
                  const canReply = req.channel === "email" && Boolean(req.buyer_email);
                  const replied = canReply ? latestReplyTo(sentMessages, req.id) : null;
                  const replyOpen = replyRequestId === req.id;
                  const replyBusy = requestReplyBusy === req.id;
                  const replyRecords = replyOpen
                    ? req.record_ids.flatMap((id) => {
                        const r = byId.get(id);
                        return r ? [r] : [];
                      })
                    : [];
                  return (
                    <div
                      key={req.id}
                      className="rounded-2xl border border-white/10 bg-white/5 p-4"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => copyRefCode(req)}
                          title="Copy ref code"
                          className="font-mono text-sm text-amber-300 transition hover:text-amber-100"
                        >
                          {isCopied(`ref-${req.id}`) ? "Copied!" : req.ref_code}
                        </button>
                        <span
                          className={`rounded-full border px-2 py-0.5 text-xs ${
                            req.status === "new"
                              ? "border-amber-400/40 text-amber-300"
                              : "border-white/15 text-neutral-400"
                          }`}
                        >
                          {req.status}
                        </span>
                        <span
                          className={`rounded-full border px-2 py-0.5 text-xs ${
                            req.channel === "email"
                              ? "border-sky-400/40 text-sky-300"
                              : "border-white/15 text-neutral-400"
                          }`}
                          title={
                            req.channel === "email"
                              ? "Sent from the shop's email form"
                              : "Sent as a Reddit DM"
                          }
                        >
                          {req.channel === "email" ? "email" : "reddit"}
                        </span>
                        {req.channel === "email" ? (
                          <span className="text-sm text-white">
                            {req.buyer_name ? `${req.buyer_name} · ` : ""}
                            <a
                              href={`mailto:${req.buyer_email}`}
                              className="text-sky-300 underline-offset-2 hover:underline"
                            >
                              {req.buyer_email}
                            </a>
                          </span>
                        ) : req.buyer_username ? (
                          <span className="text-sm text-white">
                            u/{req.buyer_username}
                          </span>
                        ) : (
                          <span className="text-xs text-neutral-500">
                            no username given
                          </span>
                        )}
                        {req.record_ids.some((id) => invoicedRecordIds.has(id)) ? (
                          <span className="rounded-full border border-emerald-500/40 px-2 py-0.5 text-xs text-emerald-300">
                            invoice sent
                          </span>
                        ) : null}
                        {replied ? (
                          <span
                            className="rounded-full border border-emerald-500/40 px-2 py-0.5 text-xs text-emerald-300"
                            title={replied.subject ?? undefined}
                          >
                            replied {timeAgo(replied.received_at)}
                          </span>
                        ) : null}
                        <span className="ml-auto text-xs text-neutral-500">
                          {timeAgo(req.created_at)}
                        </span>
                      </div>
                      <ul className="mt-3 space-y-1 text-sm">
                        {req.items.map((it) => {
                          const r = byId.get(it.id);
                          const flags = r
                            ? recordFlags(r, it.price)
                            : ["no longer in the system"];
                          return (
                            <li key={it.id}>
                              {it.artist} — {it.title}{" "}
                              <span className="text-neutral-500">
                                {itemSpecShort(it)}
                              </span>{" "}
                              — ${it.price}
                              {flags.length > 0 ? (
                                <span className="text-amber-400">
                                  {" "}
                                  · {flags.join(" · ")}
                                </span>
                              ) : null}
                            </li>
                          );
                        })}
                      </ul>
                      <p className="mt-2 text-sm text-neutral-400">
                        Subtotal ${req.subtotal} · Shipping ${req.shipping} ·{" "}
                        <span className="font-medium text-white">
                          Total ${req.total}
                        </span>
                      </p>
                      {unavailable > 0 ? (
                        <p className="mt-1 text-xs text-amber-400">
                          {unavailable} of {req.record_ids.length} unavailable —
                          will not be selected.
                        </p>
                      ) : null}
                      {req.message ? (
                        <blockquote className="mt-2 whitespace-pre-wrap border-l-2 border-white/15 pl-3 text-sm text-neutral-300">
                          {req.message}
                        </blockquote>
                      ) : null}
                      {replyOpen ? (
                        <div className="mt-3">
                          <textarea
                            value={requestReplyDraft}
                            onChange={(e) => setRequestReplyDraft(e.target.value)}
                            rows={5}
                            autoFocus
                            placeholder="Reply as orders@curiouserrecords.com…"
                            aria-label={`Reply to ${req.buyer_name || req.buyer_email}`}
                            className={`w-full ${inputClass}`}
                          />
                          {replyRecords.length > 0 ? (
                            <PhotoPicker
                              records={replyRecords}
                              selected={replyPhotos}
                              onChange={setReplyPhotos}
                            />
                          ) : null}
                        </div>
                      ) : null}
                      <div className="mt-3 flex flex-wrap gap-2">
                        {canReply && replyOpen ? (
                          <>
                            <button
                              type="button"
                              className={buttonClass}
                              disabled={!requestReplyDraft.trim() || replyBusy}
                              onClick={() => sendRequestReply(req)}
                            >
                              {replyBusy ? "Sending…" : "Send reply"}
                            </button>
                            <button
                              type="button"
                              className={buttonClass}
                              disabled={replyBusy}
                              onClick={() => toggleRequestReply(req)}
                            >
                              Cancel
                            </button>
                          </>
                        ) : canReply ? (
                          <button
                            type="button"
                            className={buttonClass}
                            onClick={() => toggleRequestReply(req)}
                            title={`Email ${req.buyer_email} as orders@curiouserrecords.com`}
                          >
                            {replied ? "Reply again" : "Reply"}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className={buttonClass}
                          onClick={() => loadRequestIntoSaleDesk(req)}
                        >
                          Load into sale desk
                        </button>
                        <button
                          type="button"
                          className={buttonClass}
                          onClick={() => updateRequestStatus(req, "completed")}
                        >
                          Mark completed
                        </button>
                        <button
                          type="button"
                          className={buttonClass}
                          onClick={() => updateRequestStatus(req, "dismissed")}
                        >
                          Dismiss
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {open.length > 0 ? (
              <>
                <div className="mt-8 flex flex-wrap items-center justify-between gap-2">
                  <h3 id="open-orders" className="scroll-mt-24 text-lg font-medium">
                    Open orders{" "}
                    <span className="text-sm text-neutral-400">({open.length})</span>
                  </h3>
                  {hasInvoiced ? (
                    <button
                      type="button"
                      className={buttonClass}
                      disabled={checkingAll || !!orderBusy}
                      onClick={() => checkAllInvoices()}
                      title="Ask PayPal about every invoiced order, one after another. Paid ones are marked sold and go to the pick list."
                    >
                      {checkingAll ? "Checking…" : "Check all PayPal"}
                    </button>
                  ) : null}
                </div>
                <p className="mt-1 text-sm text-neutral-400">
                  Held or invoiced, not yet paid — the ones that need you
                  first: lapsed holds, then the longest-unpaid invoices.
                  Opening the inbox checks PayPal by itself; a paid invoice
                  is marked sold and goes to the pick list. A held order is
                  marked paid by hand or released back to the shop.
                </p>
                <div className="mt-3 grid gap-3 lg:grid-cols-2">
                  {open.map((o) => {
                    const order = o.order;
                    const inv = o.invoice;
                    const invoiceId = order.paypal_invoice_id;
                    const invoiced = order.status === "invoiced";
                    const busy = orderBusy?.id === order.id ? orderBusy.action : null;
                    const anyBusy = !!orderBusy || checkingAll;
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
                            <span
                              className={`rounded-full border px-2 py-0.5 text-xs ${
                                invStatus === "draft"
                                  ? "border-white/15 text-neutral-400"
                                  : "border-emerald-500/40 text-emerald-300"
                              }`}
                            >
                              invoice {invStatus}
                            </span>
                          ) : (
                            <span
                              className={`rounded-full border px-2 py-0.5 text-xs ${
                                o.expired
                                  ? "border-white/15 text-neutral-400"
                                  : "border-amber-400/40 text-amber-300"
                              }`}
                            >
                              {o.expired ? "hold expired" : "on hold"}
                            </span>
                          )}
                          {invoiceId ? (
                            <span className="font-mono text-xs text-neutral-500">
                              {invoiceId}
                            </span>
                          ) : null}
                          {o.stale ? (
                            <span
                              className="rounded-full border border-amber-400/40 px-2 py-0.5 text-xs text-amber-300"
                              title={`Invoiced more than ${STALE_INVOICE_HOURS}h ago and still unpaid — nudge the buyer, or cancel the invoice to put the records back on the shop`}
                            >
                              unpaid · sent {timeAgo(order.created_at)}
                            </span>
                          ) : null}
                          <span className="ml-auto text-xs text-neutral-500">
                            {timeAgo(order.created_at)}
                            {" · "}
                            {invoiced ? (
                              "held until paid"
                            ) : o.holdUntil > Date.now() ? (
                              `~${hoursLeft}h hold left`
                            ) : (
                              <span className="text-amber-400">
                                {o.holdUntil ? "hold expired" : "not on hold"}
                              </span>
                            )}
                          </span>
                        </div>
                        {o.recs.length === 0 ? (
                          <p className="mt-3 text-sm text-amber-400">
                            No records left on this order — they were sold or
                            moved elsewhere. Cancel the invoice, or Check PayPal
                            to close it as paid.
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
                                  <li
                                    key={r.id}
                                    className="flex flex-wrap items-center gap-2"
                                  >
                                    <span className="min-w-0 flex-1">
                                      {r.artist} — {r.title}{" "}
                                      <span className="text-neutral-500">
                                        {itemSpecShort(r)}
                                      </span>
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
                                                next != null && next !== Number(r.price)
                                                  ? next
                                                  : null,
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
                              {o.totals.credit > 0 ? ` · Credit −$${o.totals.credit}` : ""}
                              {" "}· Shipping ${o.totals.shipping} ·{" "}
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
                                    {isCopied(`pending-${invoiceId}`)
                                      ? "Copied!"
                                      : "Copy payment link"}
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
                                  onClick={() => loadOrderIntoSaleDesk(o)}
                                >
                                  Load into sale desk
                                </button>
                              ) : null}
                              <button
                                type="button"
                                className="text-xs text-neutral-500 underline transition hover:text-red-300 disabled:opacity-50"
                                disabled={anyBusy}
                                onClick={() => cancelOrderInvoice(o)}
                              >
                                {busy === "cancel" ? "Cancelling…" : "Cancel invoice"}
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                className={buttonClass}
                                onClick={() => loadOrderIntoSaleDesk(o)}
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
                                className="text-xs text-neutral-500 underline transition hover:text-red-300 disabled:opacity-50"
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
              </>
            ) : null}

            {/* Mail to orders@curiouserrecords.com */}
            <h2 id="messages" className="mt-10 scroll-mt-24 text-xl font-medium">
              Messages{" "}
              {newMessageCount > 0 ? (
                <span className="text-sm text-amber-400">({newMessageCount} new)</span>
              ) : (
                <span className="text-sm text-neutral-400">({messages.length} open)</span>
              )}
            </h2>
            <p className="mt-1 text-sm text-neutral-400">
              Email sent to orders@curiouserrecords.com lands here (a copy goes
              to your Gmail too). Reply from here as orders@, or load the
              records it talks about onto the sale desk.
            </p>
            {messages.length === 0 ? (
              <p className="mt-3 text-sm text-neutral-400">No open messages.</p>
            ) : (
              <div className="mt-3 grid gap-3">
                {messages.map((m) => {
                  const open = openMessageId === m.id;
                  const req =
                    m.request_id != null
                      ? orderRequests.find((r) => r.id === m.request_id) ?? null
                      : null;
                  const busy = messageBusy === m.id;
                  return (
                    <div
                      key={m.id}
                      className={`rounded-2xl border p-4 ${
                        m.status === "new"
                          ? "border-amber-400/30 bg-white/5"
                          : "border-white/10 bg-white/5"
                      }`}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => toggleMessage(m)}
                          className="text-left font-medium text-white transition hover:text-amber-200"
                          aria-expanded={open}
                        >
                          {m.from_name || m.from_email}
                        </button>
                        {m.from_name ? (
                          <a
                            href={`mailto:${m.from_email}`}
                            className="text-sm text-sky-300 underline-offset-2 hover:underline"
                          >
                            {m.from_email}
                          </a>
                        ) : null}
                        <span
                          className={`rounded-full border px-2 py-0.5 text-xs ${
                            m.status === "new"
                              ? "border-amber-400/40 text-amber-300"
                              : m.status === "replied"
                                ? "border-emerald-500/40 text-emerald-300"
                                : "border-white/15 text-neutral-400"
                          }`}
                        >
                          {m.status}
                        </span>
                        {m.ref_code ? (
                          <span
                            className="font-mono text-xs text-amber-300"
                            title={req ? "Matches a saved request" : "Ref code in the message"}
                          >
                            {m.ref_code}
                            {req ? ` · $${req.total}` : ""}
                          </span>
                        ) : null}
                        <span className="ml-auto text-xs text-neutral-500">
                          {timeAgo(m.received_at)}
                        </span>
                      </div>
                      <p className="mt-2 text-sm text-neutral-200">
                        {m.subject?.trim() || <span className="text-neutral-500">(no subject)</span>}
                      </p>
                      {open ? (
                        <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words font-sans text-sm text-neutral-300">
                          {bodyText(m) || "(empty message)"}
                        </pre>
                      ) : (
                        <button
                          type="button"
                          onClick={() => toggleMessage(m)}
                          className="mt-1 block text-left text-sm text-neutral-400 transition hover:text-neutral-200"
                        >
                          {messageSummary(m) || "(empty message)"}
                        </button>
                      )}
                      {open ? (
                        <div className="mt-3">
                          <textarea
                            value={replyDraft}
                            onChange={(e) => setReplyDraft(e.target.value)}
                            rows={4}
                            placeholder="Reply as orders@curiouserrecords.com…"
                            className={`w-full max-w-3xl ${inputClass}`}
                          />
                        </div>
                      ) : null}
                      <div className="mt-3 flex flex-wrap gap-2">
                        {open ? (
                          <button
                            type="button"
                            className={buttonClass}
                            disabled={!replyDraft.trim() || busy}
                            onClick={() => sendMessageReply(m)}
                          >
                            {busy ? "Sending…" : "Send reply"}
                          </button>
                        ) : (
                          <button
                            type="button"
                            className={buttonClass}
                            onClick={() => toggleMessage(m)}
                          >
                            Open &amp; reply
                          </button>
                        )}
                        <button
                          type="button"
                          className={buttonClass}
                          onClick={() => loadMessageIntoSaleDesk(m)}
                          title={
                            req
                              ? `Load request ${req.ref_code} into the sale desk`
                              : "Parse the record lines in this message and pick them for the desk"
                          }
                        >
                          Load into sale desk
                        </button>
                        {m.status === "new" ? (
                          <button
                            type="button"
                            className={buttonClass}
                            onClick={() => setMessageStatus(m, "read")}
                          >
                            Mark read
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className={buttonClass}
                          onClick={() => setMessageStatus(m, "archived")}
                        >
                          Archive
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <ReviewsSection />

            <h2 id="paste-dm" className="mt-10 scroll-mt-24 text-xl font-medium">Paste a DM</h2>
            <p className="mt-1 text-sm text-neutral-400">
              Paste the buyer&rsquo;s message — even edited — and it&rsquo;s
              matched against your listings for review. Nothing is selected
              until you confirm.
            </p>
            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              rows={6}
              placeholder={
                "1. Artist — Title — Media: M / Sleeve: NM — $63\n2. …"
              }
              className={`mt-3 w-full max-w-3xl ${inputClass}`}
            />
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                className={buttonClass}
                disabled={!pasteText.trim()}
                onClick={parsePasted}
              >
                Parse
              </button>
              {parseResult ? (
                <button
                  type="button"
                  className={buttonClass}
                  onClick={() => {
                    setPasteText("");
                    setParseResult(null);
                  }}
                >
                  Clear
                </button>
              ) : null}
            </div>
            {parseResult ? (
              <div className="mt-3 max-w-3xl space-y-2 text-sm">
                {parseResult.refRequest ? (
                  <div className="flex flex-wrap items-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3">
                    <span className="text-emerald-300">
                      Exact match: saved request{" "}
                      <span className="font-mono">
                        {parseResult.refRequest.ref_code}
                      </span>{" "}
                      ({parseResult.refRequest.record_ids.length} records, $
                      {parseResult.refRequest.total}
                      {parseResult.refRequest.channel === "email"
                        ? ` · ${parseResult.refRequest.buyer_name ?? ""} ${parseResult.refRequest.buyer_email ?? ""}`.trimEnd()
                        : parseResult.refRequest.buyer_username
                          ? ` · u/${parseResult.refRequest.buyer_username}`
                          : ""}
                      {parseResult.refRequest.status !== "new" &&
                      parseResult.refRequest.status !== "loaded"
                        ? ` · ${parseResult.refRequest.status}`
                        : ""}
                      )
                    </span>
                    <button
                      type="button"
                      className={buttonClass}
                      onClick={() =>
                        loadRequestIntoSaleDesk(parseResult.refRequest!)
                      }
                    >
                      Load request
                    </button>
                  </div>
                ) : parseResult.ref ? (
                  <p className="text-amber-400">
                    Ref code {parseResult.ref} found, but no saved request
                    matches it — using the parsed lines below.
                  </p>
                ) : null}
                {parseResult.rows.length === 0 ? (
                  <p className="text-neutral-400">
                    No order lines found in the pasted text.
                  </p>
                ) : (
                  parseResult.rows.map((row, i) => {
                    if (row.status === "matched" && row.match) {
                      const excluded = row.match.sold;
                      return (
                        <div
                          key={i}
                          className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-3 py-2"
                        >
                          <span className="text-emerald-400">✓</span>{" "}
                          {row.match.artist} — {row.match.title} ($
                          {row.match.price})
                          {row.flags && row.flags.length > 0 ? (
                            <span className="text-amber-400">
                              {" "}
                              · {row.flags.join(" · ")}
                              {excluded ? " — will not be selected" : ""}
                            </span>
                          ) : null}
                        </div>
                      );
                    }
                    if (row.status === "ambiguous") {
                      return (
                        <div
                          key={i}
                          className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2"
                        >
                          <p className="text-amber-300">
                            Which record is &ldquo;{row.parsed.raw}&rdquo;?
                          </p>
                          <div className="mt-2 space-y-1">
                            <label className="flex items-center gap-2">
                              <input
                                type="radio"
                                name={`ambiguous-${i}`}
                                className="admin-radio"
                                checked={parseResult.choices[i] === undefined}
                                onChange={() =>
                                  setParseResult((prev) => {
                                    if (!prev) return prev;
                                    const choices = { ...prev.choices };
                                    delete choices[i];
                                    return { ...prev, choices };
                                  })
                                }
                              />
                              <span className="text-neutral-400">
                                None of these
                              </span>
                            </label>
                            {(row.candidates ?? []).map((c) => {
                              const flags = recordFlags(c, row.parsed.price);
                              return (
                                <label
                                  key={c.id}
                                  className="flex items-center gap-2"
                                >
                                  <input
                                    type="radio"
                                    name={`ambiguous-${i}`}
                                    className="admin-radio"
                                    checked={parseResult.choices[i] === c.id}
                                    onChange={() =>
                                      setParseResult((prev) =>
                                        prev
                                          ? {
                                              ...prev,
                                              choices: {
                                                ...prev.choices,
                                                [i]: c.id,
                                              },
                                            }
                                          : prev
                                      )
                                    }
                                  />
                                  <span>
                                    {c.artist} — {c.title}{" "}
                                    <span className="text-neutral-500">
                                      {itemSubtitle(c)}
                                    </span>{" "}
                                    — ${c.price}
                                    {flags.length > 0 ? (
                                      <span className="text-amber-400">
                                        {" "}
                                        · {flags.join(" · ")}
                                      </span>
                                    ) : null}
                                  </span>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      );
                    }
                    return (
                      <div
                        key={i}
                        className="rounded-xl border border-red-500/30 bg-red-500/5 px-3 py-2 text-red-300"
                      >
                        No match — select manually in Listings:{" "}
                        <span className="text-red-200">{row.parsed.raw}</span>
                      </div>
                    );
                  })
                )}
                {parseResult.rows.length > 0 ? (
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      className={buttonClass}
                      disabled={parsedIds.length === 0}
                      onClick={applyParsedSelection}
                    >
                      Add {parsedIds.length} to sale desk
                    </button>
                    {!parseResult.refRequest ? (
                      <label className="flex items-center gap-2 text-sm text-neutral-400">
                        <input
                          type="checkbox"
                          checked={saveParsedChecked}
                          onChange={(e) => setSaveParsedChecked(e.target.checked)}
                          className="admin-checkbox"
                        />
                        Also save to Incoming requests
                      </label>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}

        {/* The numbers: read-only, so they sit below the work */}
        <h2 id="numbers" className="mt-12 scroll-mt-24 text-xl font-medium">Numbers</h2>
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
              title="Uses the final sold price when entered, listed price otherwise, less any credits and partial refunds on paid orders. Fully refunded orders don't count."
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
    </>
  );
}
