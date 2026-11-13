import type { Metadata } from "next";
import { DropOffPage } from "../_ship/drop-off-page";

export const metadata: Metadata = {
  title: "Drop off — Late Onset Audiophile",
  robots: { index: false, follow: false },
};

export default function AdminDropOffPage() {
  return <DropOffPage />;
}
