import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A stray package-lock.json in the home directory otherwise makes Next
  // treat ~ as the workspace root and module resolution breaks.
  turbopack: {
    root: __dirname,
  },
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
