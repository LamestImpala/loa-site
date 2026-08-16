"use client";

import { Analytics, type BeforeSendEvent } from "@vercel/analytics/next";
import { shopNamespacedUrl } from "@/lib/hosts";

// Defined at module scope: <Analytics> keys an effect on this prop, so a stable
// reference keeps it from re-registering on every render.
function namespaceShopPaths(event: BeforeSendEvent): BeforeSendEvent {
  return { ...event, url: shopNamespacedUrl(event.url) };
}

export default function VercelAnalytics() {
  return <Analytics beforeSend={namespaceShopPaths} />;
}
