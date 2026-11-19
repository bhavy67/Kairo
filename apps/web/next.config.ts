import type { NextConfig } from "next";

const API_URL = process.env.API_URL ?? "http://127.0.0.1:4000";

const config: NextConfig = {
  poweredByHeader: false,
  output: "standalone",
  // The browser only ever talks to this origin. /api is proxied to the Fastify
  // server, so session cookies stay first-party and we need no CORS at all.
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_URL}/api/:path*` }];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
        ],
      },
    ];
  },
};

export default config;
