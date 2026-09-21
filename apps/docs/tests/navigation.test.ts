import { describe, expect, it } from "bun:test";
import { resolve } from "node:path";

/**
 * The sidebar and the pages on disk cannot drift apart, and the URLs cannot move.
 *
 * Both are silent failures. A page missing from its folder's `meta.json` still builds and is still
 * reachable — it is simply invisible in the navigation, which is how documentation goes unread. And
 * a page that changes URL still builds too; it just breaks every link anyone ever saved.
 */
const root = resolve(import.meta.dir, "../content/docs");

/** `dir` is relative to `content/docs`; the empty string is that directory itself. */
async function meta(dir: string): Promise<{
	pages?: string[];
	root?: boolean;
	title?: string;
}> {
	return Bun.file(resolve(root, dir, "meta.json")).json();
}

/** Every `meta.json` under `content/docs`, as directory paths relative to it. */
async function folders(): Promise<string[]> {
	const found: string[] = [];
	for await (const entry of new Bun.Glob("**/meta.json").scan(root)) {
		const dir = entry.replaceAll("\\", "/").split("/").slice(0, -1).join("/");
		found.push(dir);
	}
	return found.sort();
}

async function entries(dir: string, pattern: string): Promise<string[]> {
	const found: string[] = [];
	for await (const entry of new Bun.Glob(pattern).scan(resolve(root, dir))) {
		if (entry.endsWith(".es.mdx")) {
			continue;
		}
		found.push(entry.replaceAll("\\", "/"));
	}
	return found.sort();
}

describe("sidebar", () => {
	it("lists exactly the pages and folders that exist beside it", async () => {
		for (const dir of await folders()) {
			const listed = ((await meta(dir)).pages ?? [])
				.filter((item) => !item.startsWith("---"))
				.map((item) => item.replace(/^\.\.\./, ""))
				.sort();
			const present = [
				...(await entries(dir, "*.mdx")).map((f) => f.replace(/\.mdx$/, "")),
				// A nested group is listed by its folder name, parentheses included.
				...(await entries(dir, "(*)/meta.json")).map((f) => f.split("/")[0]),
			].sort();
			expect({ dir, listed }).toEqual({ dir, listed: present });
		}
	});

	it("has exactly two switcher roots, and every page belongs to one", async () => {
		const roots: string[] = [];
		for (const dir of await folders()) {
			if ((await meta(dir)).root) {
				roots.push(dir);
			}
		}
		expect(roots).toEqual(["(api)", "(docs)"]);

		for await (const entry of new Bun.Glob("**/*.mdx").scan(root)) {
			expect(entry.replaceAll("\\", "/").startsWith("(")).toBe(true);
		}
	});

	it("gives each root a page of its own, or the switcher drops it", async () => {
		// Fumadocs takes a tab's link from the root folder's index page, falling back to its first
		// direct *page* child. A root holding nothing but folders yields no link and is silently
		// left out of the switcher entirely.
		for (const dir of ["(docs)", "(api)"]) {
			expect((await entries(dir, "*.mdx")).length).toBeGreaterThan(0);
		}
	});
});

describe("urls", () => {
	it("keeps every page at the address the site has always published", async () => {
		// A `(group)` folder is stripped from the slug, exactly as Next strips a route group — which
		// is what lets pages be regrouped for the sidebar without moving a single URL. If this
		// fails, the grouping has started leaking into addresses.
		const urls = new Set<string>();
		for await (const entry of new Bun.Glob("**/*.mdx").scan(root)) {
			if (entry.endsWith(".es.mdx")) {
				continue;
			}
			const parts = entry.replaceAll("\\", "/").split("/");
			const name = parts.pop()?.replace(/\.mdx$/, "") as string;
			const kept = parts.filter((part) => !/^\(.+\)$/.test(part));
			urls.add(
				name === "index" ? "/docs" : `/docs/${[...kept, name].join("/")}`,
			);
		}

		expect(urls.has("/docs")).toBe(true);
		for (const url of [
			"/docs/quickstart",
			"/docs/api-overview",
			"/docs/deployment",
			"/docs/dashboard",
			"/docs/reference-environment",
			"/docs/providers-openai",
		]) {
			expect(urls.has(url)).toBe(true);
		}

		// Nothing may sit more than one segment below /docs: a nested address would mean a group
		// folder was named without parentheses.
		for (const url of urls) {
			expect(url.slice("/docs/".length).includes("/")).toBe(false);
		}
	});
});
