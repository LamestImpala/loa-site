"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { useSelectedLayoutSegments } from "next/navigation";
import { shipSteps, type ShipStep } from "@/lib/admin/worklist";
import { Pill } from "../_shell/primitives";
import { useWorklist } from "../_shell/use-worklist";

// The strip across every Ship page: the four steps a paid order walks
// through, numbered and in order, then Orders — where each order's card
// lives from payment to "done". A count says how much is waiting at each
// step; the step you're on is lit. Scrolls sideways on a phone.
const SEGMENT_KEY: Record<string, ShipStep["key"]> = {
  pick: "pick",
  pack: "pack",
  labels: "labels",
};

export function ShipSteps() {
  const segments = useSelectedLayoutSegments();
  const work = useWorklist();
  const steps = shipSteps(work);
  const here: ShipStep["key"] | undefined =
    segments[0] === "ship"
      ? segments[1] === "orders"
        ? "orders"
        : "dropoff"
      : SEGMENT_KEY[segments[0] ?? ""];
  // On a phone the strip scrolls; keep the step you're on in view. Only
  // the strip moves — scrollIntoView would also pull the window up to it.
  const navRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const nav = navRef.current;
    const current = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!nav || !current) return;
    const n = nav.getBoundingClientRect();
    const c = current.getBoundingClientRect();
    if (c.left < n.left) nav.scrollLeft -= n.left - c.left;
    else if (c.right > n.right) nav.scrollLeft += c.right - n.right;
    // Again when the counts arrive: their badges widen the strip.
  }, [here, work]);
  return (
    <nav
      ref={navRef}
      aria-label="Ship steps"
      className="mt-5 flex items-center gap-1.5 overflow-x-auto border-b border-white/10 pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {steps.map((s, i) => {
        const active = s.key === here;
        const isOrders = s.key === "orders";
        return (
          <span key={s.key} className="flex shrink-0 items-center gap-1.5">
            {i > 0 ? (
              isOrders ? (
                <span aria-hidden="true" className="mx-1.5 h-5 w-px bg-white/15" />
              ) : (
                <span aria-hidden="true" className="text-neutral-600">
                  →
                </span>
              )
            ) : null}
            <Link
              href={s.href}
              aria-current={active ? "page" : undefined}
              className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition hover:border-white/40 hover:text-white ${
                active
                  ? "border-white/40 bg-white/10 text-white"
                  : "border-transparent text-neutral-400"
              }`}
            >
              {isOrders ? null : (
                <span
                  aria-hidden="true"
                  className={`flex h-5 w-5 items-center justify-center rounded-full border text-[11px] leading-none ${
                    active ? "border-white/60 text-white" : "border-white/20 text-neutral-500"
                  }`}
                >
                  {i + 1}
                </span>
              )}
              {s.label}
              {s.count > 0 ? (
                <Pill tone="count" label={`${s.count} ${s.countLabel}`}>
                  {s.count}
                </Pill>
              ) : null}
            </Link>
          </span>
        );
      })}
    </nav>
  );
}
