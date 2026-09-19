import { renderToStaticMarkup } from "react-dom/server";
import assert from "node:assert/strict";
import { Markdown } from "./Markdown";
import { test } from "node:test";

test("code stays visible without a worker, including blank lines and escaped HTML", () => {
	for (const streaming of [true, false]) {
		const html = renderToStaticMarkup(
			<Markdown
				streaming={streaming}
				text={'```unknown-language\nconst tag = "<script>";\n\nlast line\n```'}
			/>,
		);
		assert.match(html, /data-language="unknown-language"/);
		assert.match(html, /const tag = &quot;&lt;script&gt;&quot;;/);
		assert.match(html, />last line<\/span>/);
		assert.equal((html.match(/class="playground-code-line"/g) ?? []).length, 3);
		assert.doesNotMatch(html, /<script>|Formatting could not load/);
	}
});

test("inline code stays inline and unfinished fenced code retains its final characters", () => {
	const html = renderToStaticMarkup(
		<Markdown streaming text={'Use `value`.\n\n```ts\nconst value = "par'} />,
	);
	assert.match(html, /data-streamdown="inline-code"/);
	assert.equal((html.match(/data-streamdown="code-block"/g) ?? []).length, 1);
	assert.match(html, /const value = &quot;par<\/span>/);
});
