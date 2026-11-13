import type { Metadata } from "next";
import { PricingPage } from "../_pricing/pricing-page";

export const metadata: Metadata = {
  title: "Pricing — Curiouser Records",
  robots: { index: false, follow: false },
};

export default function AdminPricingPage() {
  return <PricingPage />;
}
