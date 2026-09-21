import type { ReactNode } from "react";

// The banner a page shows when its job is done: what just finished, and a
// link to the page the order goes to next.
export function NextStep({ children }: { children: ReactNode }) {
  return (
    <div
      role="status"
      className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200"
    >
      {children}
    </div>
  );
}

export const nextStepLinkClass =
  "font-medium text-white underline underline-offset-2 transition hover:text-emerald-200";
