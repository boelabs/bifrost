import type { MetadataRoute } from "next";
import { connection } from "next/server";
import { source } from "#/lib/source.ts";

/**
 * The sitemap, when the site knows its own public address.
 *
 * `DOCS_SITE_URL` is read per request rather than at build time — the image carries no
 * configuration, so the same build serves a staging host and a production one. Unset, this returns
 * nothing, which is what the Astro site did: a sitemap of relative URLs is worse than no sitemap.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
	await connection();
	const site = process.env.DOCS_SITE_URL?.trim().replace(/\/+$/, "");
	if (!site) {
		return [];
	}

	return [
		{ url: site, changeFrequency: "weekly", priority: 1 },
		...source.getPages().map((page) => ({
			url: `${site}${page.url}`,
			changeFrequency: "weekly" as const,
			priority: 0.8,
		})),
	];
}
