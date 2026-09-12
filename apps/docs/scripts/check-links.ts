import { resolve } from "node:path";

/**
 * Every internal link in the built site resolves, and every `#anchor` exists on the page it points at.
 *
 * This runs on the **prerendered HTML**, not on the MDX, which is the only way to catch the two
 * things that actually break: a link to a page that was renamed, and an anchor that no longer
 * matches a heading — because the heading ids are generated during the build, not written by hand.
 *
 * Next writes one HTML file per prerendered route under `.next/server/app`. Everything else the page
 * references is either in `public/` or under `/_next/`, which the build hashes and guarantees.
 */
const app = resolve(import.meta.dir, "../.next/server/app");
const publicDir = resolve(import.meta.dir, "../public");

/** `.next/server/app/docs/quickstart.html` -> `/docs/quickstart`; `index.html` -> `/`. */
function routeOf(entry: string): string {
	const path = entry.replaceAll("\\", "/").replace(/\.html$/, "");
	return path === "index" ? "/" : `/${path}`;
}

const pages = new Map<string, { ids: Set<string>; links: string[] }>();
for await (const entry of new Bun.Glob("**/*.html").scan(app)) {
	const page = { ids: new Set<string>(), links: [] as string[] };
	await new HTMLRewriter()
		.on("[id]", {
			element(element) {
				const id = element.getAttribute("id");
				if (id) page.ids.add(id);
			},
		})
		.on("a[href], img[src], script[src], link[href]", {
			element(element) {
				const target =
					element.getAttribute("href") ?? element.getAttribute("src");
				if (target) page.links.push(target);
			},
		})
		.transform(new Response(Bun.file(resolve(app, entry))))
		.text();
	pages.set(routeOf(entry), page);
}

const assets = new Set<string>();
for await (const entry of new Bun.Glob("**/*").scan(publicDir))
	assets.add(`/${entry.replaceAll("\\", "/")}`);

const failures = new Set<string>();
const origin = "https://docs.example.com";
for (const [route, page] of pages) {
	for (const link of page.links) {
		const target = new URL(link, origin + route);
		if (target.origin !== origin) continue;
		const path = decodeURIComponent(target.pathname).replace(/\/$/, "") || "/";
		// Hashed build output: the bundler emitted the filename, so it exists by construction.
		if (path.startsWith("/_next/")) continue;

		const destination = pages.get(path);
		if (!destination && !assets.has(path)) {
			failures.add(`${route} -> ${link} (no such page or asset)`);
		} else if (
			destination &&
			target.hash &&
			!destination.ids.has(decodeURIComponent(target.hash.slice(1)))
		) {
			failures.add(`${route} -> ${link} (no such heading)`);
		}
	}
}

if (!pages.has("/")) failures.add("Missing landing page");
if (!pages.has("/docs")) failures.add("Missing documentation overview");
if (failures.size) {
	console.error([...failures].join("\n"));
	process.exit(1);
}
console.info(
	`Checked ${pages.size} pages: all internal links and anchors resolve.`,
);
