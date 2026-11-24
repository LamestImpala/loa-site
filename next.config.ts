import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A stray package-lock.json in the home directory otherwise makes Next
  // treat ~ as the workspace root and module resolution breaks.
  turbopack: {
    root: __dirname,
  },
  // Dev-only: the shop is served on shop.localhost (see proxy.ts).
  allowedDevOrigins: ["shop.localhost"],
  images: {
    // The optimizer fetches whatever these patterns allow, so each one names
    // an exact host, no port and no query string. A field left out means
    // "anything" (see remotePatterns in the next/image docs).
    remotePatterns: [
      // Discogs covers. Every cover_image in the catalog and in the Discogs
      // collection feed is on i.discogs.com (checked Nov 24, 2026), so the
      // old *.discogs.com wildcard is gone.
      {
        protocol: "https",
        hostname: "i.discogs.com",
        port: "",
        pathname: "/**",
        search: "",
      },
      // Photos of the actual copy, in the public record-photos bucket.
      {
        protocol: "https",
        hostname: "spmbjuurarlpyqcqxyyz.supabase.co",
        port: "",
        pathname: "/storage/v1/object/public/record-photos/**",
        search: "",
      },
    ],
  },
};

export default nextConfig;
