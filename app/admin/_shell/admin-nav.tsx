"use client";

import Link from "next/link";
import { useSelectedLayoutSegment } from "next/navigation";

// Top-level admin pages. `segment` is the path piece under /admin, or null
// on /admin itself.
const PAGES: { segment: string | null; href: string; label: string }[] = [
  { segment: null, href: "/admin", label: "Inbox" },
  { segment: "pick", href: "/admin/pick", label: "Pick list" },
  { segment: "catalog", href: "/admin/catalog", label: "Catalog" },
  { segment: "pricing", href: "/admin/pricing", label: "Pricing" },
  { segment: "reddit", href: "/admin/reddit", label: "Reddit" },
  { segment: "pickem", href: "/admin/pickem", label: "Pick'em" },
  { segment: "settings", href: "/admin/settings", label: "Settings" },
];

export function AdminNav() {
  const segment = useSelectedLayoutSegment();
  return (
    <nav aria-label="Admin pages" className="flex flex-wrap items-center gap-1.5">
      {PAGES.map((p) => {
        const active = p.segment === segment;
        return (
          <Link
            key={p.href}
            href={p.href}
            aria-current={active ? "page" : undefined}
            className={`rounded-lg border px-3 py-1.5 text-sm transition hover:bg-white hover:text-black ${
              active
                ? "border-white/40 bg-white/10 text-white"
                : "border-white/10 text-neutral-300"
            }`}
          >
            {p.label}
          </Link>
        );
      })}
    </nav>
  );
}
