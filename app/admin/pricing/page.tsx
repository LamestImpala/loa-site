import type { Metadata } from "next";
import { PricingPage } from "../_pricing/pricing-page";

export const metadata: Metadata = {
  title: "Pricing — Late Onset Audiophile",
  robots: { index: false, follow: false },
};

export default function AdminPricingPage() {
  return <PricingPage />;
}
