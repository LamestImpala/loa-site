import type { Metadata } from "next";
import { Suspense } from "react";
import { OrdersPage } from "../../_ship/orders-page";

export const metadata: Metadata = {
  title: "Orders — Late Onset Audiophile",
  robots: { index: false, follow: false },
};

// The Orders page reads ?order= to open on one order's card, which needs
// a Suspense boundary around useSearchParams for the static prerender.
export default function AdminOrdersPage() {
  return (
    <Suspense fallback={<p className="mt-6 text-neutral-400">Loading…</p>}>
      <OrdersPage />
    </Suspense>
  );
}
