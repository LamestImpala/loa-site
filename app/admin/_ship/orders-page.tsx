"use client";

import { useSearchParams } from "next/navigation";
import { useAdmin } from "../_shell/admin-provider";
import { NeedsFixing } from "../_shell/needs-fixing";
import { PageHeader } from "../_shell/primitives";
import { FulfillmentPanel } from "../fulfillment-panel";

// Orders: one card per paid order, from payment to "done" — its timeline,
// the one job it's waiting on, its boxes and costs, and once the boxes
// have left, the after-sale checklist. `?order=ID` opens on that order's
// card. "Needs fixing" on top (also on Today) lists states that went
// quietly wrong anywhere in a sale, each with a jump to its fix.
export function OrdersPage() {
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
  } = useAdmin();
  const focus = Number(useSearchParams().get("order"));

  if (loading && records.length === 0) {
    return <p className="mt-6 text-neutral-400">Loading…</p>;
  }

  return (
    <>
      <PageHeader
        title="Orders"
        description="Every paid order, start to finish. The bright button on a card is the one job it’s waiting on; once its boxes have left, tick off the after-sale list and mark it done."
      />

      <NeedsFixing />

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
          setRecords((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)))
        }
        onRenameBuyer={renameBuyer}
        getAccessToken={getAccessToken}
        copyText={copyText}
        pushToast={pushToast}
        confirm={confirm}
        defaultThreadUrl={postUrl}
        focusOrderId={Number.isInteger(focus) && focus > 0 ? focus : null}
      />
    </>
  );
}
