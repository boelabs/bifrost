import { canonicalStringify, buildCacheKey, cachePayload } from "./cacheKey.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

test("canonicalStringify sorts keys: equivalent requests -> same string", () => {
	assert.equal(
		canonicalStringify({ b: 1, a: 2 }),
		canonicalStringify({ a: 2, b: 1 }),
	);
	assert.equal(
		canonicalStringify({ a: { y: 1, x: 2 } }),
		'{"a":{"x":2,"y":1}}',
	);
});

test("buildCacheKey: same payload -> same key; different payload -> different key", () => {
	const p1 = { model: "gpt", messages: [{ role: "user", content: "hi" }] };
	const p2 = { messages: [{ role: "user", content: "hi" }], model: "gpt" };
	const p3 = { model: "gpt", messages: [{ role: "user", content: "bye" }] };
	assert.equal(
		buildCacheKey("chat", "ns", p1),
		buildCacheKey("chat", "ns", p2),
	);
	assert.notEqual(
		buildCacheKey("chat", "ns", p1),
		buildCacheKey("chat", "ns", p3),
	);
});

test("buildCacheKey: namespace isolates tenants", () => {
	const p = { model: "gpt" };
	assert.notEqual(
		buildCacheKey("chat", "keyA", p),
		buildCacheKey("chat", "keyB", p),
	);
});

test("cachePayload removes stream and stream_options", () => {
	const out = cachePayload({
		model: "g",
		stream: true,
		stream_options: { include_usage: true },
		x: 1,
	});
	assert.deepEqual(out, { model: "g", x: 1 });
});
