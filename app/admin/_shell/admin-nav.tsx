"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSelectedLayoutSegment } from "next/navigation";
import {
  sellCount,
  sendCount,
  shipCount,
  shipHref,
  stockCount,
  type Worklist,
} from "@/lib/admin/worklist";
import { useWorklist } from "./use-worklist";
import { Pill, Tabs } from "./primitives";

// The admin's five destinations, in the order a sale moves. `segments` are
// the path pieces under /admin that belong to each (null is /admin itself);
// `count` is the work waiting there, shown as a badge when it isn't zero.
// Ship and Stock are several pages each — `pages` become a row of tabs
// under the header while you're on one of them.
type Page = {
  segment: string;
  href: string;
  label: string;
  count?: (w: Worklist) => number;
  countLabel?: string;
};

type Destination = {
  label: string;
  href: (w: Worklist) => string;
  segments: (string | null)[];
  count?: (w: Worklist) => number;
  countLabel?: string;
  pages?: Page[];
};

const SHIP_PAGES: Page[] = [
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
  {
    segment: "ship",
    href: "/admin/ship",
    label: "Send",
    count: sendCount,
    countLabel: "to drop off, push or sync",
  },
];

const STOCK_PAGES: Page[] = [
  {
    segment: "catalog",
    href: "/admin/catalog",
    label: "Catalog",
    count: (w) => w.toUnlist,
    countLabel: "shipped records to remove from Discogs",
  },
  {
    segment: "pricing",
    href: "/admin/pricing",
    label: "Pricing",
    count: (w) => w.priceApprovals,
    countLabel: "price changes to approve",
  },
  { segment: "reddit", href: "/admin/reddit", label: "Reddit post" },
];

const DESTINATIONS: Destination[] = [
  { label: "Today", href: () => "/admin", segments: [null] },
  {
    label: "Sell",
    href: () => "/admin/sell",
    segments: ["sell"],
    count: sellCount,
    countLabel: "requests, messages or orders needing you",
  },
  {
    label: "Ship",
    href: shipHref,
    segments: SHIP_PAGES.map((p) => p.segment),
    count: shipCount,
    countLabel: "shipping jobs waiting",
    pages: SHIP_PAGES,
  },
  {
    label: "Stock",
    href: () => "/admin/catalog",
    segments: STOCK_PAGES.map((p) => p.segment),
    count: stockCount,
    countLabel: "stock jobs waiting",
    pages: STOCK_PAGES,
  },
  {
    label: "Reviews",
    href: () => "/admin/reviews",
    segments: ["reviews"],
    count: (w) => w.pendingReviews,
    countLabel: "reviews to publish",
  },
];

export function AdminNav() {
  const segment = useSelectedLayoutSegment();
  const work = useWorklist();
  // On a phone the row scrolls; keep the current page's pill on screen
  // (again when the badges arrive and widen the row). Only the row scrolls:
  // scrollIntoView would also yank the window back up to the nav, and this
  // runs on every worklist change — every click or keystroke on a page.
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
    // One row that scrolls sideways on a phone instead of wrapping.
    <nav
      ref={navRef}
      aria-label="Admin"
      className="order-3 -mx-4 flex w-[calc(100%+2rem)] items-center gap-1.5 overflow-x-auto scroll-px-4 px-4 [scrollbar-width:none] md:order-2 md:mx-0 md:w-auto md:flex-1 md:overflow-visible md:px-0 [&::-webkit-scrollbar]:hidden"
    >
      {DESTINATIONS.map((d) => {
        const active = d.segments.includes(segment);
        const n = d.count ? d.count(work) : 0;
        return (
          <Link
            key={d.label}
            href={d.href(work)}
            aria-current={active ? "page" : undefined}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-3.5 py-1.5 text-sm transition hover:bg-white hover:text-black ${
              active
                ? "border-white/40 bg-white/10 text-white"
                : "border-white/10 text-neutral-300"
            }`}
          >
            {d.label}
            {n > 0 ? (
              <Pill tone="count" label={`${n} ${d.countLabel}`}>
                {n}
              </Pill>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}

// The pages inside Ship or Stock, as tabs under the header — only while
// you're on one of them.
export function AdminSubNav() {
  const segment = useSelectedLayoutSegment();
  const work = useWorklist();
  const dest = DESTINATIONS.find((d) => d.pages && d.segments.includes(segment));
  if (!dest?.pages) return null;
  return (
    <Tabs
      label={`${dest.label} pages`}
      tabs={dest.pages.map((p) => ({
        href: p.href,
        label: p.label,
        active: p.segment === segment,
        count: p.count?.(work),
        countLabel: p.countLabel,
      }))}
    />
  );
}

// The gear: the pages that aren't part of selling a record.
const GEAR_LINKS = [
  { segment: "settings", href: "/admin/settings", label: "Settings" },
  { segment: "pickem", href: "/admin/pickem", label: "Pick’em" },
];

export function GearMenu() {
  const segment = useSelectedLayoutSegment();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const active = GEAR_LINKS.some((l) => l.segment === segment);

  // Close on a click anywhere else and on Escape (links close it themselves).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Settings and more"
        title="Settings and more"
        onClick={() => setOpen((v) => !v)}
        className={`flex h-[38px] w-[38px] items-center justify-center rounded-lg border transition hover:bg-white hover:text-black ${
          active || open
            ? "border-white/40 bg-white/10 text-white"
            : "border-white/15 text-neutral-300"
        }`}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="h-[18px] w-[18px]"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.9 2.9l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.9-2.9l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.9-2.9l.1.1a1.7 1.7 0 0 0 1.8.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.9 2.9l-.1.1a1.7 1.7 0 0 0-.3 1.8v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
        </svg>
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-30 mt-2 w-44 overflow-hidden rounded-xl border border-white/15 bg-neutral-950 py-1 shadow-xl"
        >
          {GEAR_LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              role="menuitem"
              aria-current={l.segment === segment ? "page" : undefined}
              onClick={() => setOpen(false)}
              className={`block px-4 py-2 text-sm transition hover:bg-white hover:text-black ${
                l.segment === segment ? "text-white" : "text-neutral-300"
              }`}
            >
              {l.label}
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}
