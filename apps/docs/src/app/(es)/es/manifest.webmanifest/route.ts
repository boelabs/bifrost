import type { MetadataRoute } from "next";

/**
 * The installable-app description, generated rather than served from `public/`, so that Next owns
 * the `<link rel="manifest">` and the content type — the same mechanism as the `favicon.ico`,
 * `icon.svg` and `apple-icon.png` conventions beside it.
 *
 * Unlike `sitemap.ts` this needs no public address: `start_url` is relative, so nothing here has to
 * be read per request and the route stays prerendered.
 */
function manifest(): MetadataRoute.Manifest {
	return {
		name: "Bifrost",
		short_name: "Bifrost",
		description:
			"Bifrost de Boelabs: un gateway de IA con APIs compatibles con OpenAI y Anthropic.",
		start_url: "/es",
		display: "standalone",
		// The mark is black ink, so its ground is white in both themes; an installed icon has no
		// theme to follow anyway.
		background_color: "#ffffff",
		theme_color: "#ffffff",
		icons: [
			{ src: "/icon-192.png", sizes: "192x192", type: "image/png" },
			{ src: "/icon-512.png", sizes: "512x512", type: "image/png" },
		],
	};
}

export const dynamic = "force-static";

export function GET() {
	return Response.json(manifest(), {
		headers: { "Content-Type": "application/manifest+json" },
	});
}
