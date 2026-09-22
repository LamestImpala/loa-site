"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { useSelectedLayoutSegment } from "next/navigation";
import { inboxCount, type Worklist } from "@/lib/admin/worklist";
import { useWorklist } from "./use-worklist";

// Top-level admin pages, grouped by job. `segment` is the path piece under
// /admin, or null on /admin itself. `count` is the work waiting on that
// page — shown as a badge when it isn't zero.
type Page = {
  segment: string | null;
  href: string;
  label: string;
  count?: (w: Worklist) => number;
  countLabel?: string;
};

const GROUPS: { label: string; pages: Page[] }[] = [
  {
    label: "Sell",
    pages: [
      {
        segment: null,
        href: "/admin",
        label: "Inbox",
        count: inboxCount,
        countLabel: "needing attention",
      },
    ],
  },
  {
    label: "Ship",
    pages: [
      {
        segment: "pick",
        href: "/admin/pick",
        label: "Pick list",
        count: (w) => w.toPull,
        countLabel: "to pull",
      },
      {
        segment: "pack",
        href: "/admin/pack",
        label: "Pack",
        count: (w) => w.toPack,
        countLabel: "to pack",
      },
      {
        segment: "labels",
        href: "/admin/labels",
        label: "Labels",
        count: (w) => w.needLabels,
        countLabel: "boxes without a label",
      },
    ],
  },
  {
    label: "Stock",
    pages: [
      { segment: "catalog", href: "/admin/catalog", label: "Catalog" },
      { segment: "pricing", href: "/admin/pricing", label: "Pricing" },
      { segment: "reddit", href: "/admin/reddit", label: "Reddit" },
    ],
  },
  {
    label: "More",
    pages: [
      { segment: "pickem", href: "/admin/pickem", label: "Pick'em" },
      { segment: "settings", href: "/admin/settings", label: "Settings" },
    ],
  },
];

export function AdminNav() {
  const segment = useSelectedLayoutSegment();
  const work = useWorklist();
  // On a phone the row scrolls; keep the current page's pill on screen
  // (again when the badges arrive and widen the row). Only the row scrolls:
  // scrollIntoView would also yank the window back up to the nav, and this
  // runs on every worklist change — every click or keystroke on the inbox.
  const navRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const nav = navRef.current;
    const pill = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!nav || !pill) return;
    const n = nav.getBoundingClientRect();
    const p = pill.getBoundingClientRect();
    const pad = 16; // matches scroll-px-4
    if (p.left < n.left + pad) nav.scrollLeft -= n.left + pad - p.left;
    else if (p.right > n.right - pad) nav.scrollLeft += p.right - (n.right - pad);
  }, [segment, work]);
  return (
    // One row that scrolls sideways on a phone instead of wrapping into
    // three rows above the pick list.
    <nav
      ref={navRef}
      aria-label="Admin pages"
      className="-mx-4 flex w-[calc(100%+2rem)] items-center gap-1.5 overflow-x-auto scroll-px-4 px-4 [scrollbar-width:none] md:mx-0 md:w-auto md:flex-wrap md:overflow-visible md:px-0 [&::-webkit-scrollbar]:hidden"
    >
      {GROUPS.map((group, gi) => (
        <div
          key={group.label}
          role="group"
          aria-label={group.label}
          className={`flex shrink-0 items-center gap-1.5 ${
            gi > 0 ? "ml-1.5 border-l border-white/10 pl-3" : ""
          }`}
        >
          {group.pages.map((p) => {
            const active = p.segment === segment;
            const n = p.count ? p.count(work) : 0;
            return (
              <Link
                key={p.href}
                href={p.href}
                aria-current={active ? "page" : undefined}
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition hover:bg-white hover:text-black ${
                  active
                    ? "border-white/40 bg-white/10 text-white"
                    : "border-white/10 text-neutral-300"
                }`}
              >
                {p.label}
                {n > 0 ? (
                  <span
                    className="rounded-full bg-amber-400 px-1.5 text-xs font-semibold leading-5 text-black"
                    aria-label={`${n} ${p.countLabel}`}
                  >
                    {n}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
