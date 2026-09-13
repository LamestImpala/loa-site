import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AdminGate } from "./admin-gate";
import { AdminProvider } from "./_shell/admin-provider";
import { AdminShell } from "./_shell/admin-shell";

export const metadata: Metadata = {
  title: "Admin — Late Onset Audiophile",
  robots: { index: false, follow: false },
};

// Every /admin page sits behind the sign-in gate and shares one data
// provider and page chrome. Layout state survives navigation, so the
// loaded tables and the sale-desk selection carry across pages.
export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <AdminGate>
      <AdminProvider>
        <AdminShell>{children}</AdminShell>
      </AdminProvider>
    </AdminGate>
  );
}
