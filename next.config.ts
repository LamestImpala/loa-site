import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
