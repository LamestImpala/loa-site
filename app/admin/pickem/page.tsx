import type { Metadata } from "next";
import { PickemPanel } from "./pickem-panel";

export const metadata: Metadata = {
  title: "Pick'em admin — Late Onset Audiophile",
  robots: { index: false, follow: false },
};

export default function PickemAdminPage() {
  return (
    <>
      <h1 className="mt-6 text-3xl font-semibold">Pick&apos;em Admin</h1>
      <PickemPanel />
    </>
  );
}
