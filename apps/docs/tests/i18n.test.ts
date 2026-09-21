import { localizedPath } from "../src/lib/i18n.ts";
import { describe, expect, it } from "bun:test";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../content/docs");
const fences = /^```[^\n]*\n([\s\S]*?)^```/gm;
const inlineCode = /`[^`]+`/g;
const codeWhitespace = /\s+/g;
const section = /^#{2,6} /gm;
const links = /\]\(([^\s)]+)\)|href="([^"]+)"/g;

function codeBlocks(text: string): string[] {
	return [...text.matchAll(fences)].map((match) => match[1] ?? "");
}

describe("language navigation", () => {
	it("preserves the current page, query, and fragment in both directions", () => {
		for (const path of [
			"/",
			"/docs",
			"/docs/responses#streaming",
			"/docs?view=all",
		]) {
			const spanish = localizedPath(path, "es");
			expect(localizedPath(spanish, "es")).toBe(spanish);
			expect(localizedPath(spanish, "en")).toBe(path);
		}
		expect(localizedPath("/es/docs", "en")).toBe("/docs");
		expect(localizedPath("/es", "en")).toBe("/");
		expect(localizedPath("/docs", "es")).toBe("/es/docs");
	});
});

describe("translation coverage", () => {
	it("pairs every page and preserves examples, inline code, and heading anchors", async () => {
		for await (const file of new Bun.Glob("**/*.mdx").scan(root)) {
			if (file.endsWith(".es.mdx")) {
				expect(
					await Bun.file(
						resolve(root, file.replace(".es.mdx", ".mdx")),
					).exists(),
				).toBe(true);
				continue;
			}
			const english = (await Bun.file(resolve(root, file)).text()).replaceAll(
				"\r\n",
				"\n",
			);
			const translated = Bun.file(
				resolve(root, file.replace(".mdx", ".es.mdx")),
			);
			expect({ file, translated: await translated.exists() }).toEqual({
				file,
				translated: true,
			});
			const spanish = (await translated.text()).replaceAll("\r\n", "\n");
			expect({ file, examples: codeBlocks(spanish) }).toEqual({
				file,
				examples: codeBlocks(english),
			});
			const enProse = english.replace(fences, "");
			const esProse = spanish.replace(fences, "");
			expect({
				file,
				code: [...esProse.matchAll(inlineCode)]
					.map((m) => m[0].replace(codeWhitespace, " "))
					.sort(),
			}).toEqual({
				file,
				code: [...enProse.matchAll(inlineCode)]
					.map((m) => m[0].replace(codeWhitespace, " "))
					.sort(),
			});
			expect([...esProse.matchAll(/\[#([^\]]+)\]\s*$/gm)].length).toBe(
				[...enProse.matchAll(section)].length,
			);
			expect(esProse).not.toMatch(/\]\(\/docs(?:[/)#?])|href="\/docs/);
			expect(esProse).not.toMatch(/ZXQ[A-F0-9]|BLOCKFENCE/);
			expect({
				file,
				links: [...esProse.matchAll(links)]
					.map((m) => (m[1] ?? m[2] ?? "").replace("/es/docs", "/docs"))
					.sort(),
			}).toEqual({
				file,
				links: [...enProse.matchAll(links)]
					.map((m) => m[1] ?? m[2] ?? "")
					.sort(),
			});
		}
	});

	it("keeps the same pages and groups in both navigation trees", async () => {
		for await (const file of new Bun.Glob("**/meta.json").scan(root)) {
			const english = await Bun.file(resolve(root, file)).json();
			const spanish = await Bun.file(
				resolve(root, file.replace("meta.json", "meta.es.json")),
			).json();
			const entries = (pages: string[]) =>
				pages.map((page) => (page.startsWith("---") ? "---" : page));
			expect(entries(spanish.pages)).toEqual(entries(english.pages));
			expect(spanish.root).toBe(english.root);
			expect(spanish.icon).toBe(english.icon);
		}
	});
});
