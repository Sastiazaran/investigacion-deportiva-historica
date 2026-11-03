import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      { source: "/calibration", destination: "/football/calibration", permanent: false },
      { source: "/team/:slug", destination: "/football/team/:slug", permanent: false },
    ];
  },
  async rewrites() {
    return [
      { source: "/api/summary", destination: "/data/summary.json" },
      { source: "/api/summary.json", destination: "/data/summary.json" },
      { source: "/api/nfl/summary", destination: "/data/nfl/summary.json" },
      { source: "/api/nba/summary", destination: "/data/nba/summary.json" },
      { source: "/api/mlb/summary", destination: "/data/mlb/summary.json" },
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
