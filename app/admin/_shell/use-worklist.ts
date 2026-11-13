"use client";

import { useMemo } from "react";
import { worklist, type Worklist } from "@/lib/admin/worklist";
import { useAdmin, useSlice } from "./admin-provider";

// What's waiting on the seller, from the tables the provider always holds
// plus the pending price changes — a small lazy table, asked for here so
// the Pricing badge shows on every page.
export function useWorklist(): Worklist {
  const { records, shipments, invoices, orders, orderRequests, messages, reviews, pending } =
    useAdmin();
  useSlice("pending");
  return useMemo(
    () =>
      worklist({
        records,
        shipments,
        invoices,
        orders,
        orderRequests,
        messages,
        reviews,
        pendingPrices: pending,
      }),
    [records, shipments, invoices, orders, orderRequests, messages, reviews, pending]
  );
}
