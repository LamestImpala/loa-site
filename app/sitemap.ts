import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { getListedRecords } from "@/app/(shop)/records/data";
import { SHOP_HOST, matchesHost } from "@/lib/hosts";
import { recordPath } from "@/lib/record-info";

// headers() makes this dynamic so each host serves its own sitemap: the shop
// is the catalog plus one page per record; everything else is the LOA site.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const host = (await headers()).get("host")?.split(":")[0] ?? "";

  if (matchesHost(host, SHOP_HOST)) {
    // The catalog plus a page per record still for sale; sold records keep
    // their pages (old links work) but drop out of the sitemap.
    const { records } = await getListedRecords();
    return [
      {
        url: `https://${SHOP_HOST}`,
        lastModified: new Date(),
        changeFrequency: "daily",
        priority: 1,
      },
      ...records
        .filter((r) => !r.sold)
        .map((r) => ({
          url: `https://${SHOP_HOST}${recordPath(r)}`,
          lastModified: new Date(r.updated_at),
          changeFrequency: "weekly" as const,
          priority: 0.7,
        })),
    ];
  }

  const base = "https://lateonsetaudiophile.com";

  return [
    {
      url: base,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${base}/about`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.8,
    },
    {
      url: `${base}/mysystem`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.8,
    },
    {
      url: `${base}/reviews`,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 0.9,
    },
    {
      url: `${base}/reviews/marantz-pm10-vs-hegel-h390`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.9,
    },
    {
      url: `${base}/vinyl-collection`,
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 0.8,
    },
    {
      url: `${base}/music`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.7,
    },
    {
      url: `${base}/pickem`,
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 0.8,
    },
    {
      url: `${base}/contact`,
      lastModified: new Date(),
      changeFrequency: "yearly",
      priority: 0.5,
    },
  ];
}
