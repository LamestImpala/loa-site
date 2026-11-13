import type { Metadata } from "next";
import { InboxPage } from "../_inbox/inbox-page";

export const metadata: Metadata = {
  title: "Sell — Late Onset Audiophile",
  robots: { index: false, follow: false },
};

export default function AdminSellPage() {
  return <InboxPage />;
}
