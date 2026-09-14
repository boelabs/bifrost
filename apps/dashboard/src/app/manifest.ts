import type { MetadataRoute } from "next";

/**
 * The installable-app description, generated rather than served from `public/`.
 *
 * A route rather than a static file because Next then owns the `<link rel="manifest">` and the
 * content type, and because the file conventions beside it (`favicon.ico`, `icon.svg`,
 * `apple-icon.png`) already work that way — one mechanism for the whole set instead of two.
 *
 * `start_url` is the only address here, and it is relative on purpose: this image is promoted
 * between environments unchanged, so it must never learn a hostname. The 192 and 512 icons stay in
 * `public/` because a manifest needs stable paths, which the hashed `icon` route does not give.
 *
 * No request-time API is read, so it stays cached and prerendered.
 */
export default function manifest(): MetadataRoute.Manifest {
	return {
		name: "Bifrost",
		short_name: "Bifrost",
		description: "Operator dashboard for the Bifrost AI gateway.",
		start_url: "/",
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
