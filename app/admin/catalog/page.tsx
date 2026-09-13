import type { Metadata } from "next";
import { CatalogPage } from "../_catalog/catalog-page";

export const metadata: Metadata = {
  title: "Catalog — Late Onset Audiophile",
  robots: { index: false, follow: false },
};

export default function AdminCatalogPage() {
  return <CatalogPage />;
}
