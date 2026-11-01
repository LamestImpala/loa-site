"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { SHOP_PATH_PREFIX } from "@/lib/hosts";
import { trackVisit } from "./records/shop-ui";

// Logs each shop page a shopper loads (see trackVisit). Mounted by the shop
// layout only, so admin, pick'em and LOA pages never count.
export default function VisitTracker() {
  const pathname = usePathname();
  useEffect(() => {
    // On curiouserrecords.com the browser path is "/" or "/r/…"; on
    // localhost it is already /records/…. Store both the same way.
    const path = location.pathname.startsWith(SHOP_PATH_PREFIX)
      ? location.pathname
      : `${SHOP_PATH_PREFIX}${location.pathname === "/" ? "" : location.pathname}`;
    // Buyers leaving a review aren't shopping.
    if (path.startsWith(`${SHOP_PATH_PREFIX}/review/`)) return;
    trackVisit(path);
  }, [pathname]);
  return null;
}
