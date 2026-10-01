import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Versions the service worker (public/sw.js caches per build).
  env: { NEXT_PUBLIC_BUILD_ID: (process.env.VERCEL_GIT_COMMIT_SHA ?? Date.now().toString(36)).slice(0, 12) },
  // Product images captured by the browser extension travel as small data URLs.
  experimental: { serverActions: { bodySizeLimit: "2mb" } },
  // The assistant's help knowledge is read from disk at runtime (lib/help/server.ts).
  outputFileTracingIncludes: { "/api/ask": ["./src/lib/help/nexus-help.md"] },
};

export default nextConfig;
