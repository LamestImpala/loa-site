import { notFound } from "next/navigation";

// Any shop URL without a page of its own (curiouserrecords.com/about, a
// mistyped link) lands here, so the 404 renders inside the shop layout
// instead of the bare default page.
export default function UnknownShopPage() {
  notFound();
}
