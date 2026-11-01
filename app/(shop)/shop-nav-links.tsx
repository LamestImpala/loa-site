"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SHOP_PATH_PREFIX } from "@/lib/hosts";

// Records | Posters | Equipment. Each link is "current"
// on its list page and on its items' detail pages, so the shopper always
// sees which wall they're looking at.
const LINKS: { href: string; label: string; match: RegExp }[] = [
  { href: "/", label: "Records", match: /^\/(r\/|$)/ },
  { href: "/posters", label: "Posters", match: /^\/(posters|p\/)/ },
  { href: "/equipment", label: "Equipment", match: /^\/(equipment|e\/)/ },
];

export default function ShopNavLinks() {
  const pathname = usePathname() ?? "/";
  // On localhost the shop is served under /records; on the real host at /.
  const path = pathname.startsWith(SHOP_PATH_PREFIX)
    ? pathname.slice(SHOP_PATH_PREFIX.length) || "/"
    : pathname;
  return (
    <div className="shop-nav-links">
      {LINKS.map((l) => (
        <Link key={l.href} href={l.href} aria-current={l.match.test(path) ? "page" : undefined}>
          {l.label}
        </Link>
      ))}
    </div>
  );
}
