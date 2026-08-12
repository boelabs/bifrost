import { jsonResponse, withStubbedFetch } from "./fetch.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

import "./noRealFetch.ts";

const skip = ["1", "true", "yes"].includes(process.env.ALLOW_TEST_NETWORK ?? "")
	? "ALLOW_TEST_NETWORK activo"
	: false;

test("test-support: real fetch is blocked by default", {
	skip,
}, async () => {
	await assert.rejects(
		() => fetch("https://api.openai.com/v1/models"),
		/Real fetch blocked/,
	);
});

test("test-support: withStubbedFetch allows a synthetic upstream and restores the guard", {
	skip,
}, async () => {
	const response = await withStubbedFetch(
		() => jsonResponse({ ok: true }),
		() => fetch("https://api.openai.com/v1/models"),
	);
	assert.deepEqual(await response.json(), { ok: true });

	await assert.rejects(
		() => fetch("https://api.openai.com/v1/models"),
		/Real fetch blocked/,
	);
});
