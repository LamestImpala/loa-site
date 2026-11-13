"use client";

import type { OrderRequest } from "@/lib/supabase";
import type { OpenOrder } from "@/lib/admin/orders";
import { useAdmin } from "../_shell/admin-provider";

// Ways onto the sale desk, shared by every section of the Sell page: add
// one record, or load a whole request or open order (which replaces what's
// there, after asking). The desk's contents live in the admin provider, so
// they survive a trip to the Catalog and back.
export function useDesk() {
  const {
    supabase,
    byId,
    saleIds,
    setSaleIds,
    setSaleBuyer,
    setSaleEmail,
    setSaleChannel,
    setSalePrices,
    setSaleCredit,
    setSaleCreditNote,
    setOrderRequests,
    clearSaleDesk,
    confirm,
    pushToast,
  } = useAdmin();

  // On a wide screen the desk is always in view beside the lists; on a
  // narrow one it sits above them, so bring it back into view.
  function showDesk() {
    setTimeout(() => {
      document
        .getElementById("sale-desk")
        ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 100);
  }

  function addToDesk(id: number) {
    setSaleIds((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
  }

  function removeFromDesk(ids: number[]) {
    setSaleIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.delete(id);
      return next;
    });
    setSalePrices((prev) => {
      const next = { ...prev };
      for (const id of ids) delete next[id];
      return next;
    });
  }

  // Put exactly these records on the desk. A different sale already there
  // is replaced — buyer, prices and credit with it — after asking.
  async function putOnDesk(ids: number[]): Promise<boolean> {
    const next = new Set(ids);
    const differs =
      saleIds.size !== next.size || [...saleIds].some((id) => !next.has(id));
    if (saleIds.size > 0 && differs) {
      if (
        !(await confirm(
          `Replace what's on the sale desk (${saleIds.size} record${saleIds.size === 1 ? "" : "s"})?`,
          "Replace"
        ))
      )
        return false;
      clearSaleDesk();
    }
    setSaleIds(next);
    showDesk();
    return true;
  }

  async function loadRequest(req: OrderRequest) {
    const available = req.record_ids.filter((id) => {
      const r = byId.get(id);
      return r && !r.sold;
    });
    if (available.length === 0) {
      pushToast("info", "None of this request's records are still available.");
      return false;
    }
    if (!(await putOnDesk(available))) return false;
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
    return true;
  }

  async function loadOrder(o: OpenOrder) {
    if (!(await putOnDesk(o.recs.map((r) => r.id)))) return false;
    // Seed the buyer field without clobbering a name the admin typed.
    setSaleBuyer((prev) => (prev.trim() ? prev : o.buyer));
    if (o.order.buyer_email) {
      const email = o.order.buyer_email;
      setSaleEmail((prev) => (prev.trim() ? prev : email));
      setSaleChannel("email");
    }
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
    return true;
  }

  return { addToDesk, removeFromDesk, putOnDesk, loadRequest, loadOrder, showDesk };
}

export type Desk = ReturnType<typeof useDesk>;
