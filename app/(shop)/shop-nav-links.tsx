"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SHOP_PATH_PREFIX } from "@/lib/hosts";
import type { ItemKind } from "@/lib/supabase";

// Records | Posters | Equipment. Each link is "current"
// on its list page and on its items' detail pages, so the shopper always
// sees which wall they're looking at.
const LINKS: { href: string; label: string; match: RegExp; kind: ItemKind }[] = [
  { href: "/", label: "Records", match: /^\/(r\/|$)/, kind: "record" },
  { href: "/posters", label: "Posters", match: /^\/(posters|p\/)/, kind: "poster" },
  { href: "/equipment", label: "Equipment", match: /^\/(equipment|e\/)/, kind: "gear" },
];

export default function ShopNavLinks({
  empty = [],
}: {
  // Sections with nothing for sale right now (layout.tsx). A tab that leads
  // to an empty wall makes the shop look unfinished, so it stays out of the
  // nav until there is stock; its page still answers its address, and shows
  // its own tab while you are on it.
  empty?: ItemKind[];
}) {
  const pathname = usePathname() ?? "/";
  // On localhost the shop is served under /records; on the real host at /.
  const path = pathname.startsWith(SHOP_PATH_PREFIX)
    ? pathname.slice(SHOP_PATH_PREFIX.length) || "/"
    : pathname;
  return (
    <div className="shop-nav-links">
      {LINKS.filter((l) => !empty.includes(l.kind) || l.match.test(path)).map((l) => (
        <Link key={l.href} href={l.href} aria-current={l.match.test(path) ? "page" : undefined}>
          {l.label}
        </Link>
      ))}
    </div>
  );
}
