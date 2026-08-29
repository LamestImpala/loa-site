import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { SHOP_HOST, matchesHost } from "@/lib/hosts";

// headers() makes this dynamic so each host's robots.txt points at its own
// sitemap instead of always at the LOA domain.
export default async function robots(): Promise<MetadataRoute.Robots> {
  const host = (await headers()).get("host")?.split(":")[0] ?? "";
  const base = matchesHost(host, SHOP_HOST)
    ? `https://${SHOP_HOST}`
    : "https://lateonsetaudiophile.com";

  return {
    rules: {
      userAgent: "*",
      allow: "/",
    },
    sitemap: `${base}/sitemap.xml`,
  };
}
