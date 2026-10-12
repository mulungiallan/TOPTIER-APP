import type { MetadataRoute } from "next";
import { SITE_URL, absoluteUrl } from "@/lib/seo";

// Public (crawlable) pages only. Everything behind the login state-machine is
// excluded — Google can't reach authed content and we don't want to leak
// placeholder pages into the index. The domain is the live production URL so
// the sitemap stays correct on any deployment environment.
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const lastModified = now.toISOString();
  return [
    {
      url: `${SITE_URL}/`,
      lastModified,
      changeFrequency: "weekly",
      priority: 1,
      images: [absoluteUrl("/opengraph-image")],
    },
    { url: `${SITE_URL}/ugc`, lastModified, changeFrequency: "monthly", priority: 0.4 },
    { url: `${SITE_URL}/privacy`, lastModified, changeFrequency: "yearly", priority: 0.3 },
    { url: `${SITE_URL}/terms`, lastModified, changeFrequency: "yearly", priority: 0.3 },
    { url: `${SITE_URL}/account-deletion`, lastModified, changeFrequency: "yearly", priority: 0.2 },
  ];
}