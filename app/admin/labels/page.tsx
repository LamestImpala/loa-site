import type { Metadata } from "next";
import { LabelsPage } from "../_labels/labels-page";

export const metadata: Metadata = {
  title: "Labels — Curiouser Records",
  robots: { index: false, follow: false },
};

export default function AdminLabelsPage() {
  return <LabelsPage />;
}
