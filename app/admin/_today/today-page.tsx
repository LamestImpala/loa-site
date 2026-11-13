"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { movedInboxHash, todayCount, todayGroups } from "@/lib/admin/today";
import {
  fetchShippingPause,
  shippingPauseSentence,
  type ShippingPause,
} from "@/lib/shipping-pause";
import { useAdmin } from "../_shell/admin-provider";
import { NeedsFixing } from "../_shell/needs-fixing";
import { PageHeader, Pill } from "../_shell/primitives";
import { useWorklist } from "../_shell/use-worklist";
import { Numbers } from "./numbers";

// Today (/admin): the admin's home. Everything waiting on the seller as
// one to-do list, grouped the way a sale moves — Sell, Ship, Stock, After
// the sale — with each row linking to the exact spot it gets cleared.
// Above it, anything that went quietly wrong and a reminder while the
// away notice is showing on the shop; below it, the Numbers.
export function TodayPage() {
  const { supabase, records, loading, loadedAt } = useAdmin();
  const router = useRouter();
  const work = useWorklist();
  const groups = useMemo(() => todayGroups(work), [work]);
  const total = todayCount(groups);

  // /admin used to be the Inbox: links in emails already sent land here
  // with the old section's #anchor. Send them on to where it moved.
  useEffect(() => {
    const moved = movedInboxHash(window.location.hash);
    if (moved) router.replace(moved);
  }, [router]);

  // The away notice, while it's showing on the shop — easy to forget it's on.
  const [pause, setPause] = useState<ShippingPause | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchShippingPause(supabase).then(
      (p) => {
        if (!cancelled) setPause(p);
      },
      () => {} // No reminder is fine; Settings shows the notice itself.
    );
    return () => {
      cancelled = true;
    };
  }, [supabase, loadedAt]);

  const firstLoad = loading && records.length === 0;

  return (
    <>
      <PageHeader
        title="Today"
        description={
          firstLoad
            ? "Checking what’s waiting…"
            : total === 0
              ? "Nothing is waiting on you."
              : "Everything waiting on you, in the order a sale moves. Each line opens the spot where it gets done."
        }
      />

      {pause ? (
        <p className="mt-6 flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-2xl border border-sky-400/30 bg-sky-400/10 px-4 py-3 text-sm text-sky-100">
          <span className="font-medium">Your away notice is showing on the shop.</span>
          <span className="text-sky-100/80">“{shippingPauseSentence(pause)}”</span>
          <Link
            href="/admin/settings"
            className="text-sky-200 underline underline-offset-2 transition hover:text-white"
          >
            Change or clear it →
          </Link>
        </p>
      ) : null}

      <NeedsFixing />

      <div className="mt-6 grid gap-3 md:grid-cols-2">
        {groups.map((g) => (
          <section
            key={g.key}
            aria-labelledby={`today-${g.key}`}
            className="rounded-2xl border border-white/10 bg-white/5 p-4"
          >
            <h2 id={`today-${g.key}`} className="flex items-center gap-2 font-medium">
              <Link
                href={g.href}
                className="underline-offset-4 transition hover:underline"
              >
                {g.label}
              </Link>
              {g.count > 0 ? (
                <Pill tone="count" label={`${g.count} waiting`}>
                  {g.count}
                </Pill>
              ) : null}
            </h2>
            {firstLoad ? (
              <p className="mt-3 h-5 w-40 animate-pulse rounded bg-white/10" />
            ) : g.rows.length === 0 ? (
              <p className="mt-2 text-sm text-neutral-500">Nothing waiting.</p>
            ) : (
              <ul className="-mx-2 mt-2 grid">
                {g.rows.map((r) => (
                  <li key={r.key}>
                    <Link
                      href={r.href}
                      className="group flex items-baseline gap-3 rounded-lg px-2 py-1.5 text-sm transition hover:bg-white/10"
                    >
                      <span
                        className={`w-7 shrink-0 text-right text-base font-semibold tabular-nums ${
                          r.urgent
                            ? "text-amber-300"
                            : r.waiting
                              ? "text-neutral-500"
                              : "text-white"
                        }`}
                      >
                        {r.n}
                      </span>
                      <span className={r.waiting ? "text-neutral-400" : "text-neutral-200"}>
                        {r.label}
                        {r.waiting ? (
                          <span className="text-neutral-500"> — waiting on the buyer</span>
                        ) : null}
                      </span>
                      <span
                        aria-hidden="true"
                        className="ml-auto text-neutral-600 transition group-hover:text-white"
                      >
                        →
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>

      <Numbers />
    </>
  );
}
