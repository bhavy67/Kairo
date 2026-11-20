import type { NextConfig } from "next";

/**
 * Two ways to serve /api:
 * - API_URL set (local dev, Docker): proxy to the standalone Fastify server,
 *   which also runs the in-process EOD scheduler.
 * - API_URL unset (Vercel): src/app/api/[...path] runs Fastify in-process;
 *   Vercel Cron drives the EOD import.
 */
const API_URL = process.env.API_URL;

const config: NextConfig = {
  poweredByHeader: false,
  output: process.env.VERCEL ? undefined : "standalone",
  // Server-only Node packages: load them at runtime instead of bundling.
  serverExternalPackages: ["@kairo/api", "fastify", "@fastify/cookie", "pg", "@electric-sql/pglite"],
  // Old routes from before the five-tab structure keep working.
  async redirects() {
    return [
      { source: "/holdings", destination: "/portfolio", permanent: true },
      { source: "/funds", destination: "/portfolio/funds", permanent: true },
      { source: "/returns", destination: "/portfolio/returns", permanent: true },
      { source: "/global", destination: "/markets/global", permanent: true },
      { source: "/watchlist", destination: "/watch", permanent: true },
      { source: "/alerts", destination: "/watch/alerts", permanent: true },
      { source: "/screener", destination: "/markets/screener", permanent: true },
    ];
  },
  async rewrites() {
    return API_URL ? { beforeFiles: [{ source: "/api/:path*", destination: `${API_URL}/api/:path*` }], afterFiles: [], fallback: [] } : [];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
        ],
      },
    ];
  },
};

export default config;
