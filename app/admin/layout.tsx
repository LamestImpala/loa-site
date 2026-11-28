import type { Metadata } from "next";
import type { ReactNode } from "react";
import { connection } from "next/server";
import { AdminGate } from "./admin-gate";
import { AdminProvider } from "./_shell/admin-provider";
import { AdminShell } from "./_shell/admin-shell";

export const metadata: Metadata = {
  title: "Admin — Curiouser Records",
  robots: { index: false, follow: false },
};

// Every /admin page sits behind the sign-in gate and shares one data
// provider and page chrome. Layout state survives navigation, so the
// loaded tables and the sale-desk selection carry across pages.
//
// connection() makes every admin page render per request instead of at
// build time. proxy.ts sends the admin a content security policy with a
// fresh nonce each time, and Next.js can only put that nonce on its
// script tags while rendering for a real request.
export default async function AdminLayout({ children }: { children: ReactNode }) {
  await connection();
  return (
    <AdminGate>
      <AdminProvider>
        <AdminShell>{children}</AdminShell>
      </AdminProvider>
    </AdminGate>
  );
}
