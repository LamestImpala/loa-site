"use client";

import { useMemo } from "react";
import { worklist, type Worklist } from "@/lib/admin/worklist";
import { useAdmin } from "./admin-provider";

// What's waiting on the seller, from the tables the provider always holds.
export function useWorklist(): Worklist {
  const { records, shipments, invoices, orders, orderRequests } = useAdmin();
  return useMemo(
    () => worklist({ records, shipments, invoices, orders, orderRequests }),
    [records, shipments, invoices, orders, orderRequests]
  );
}
