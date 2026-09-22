import type { Metadata } from "next";
import { ShipPage } from "../_ship/ship-page";

export const metadata: Metadata = {
  title: "Send — Late Onset Audiophile",
  robots: { index: false, follow: false },
};

export default function AdminShipPage() {
  return <ShipPage />;
}
