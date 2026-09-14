import type { MetadataRoute } from "next";

/**
 * Nothing here is for a search engine.
 *
 * The dashboard is an operator console: every page behind the sign-in screen is somebody's
 * deployment names, spend and key prefixes, and the sign-in screen itself is not something anyone
 * should arrive at from a search result. A blanket disallow says that once, for every crawler.
 *
 * `robots.txt` asks a crawler not to *fetch*; it does not stop a URL someone else linked from being
 * listed. The `robots` metadata in the root layout is the half that does — the two are not
 * alternatives, and this app wants both.
 *
 * No sitemap, deliberately: a sitemap is an invitation to index, which is the opposite of this file.
 */
export default function robots(): MetadataRoute.Robots {
	return {
		rules: {
			userAgent: "*",
			disallow: "/",
		},
	};
}
