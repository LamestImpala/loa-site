"use client";

import { useMemo } from "react";
import { heldPrices } from "@/lib/admin/reddit";
import { useAdmin, useSlice } from "./admin-provider";

// Record id → when its Reddit price hold ends. A weekly post promises its
// prices for a week; the Catalog and Pricing pages read this to leave
// those prices alone (the daily price run checks the same posts itself).
export function usePriceHolds(): Map<number, string> {
  const { redditPosts } = useAdmin();
  useSlice("redditPosts");
  return useMemo(() => heldPrices(redditPosts), [redditPosts]);
}

export const holdDay = (until: string) =>
  new Date(until).toLocaleDateString("en-US", { month: "short", day: "numeric" });
