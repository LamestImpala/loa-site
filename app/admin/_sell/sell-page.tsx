"use client";

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { openOrders } from "@/lib/admin/orders";
import { sellCount } from "@/lib/admin/worklist";
import { useAdmin } from "../_shell/admin-provider";
import { PageHeader, Tabs } from "../_shell/primitives";
import { useWorklist } from "../_shell/use-worklist";
import { Closed } from "./closed";
import { Conversations } from "./conversations";
import { AwaitingPayment, JustPaid } from "./open-orders";
import { usePasteDm } from "./paste-dm";
import { SaleDesk } from "./sale-desk";
import { useDesk } from "./use-desk";

// Sell (/admin/sell): everything between "a buyer wants records" and
// "paid". The conversations and the orders awaiting payment run down the
// page; the sale desk stays beside them, so a request is loaded, priced
// and invoiced without losing sight of what the buyer said. Once paid, an
// order moves down the Ship pages: Pick → Pack → Labels → Drop off.
// ?view=closed shows what has left the open list.
export function SellPage() {
  const { records, orders, invoices, saleIds } = useAdmin();
  const closedView = useSearchParams().get("view") === "closed";
  const work = useWorklist();
  const desk = useDesk();
  const paste = usePasteDm();

  // Orders in progress: held or invoiced, with the unsold records they cover.
  const open = useMemo(
    () => openOrders(orders, records, invoices),
    [orders, records, invoices]
  );
  const deskRecords = useMemo(
    () => records.filter((r) => saleIds.has(r.id) && !r.sold),
    [records, saleIds]
  );

  return (
    <>
      <PageHeader
        title="Sell"
        description="Everything between “a buyer wants records” and “paid”: conversations, the sale desk, and orders awaiting payment."
      />
      <Tabs
        label="Sell views"
        tabs={[
          {
            href: "/admin/sell",
            label: "Open",
            active: !closedView,
            count: sellCount(work),
            countLabel: "waiting on you",
          },
          { href: "/admin/sell?view=closed", label: "Closed", active: closedView },
        ]}
      />
      {closedView ? (
        <Closed />
      ) : (
        <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_26rem] lg:items-start">
          {/* The desk comes first on a phone, and stays put beside the
              lists on a wide screen. */}
          <div className="lg:sticky lg:top-4 lg:order-2 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto">
            <SaleDesk desk={desk} paste={paste} />
          </div>
          <div className="min-w-0 lg:order-1">
            <Conversations open={open} desk={desk} paste={paste} deskRecords={deskRecords} />
            <AwaitingPayment open={open} desk={desk} />
            <JustPaid />
          </div>
        </div>
      )}
    </>
  );
}
