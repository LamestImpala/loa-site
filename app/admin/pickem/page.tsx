import type { Metadata } from "next";
import { AdminGate } from "../admin-gate";
import { PickemAdminClient } from "./pickem-client";

export const metadata: Metadata = {
  title: "Pick'em admin — Late Onset Audiophile",
  robots: { index: false, follow: false },
};

export default function PickemAdminPage() {
  return (
    <AdminGate>
      <PickemAdminClient />
    </AdminGate>
  );
}
