import type { Metadata } from "next";
import AdminClient from "./admin-client";

export const metadata: Metadata = {
  title: "Admin — Late Onset Audiophile",
  robots: { index: false, follow: false },
};

export default function AdminPage() {
  return <AdminClient />;
}
