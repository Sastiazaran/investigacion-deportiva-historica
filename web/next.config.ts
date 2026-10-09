import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      { source: "/api/summary", destination: "/data/summary.json" },
      { source: "/api/summary.json", destination: "/data/summary.json" },
    ];
  },
  async headers() {
    return [
      {
        source: "/data/:path*",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Cache-Control", value: "public, max-age=3600" },
        ],
      },
    ];
  },
};

export default nextConfig;
