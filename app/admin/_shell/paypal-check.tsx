"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Invoice, Order } from "@/lib/supabase";
import { openOrders, type OpenOrder } from "@/lib/admin/orders";
import { INVOICE_HOLD_UNTIL } from "@/lib/admin/records";
import { buyerLabel } from "@/lib/admin/buyers";
import { useAdmin } from "./admin-provider";

// Asking PayPal where an invoice stands. It lives in the shell, not on the
// Sell page, so the automatic pass runs whichever page the admin opens on
// — Today is the landing page now — and the Sell page's buttons share the
// same one-at-a-time lock.

// When every invoice was last checked with PayPal (ms), so reloads inside
// the window don't ask again.
const CHECKED_AT_KEY = "admin-paypal-checked-at";
const AUTO_CHECK_MINUTES = 15;

type CheckResult = "paid" | "unpaid" | "error";

type PaypalCheck = {
  // One order, with a toast saying how it went.
  checkInvoice: (o: OpenOrder) => Promise<CheckResult>;
  // Every invoiced order, one after another, with one summary. `auto` only
  // speaks up when something was paid or PayPal couldn't be reached.
  checkAllInvoices: (auto?: boolean) => Promise<void>;
  checkingAll: boolean;
  // The order PayPal is being asked about right now, in either kind of check.
  checkingOrderId: number | null;
};

const PaypalCheckContext = createContext<PaypalCheck | null>(null);

export function usePaypalCheck(): PaypalCheck {
  const ctx = useContext(PaypalCheckContext);
  if (!ctx) throw new Error("usePaypalCheck must be used inside <PaypalCheckProvider>");
  return ctx;
}

// GET asks PayPal about the invoice (and settles a paid one on the
// server); DELETE cancels it.
export async function paypalInvoiceFetch(
  supabase: SupabaseClient,
  id: string,
  method: "GET" | "DELETE"
) {
  const {
    data: { session: current },
  } = await supabase.auth.getSession();
  const res = await fetch(`/api/paypal-invoice?id=${encodeURIComponent(id)}`, {
    method,
    headers: { Authorization: `Bearer ${current?.access_token ?? ""}` },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}

const invoiced = (o: OpenOrder) =>
  o.order.status === "invoiced" && !!o.order.paypal_invoice_id;

export function PaypalCheckProvider({ children }: { children: ReactNode }) {
  const {
    supabase,
    records,
    setRecords,
    invoices,
    orders,
    loading,
    loadedAt,
    loadData,
    pushToast,
    upsertInvoiceLocal,
    upsertOrderLocal,
  } = useAdmin();

  const open = useMemo(
    () => openOrders(orders, records, invoices),
    [orders, records, invoices]
  );

  const [checkingAll, setCheckingAll] = useState(false);
  const [checkingOrderId, setCheckingOrderId] = useState<number | null>(null);
  // The lock itself: state lags a render behind, and two passes must never
  // overlap (the second would re-ask PayPal about the same invoices).
  const busy = useRef(false);

  // Ask PayPal where the invoice stands. Paid → the route marks the
  // records sold to the buyer on the server (usually the webhook already
  // has) and the order moves to Pick → Pack → Labels → Drop off.
  // `quiet` (a check-all pass) leaves "not paid yet" and errors to the
  // caller's one summary toast.
  const ask = useCallback(
    async (
      o: OpenOrder,
      quiet: boolean,
      onError?: (message: string) => void
    ): Promise<CheckResult> => {
      const id = o.order.paypal_invoice_id;
      if (!id) return "unpaid";
      setCheckingOrderId(o.order.id);
      try {
        const body = await paypalInvoiceFetch(supabase, id, "GET");
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
        setCheckingOrderId(null);
      }
    },
    [supabase, setRecords, upsertInvoiceLocal, upsertOrderLocal, pushToast, loadData]
  );

  const checkInvoice = useCallback(
    async (o: OpenOrder): Promise<CheckResult> => {
      if (busy.current) return "error";
      busy.current = true;
      try {
        return await ask(o, false);
      } finally {
        busy.current = false;
      }
    },
    [ask]
  );

  const checkAllInvoices = useCallback(
    async (auto = false) => {
      const targets = open.filter(invoiced);
      if (targets.length === 0 || busy.current) return;
      busy.current = true;
      setCheckingAll(true);
      let paid = 0;
      let failed = 0;
      let firstError = "";
      try {
        for (const o of targets) {
          const result = await ask(o, true, (m) => {
            firstError ||= m;
          });
          if (result === "paid") paid++;
          else if (result === "error") failed++;
        }
      } finally {
        busy.current = false;
        setCheckingAll(false);
      }
      // A pass PayPal never answered doesn't count — the next load retries.
      // Stamped before the reload below, which would otherwise start
      // another pass.
      if (failed < targets.length) {
        try {
          window.localStorage.setItem(CHECKED_AT_KEY, String(Date.now()));
        } catch {
          // Private mode — the next load just checks again.
        }
      }
      // Paid ones were sold on the server; one reload shows them all.
      if (paid > 0) await loadData();
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
    },
    [open, ask, loadData, pushToast]
  );

  // Each time the tables load — opening the admin, Refresh, coming back to
  // the tab — check the invoices without being asked, at most once per
  // AUTO_CHECK_MINUTES, so a payment shows up without a click per order.
  const checkAllRef = useRef(checkAllInvoices);
  useEffect(() => {
    checkAllRef.current = checkAllInvoices;
  });
  const hasInvoiced = open.some(invoiced);
  useEffect(() => {
    if (loading || !loadedAt || !hasInvoiced) return;
    let last = 0;
    try {
      last = Number(window.localStorage.getItem(CHECKED_AT_KEY) ?? 0);
    } catch {
      // Private mode — check.
    }
    if (Date.now() - last < AUTO_CHECK_MINUTES * 60 * 1000) return;
    void checkAllRef.current(true);
  }, [loading, loadedAt, hasInvoiced]);

  const value = useMemo(
    () => ({ checkInvoice, checkAllInvoices, checkingAll, checkingOrderId }),
    [checkInvoice, checkAllInvoices, checkingAll, checkingOrderId]
  );
  return (
    <PaypalCheckContext.Provider value={value}>{children}</PaypalCheckContext.Provider>
  );
}
