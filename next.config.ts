import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";

const withSerwist = withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
});

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  poweredByHeader: false,
  typescript: { ignoreBuildErrors: false },
  distDir: ".next",
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**.tradingview.com" },
      { protocol: "https", hostname: "**.sentry.io" },
    ],
  },
};

export default withSerwist(nextConfig);
