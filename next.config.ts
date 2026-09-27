import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Product images captured by the browser extension travel as small data URLs.
  experimental: { serverActions: { bodySizeLimit: "2mb" } },
};

export default nextConfig;
