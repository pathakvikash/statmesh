import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/mode";

export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/api/", "/chat/api", "/a/", "/v1/"] },
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
