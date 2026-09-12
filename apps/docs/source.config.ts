import { defineConfig, defineDocs } from "fumadocs-mdx/config";

/**
 * The content collection.
 *
 * `content/docs` is the same tree Starlight read, with one change: pages now sit in `(group)`
 * folders. Fumadocs strips a parenthesised segment from the slug exactly as Next strips a route
 * group, so `content/docs/(get-started)/quickstart.mdx` is still `/docs/quickstart` — the grouping
 * buys a collapsible sidebar section and costs nothing in URLs.
 */
export const docs = defineDocs({
	dir: "content/docs",
});

export default defineConfig({
	mdxOptions: {
		rehypeCodeOptions: {
			// Matches the dashboard's code blocks, which use the same two Shiki themes.
			themes: { light: "github-light", dark: "github-dark" },
		},
	},
});
