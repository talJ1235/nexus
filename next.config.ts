import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD, PHASE_PRODUCTION_SERVER } from "next/constants";

const nextConfig: NextConfig = {
  // Versions the service worker (public/sw.js caches per build).
  env: { NEXT_PUBLIC_BUILD_ID: (process.env.VERCEL_GIT_COMMIT_SHA ?? Date.now().toString(36)).slice(0, 12) },
  // Product images captured by the browser extension travel as small data URLs.
  experimental: { serverActions: { bodySizeLimit: "2mb" } },
  // The assistant's help knowledge is read from disk at runtime (lib/help/server.ts).
  outputFileTracingIncludes: { "/api/ask": ["./src/lib/help/nexus-help.md"] },
  // R15 B4: security headers on every response (the CSP with its per-request nonce is set in src/proxy.ts).
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default function config(phase: string): NextConfig {
  // R15 A1: the test-only OIDC stub can never ship (a production build or server with it on fails).
  if (process.env.AUTH_TEST_IDP === "1" && (phase === PHASE_PRODUCTION_BUILD || phase === PHASE_PRODUCTION_SERVER)) {
    throw new Error("AUTH_TEST_IDP=1 is test-only and must not be set for a production build/server");
  }
  // R15 local guard (removed in Part G): from a PC, the app only runs against a file DB, never a remote one.
  const url = process.env.TURSO_DATABASE_URL ?? "file:local.db";
  if ((phase === PHASE_DEVELOPMENT_SERVER || phase === PHASE_PRODUCTION_SERVER) && !process.env.VERCEL && process.env.R15_LOCAL_GUARD !== "0" && !url.startsWith("file:")) {
    throw new Error("R15_LOCAL_GUARD: refusing to start on a non-file TURSO_DATABASE_URL from this machine");
  }
  return nextConfig;
}
