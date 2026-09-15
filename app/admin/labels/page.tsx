import type { Metadata } from "next";
import { LabelsPage } from "../_labels/labels-page";

export const metadata: Metadata = {
  title: "Labels — Late Onset Audiophile",
  robots: { index: false, follow: false },
};

export default function AdminLabelsPage() {
  return <LabelsPage />;
}
