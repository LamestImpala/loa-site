import type { Metadata } from "next";
import { Suspense } from "react";
import { SellPage } from "../_sell/sell-page";

export const metadata: Metadata = {
  title: "Sell — Late Onset Audiophile",
  robots: { index: false, follow: false },
};

// The Sell page reads ?view=closed, which needs a Suspense boundary
// around useSearchParams for the static prerender.
export default function AdminSellPage() {
  return (
    <Suspense fallback={<p className="mt-6 text-neutral-400">Loading…</p>}>
      <SellPage />
    </Suspense>
  );
}
