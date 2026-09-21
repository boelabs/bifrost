import { BookOpen, Braces } from "lucide-react";
import { docs } from "../../.source/server.ts";
import { loader } from "fumadocs-core/source";
import { createElement } from "react";

/**
 * The page tree and every page's content, built from `content/docs` at compile time.
 *
 * `baseUrl` is what keeps the URLs the Astro site published: a file's slug is its path under
 * `content/docs` minus any `(group)` folder, mounted under `/docs`.
 */
export const source = loader({
	baseUrl: "/docs",
	source: docs.toFumadocsSource(),
	icon(name) {
		if (name === "BookOpen") {
			return createElement(BookOpen);
		}
		if (name === "Braces") {
			return createElement(Braces);
		}
	},
});
