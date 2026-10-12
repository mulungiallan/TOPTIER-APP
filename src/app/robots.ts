import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/seo";

// Generated from the same env var that drives the sitemap + metadata so the
// robots.txt URL always matches the live canonical domain.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // Keep CSS/JS/images crawlable so Google can render the page, but keep
        // private/transient areas and duplicate-parameter URLs out of the index.
        disallow: [
          "/api/",
          "/admin",
          "/account/",
          "/checkout/",
          "/cart",
          "/reset-password",
          "/_next/data/",
          "/*?session=",
          "/*?ref=",
          "/*?utm_",
        ],
      },
      {
        userAgent: [
          "Googlebot",
          "Bingbot",
          "Googlebot-Image",
          "Twitterbot",
          "facebookexternalhit",
        ],
        allow: "/",
      },
      // AI search/answer engines — allowed so TOPTIER can surface in AI answers.
      // Flip to Disallow to opt out.
      {
        userAgent: [
          "GPTBot",
          "OAI-SearchBot",
          "ClaudeBot",
          "PerplexityBot",
          "Google-Extended",
        ],
        allow: "/",
      },
      { userAgent: ["AhrefsBot", "SemrushBot"], crawlDelay: 10 },
      { userAgent: "MJ12bot", disallow: "/" },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
