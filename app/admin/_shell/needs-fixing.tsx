"use client";

import { useMemo } from "react";
import Link from "next/link";
import { integrityIssues } from "@/lib/admin/integrity";
import { useAdmin } from "./admin-provider";

// States that went quietly wrong anywhere in a sale (lib/admin/integrity),
// each with a jump to where it's fixed. Shown on Today and on Send; nothing
// renders when there's nothing to fix.
export function NeedsFixing() {
  const { records, shipments, invoices, orders, byId, readdToDiscogs, discogsReadding } =
    useAdmin();
  const issues = useMemo(
    () => integrityIssues({ records, shipments, invoices, orders }),
    [records, shipments, invoices, orders]
  );
  if (issues.length === 0) return null;
  return (
    <section
      aria-label="Needs fixing"
      className="mt-6 rounded-2xl border border-red-500/40 bg-red-500/10 p-4"
    >
      <h2 className="font-medium text-red-200">
        Needs fixing{" "}
        <span className="text-sm font-normal text-red-300/80">({issues.length})</span>
      </h2>
      <ul className="mt-2 grid gap-1.5 text-sm text-red-100">
        {issues.map((i) => {
          const readd = i.readdRecordId ? byId.get(i.readdRecordId) : undefined;
          return (
            <li key={i.key} className="flex flex-wrap items-baseline gap-x-2">
              <span>{i.text}</span>
              {readd ? (
                <button
                  type="button"
                  disabled={discogsReadding.has(readd.id)}
                  onClick={() => readdToDiscogs(readd)}
                  className="text-xs text-red-200 underline underline-offset-2 transition hover:text-white disabled:opacity-50"
                >
                  {discogsReadding.has(readd.id) ? "Re-adding…" : "Re-add →"}
                </button>
              ) : null}
              <Link
                href={i.href}
                className="text-xs text-red-300 underline underline-offset-2 transition hover:text-white"
              >
                Fix →
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
