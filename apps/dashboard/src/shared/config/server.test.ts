import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { docsUrl } from "./server.ts";

const original = process.env.DOCS_URL;

afterEach(() => {
	if (original === undefined) {
		delete process.env.DOCS_URL;
	} else {
		process.env.DOCS_URL = original;
	}
});

test("without DOCS_URL there is no documentation link", () => {
	delete process.env.DOCS_URL;
	assert.equal(docsUrl(), null);
	process.env.DOCS_URL = "   ";
	assert.equal(docsUrl(), null);
});

test("DOCS_URL is read when asked, as an absolute address", () => {
	process.env.DOCS_URL = " https://docs.example.com ";
	assert.equal(docsUrl(), "https://docs.example.com/");
	process.env.DOCS_URL = "https://example.com/docs";
	assert.equal(docsUrl(), "https://example.com/docs");
});

test("a DOCS_URL that is not an http address is refused, never linked", () => {
	process.env.DOCS_URL = "docs.example.com";
	assert.throws(() => docsUrl(), /absolute URL/);
	process.env.DOCS_URL = "javascript:alert(1)";
	assert.throws(() => docsUrl(), /http or https/);
});
