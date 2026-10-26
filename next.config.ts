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
    remotePatterns: [
      {
        protocol: "https",
        hostname: "i.discogs.com",
      },
      {
        protocol: "https",
        hostname: "*.discogs.com",
      },
      {
        protocol: "https",
        hostname: "spmbjuurarlpyqcqxyyz.supabase.co",
      },
    ],
  },
};

export default nextConfig;
