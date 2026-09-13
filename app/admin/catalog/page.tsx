import type { Metadata } from "next";
import { Suspense } from "react";
import { CatalogPage } from "../_catalog/catalog-page";

export const metadata: Metadata = {
  title: "Catalog — Late Onset Audiophile",
  robots: { index: false, follow: false },
};

// The catalog reads ?record= for its details drawer, which needs a
// Suspense boundary around useSearchParams for the static prerender.
export default function AdminCatalogPage() {
  return (
    <Suspense fallback={<p className="mt-6 text-neutral-400">Loading…</p>}>
      <CatalogPage />
    </Suspense>
  );
}
