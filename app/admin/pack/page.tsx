import type { Metadata } from "next";
import { PackPage } from "../_pack/pack-page";

export const metadata: Metadata = {
  title: "Pack — Curiouser Records",
  robots: { index: false, follow: false },
};

export default function AdminPackPage() {
  return <PackPage />;
}
