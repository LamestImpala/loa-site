import type { Metadata } from "next";
import { PickPage } from "../_pick/pick-page";

export const metadata: Metadata = {
  title: "Pick list — Curiouser Records",
  robots: { index: false, follow: false },
};

export default function AdminPickPage() {
  return <PickPage />;
}
