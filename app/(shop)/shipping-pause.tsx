"use client";

import { createContext, useContext } from "react";
import { shippingPauseSentence, type ShippingPause } from "@/lib/shipping-pause";

// The away notice, read once in the shop layout and handed to whoever needs
// it: the banner under the nav, and BuyDialog (through context, so it
// doesn't have to ride a prop through every page and client component the
// way redditPostUrl does).

const ShippingPauseContext = createContext<ShippingPause | null>(null);

export function ShippingPauseProvider({
  pause,
  children,
}: {
  pause: ShippingPause | null;
  children: React.ReactNode;
}) {
  return (
    <ShippingPauseContext.Provider value={pause}>{children}</ShippingPauseContext.Provider>
  );
}

export function useShippingPause(): ShippingPause | null {
  return useContext(ShippingPauseContext);
}

export function ShippingPauseBanner({ pause }: { pause: ShippingPause | null }) {
  if (!pause) return null;
  return (
    <p className="shop-notice" role="note">
      {shippingPauseSentence(pause)}
    </p>
  );
}
