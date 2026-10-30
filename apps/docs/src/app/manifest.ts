import type { MetadataRoute } from "next";

/**
 * The installable-app description, generated rather than served from `public/`, so that Next owns
 * the `<link rel="manifest">` and the content type — the same mechanism as the `favicon.ico`,
 * `icon.svg` and `apple-icon.png` conventions beside it.
 *
 * Unlike `sitemap.ts` this needs no public address: `start_url` is relative, so nothing here has to
 * be read per request and the route stays prerendered.
 */
export default function manifest(): MetadataRoute.Manifest {
	return {
		name: "Bifrozz",
		short_name: "Bifrozz",
		description:
			"Bifrozz by Boelabs: a provider-agnostic artificial intelligence gateway with OpenAI and Anthropic-compatible APIs.",
		start_url: "/",
		display: "standalone",
		// The icons are the brand kit's dark tile, so the splash ground matches it; an installed icon
		// has no theme to follow anyway.
		background_color: "#1d1d1d",
		theme_color: "#1d1d1d",
		icons: [
			{ src: "/icon-192.png", sizes: "192x192", type: "image/png" },
			{ src: "/icon-512.png", sizes: "512x512", type: "image/png" },
		],
	};
}
