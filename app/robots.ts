// robots.txt: the public pages and what renders them, nothing else (#171).
// The sign-in pages and everything behind them also say noindex.

import type { MetadataRoute } from "next";
import { PUBLIC_PAGES, SITE_URL } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      // "/$" is the home page alone; the longest matching rule wins.
      allow: [...PUBLIC_PAGES.map((p) => (p.path === "/" ? "/$" : p.path)), "/_next/", "/llms.txt", "/icon-512.png", "/logo.jpeg"],
      disallow: "/",
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
