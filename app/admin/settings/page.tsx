import type { Metadata } from "next";
import { SettingsPage } from "../_shell/settings-page";

export const metadata: Metadata = {
  title: "Admin settings — Late Onset Audiophile",
  robots: { index: false, follow: false },
};

export default function AdminSettingsPage() {
  return <SettingsPage />;
}
