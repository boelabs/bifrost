import { applyHighlight, type HighlightResult } from "./codeHighlight";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import { createCodeHighlighter } from "./codeHighlighter";
import { createHighlighter } from "shiki";
import assert from "node:assert/strict";
import { test } from "node:test";

test("incremental highlighting matches whole blocks across multiline grammars", async () => {
	const engine = await createCodeHighlighter();
	const reference = await createHighlighter({
		langs: ["typescript", "python", "html", "markdown"],
		themes: ["github-light", "github-dark"],
		engine: createJavaScriptRegexEngine({ forgiving: true }),
	});
	try {
		for (const [language, code] of [
			[
				"typescript",
				// biome-ignore lint/suspicious/noTemplateCurlyInString: fixture source that must contain a literal interpolation.
				"/* comment\nstill comment */\nconst template = `first\n${1 + 2} last`;\nconst x = /a+/g;",
			],
			["python", 'value = """first\nsecond\nlast"""\nprint(value)'],
			["html", '<script>\nconst value = "hello";\n</script>\n<div>Text</div>'],
			["markdown", "# Heading\n\n```js\nconst value = 1;\n```\n**End**"],
		] as const) {
			let result: HighlightResult | undefined;
			for (let size = 1; size <= code.length; size++) {
				const request = { id: 1, language, code: code.slice(0, size) };
				const patch = await engine.highlight(request);
				const previous = result;
				result = applyHighlight(result, request, patch);
				assert.equal(
					result.lines.map((line) => line.text).join("\n"),
					request.code,
				);
				if (patch.startLine) {
					assert.equal(result.lines[0], previous?.lines[0]);
				}
				const expected = reference
					.codeToTokens(request.code, {
						lang: language,
						themes: { light: "github-light", dark: "github-dark" },
					})
					.tokens.map((line) =>
						line.map((token) => ({
							text: token.content,
							offset:
								token.offset -
								(request.code.lastIndexOf("\n", token.offset - 1) + 1),
							light: token.htmlStyle?.color ?? token.color,
							dark: token.htmlStyle?.["--shiki-dark"],
							style: token.htmlStyle?.["font-style"],
							weight: token.htmlStyle?.["font-weight"],
							decoration: token.htmlStyle?.["text-decoration"],
						})),
					);
				assert.deepEqual(
					result.lines.map((line) => line.tokens),
					expected,
					`${language}: ${size}`,
				);
			}
		}
	} finally {
		engine.dispose();
		reference.dispose();
	}
});

test("highlighting resets on edits, language changes and released blocks", async () => {
	const engine = await createCodeHighlighter();
	try {
		await engine.highlight({
			id: 1,
			language: "ts",
			code: "const a = 1;\nconst b",
		});
		const appended = await engine.highlight({
			id: 1,
			language: "ts",
			code: "const a = 1;\nconst b = 2;",
		});
		assert.equal(appended.startLine, 1);
		assert.ok(
			appended.lines[0]?.tokens.some((token) => token.light !== token.dark),
		);
		assert.ok(
			appended.lines[0]?.tokens.every((token) => token.light && token.dark),
		);
		assert.equal(
			(
				await engine.highlight({
					id: 2,
					language: "ts",
					code: "const a = 1;\nconst b",
				})
			).startLine,
			0,
		);
		assert.equal(
			(
				await engine.highlight({
					id: 1,
					language: "ts",
					code: "const a = 3;\nconst b",
				})
			).startLine,
			0,
		);
		assert.equal(
			(
				await engine.highlight({
					id: 1,
					language: "unknown-language",
					code: "const a = 3;\nconst b",
				})
			).startLine,
			0,
		);
		engine.release(1);
		assert.equal(
			(
				await engine.highlight({
					id: 1,
					language: "unknown-language",
					code: "const a = 3;\nconst b",
				})
			).startLine,
			0,
		);
	} finally {
		engine.dispose();
	}
});
