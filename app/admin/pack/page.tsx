import type { Metadata } from "next";
import { PackPage } from "../_pack/pack-page";

export const metadata: Metadata = {
  title: "Pack — Late Onset Audiophile",
  robots: { index: false, follow: false },
};

export default function AdminPackPage() {
  return <PackPage />;
}
