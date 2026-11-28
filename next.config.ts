import type { NextConfig } from "next";
import {
  BASE_HEADERS,
  STATIC_CSP_SOURCE,
  cspHeaders,
  frameGuardHeaders,
} from "./lib/security-headers";

const dev = process.env.NODE_ENV === "development";

const nextConfig: NextConfig = {
  // A stray package-lock.json in the home directory otherwise makes Next
  // treat ~ as the workspace root and module resolution breaks.
  turbopack: {
    root: __dirname,
  },
  // Dev-only: the shop is served on shop.localhost (see proxy.ts).
  allowedDevOrigins: ["shop.localhost"],
  // Don't advertise the framework in an X-Powered-By header.
  poweredByHeader: false,
  // Security headers (lib/security-headers.ts). The first rule covers every
  // response. The second adds the content security policy to everything
  // except /admin and /pickem, where proxy.ts sends one with a per-request
  // nonce instead.
  async headers() {
    return [
      { source: "/:path*", headers: [...BASE_HEADERS, ...frameGuardHeaders()] },
      { source: STATIC_CSP_SOURCE, headers: cspHeaders({ dev }) },
    ];
  },
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
