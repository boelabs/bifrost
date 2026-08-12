import { withStubbedFetch, jsonResponse } from "#test-support/fetch.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

import {
	fetchJsonWithRetry,
	isFetchComplete,
	FetchRetryError,
	boundedMap,
} from "./fetch.ts";

test("fetchJsonWithRetry returns parsed JSON on a successful response", async () => {
	await withStubbedFetch(
		() => jsonResponse({ hello: "world" }),
		async () => {
			const result = await fetchJsonWithRetry<{ hello: string }>(
				"https://example.test/x",
			);
			assert.deepEqual(result, { hello: "world" });
		},
	);
});

test("fetchJsonWithRetry retries on 429 and succeeds once the upstream recovers", async () => {
	let calls = 0;
	await withStubbedFetch(
		() => {
			calls += 1;
			return calls === 1
				? new Response("rate limited", { status: 429 })
				: jsonResponse({ ok: true });
		},
		async () => {
			const result = await fetchJsonWithRetry<{ ok: boolean }>(
				"https://example.test/x",
				undefined,
				2,
			);
			assert.deepEqual(result, { ok: true });
			assert.equal(calls, 2);
		},
	);
});

test("fetchJsonWithRetry fails fast on a non-429 4xx without retrying", async () => {
	let calls = 0;
	await withStubbedFetch(
		() => {
			calls += 1;
			return new Response("not found", { status: 404 });
		},
		async () => {
			await assert.rejects(
				() => fetchJsonWithRetry("https://example.test/x", undefined, 3),
				FetchRetryError,
			);
			assert.equal(calls, 1);
		},
	);
});

test("fetchJsonWithRetry exhausts retries and throws on persistent 500s", async () => {
	let calls = 0;
	await withStubbedFetch(
		() => {
			calls += 1;
			return new Response("boom", { status: 500 });
		},
		async () => {
			await assert.rejects(() =>
				fetchJsonWithRetry("https://example.test/x", undefined, 1),
			);
			assert.equal(calls, 2); // initial attempt + 1 retry
		},
	);
});

test("boundedMap never runs more than `concurrency` workers at once", async () => {
	let active = 0;
	let maxActive = 0;
	const items = Array.from({ length: 10 }, (_, i) => i);
	const { succeeded } = await boundedMap(items, 3, async (item) => {
		active += 1;
		maxActive = Math.max(maxActive, active);
		await new Promise((resolve) => setTimeout(resolve, 5));
		active -= 1;
		return item * 2;
	});
	assert.ok(maxActive <= 3, `expected max 3 concurrent, saw ${maxActive}`);
	assert.equal(succeeded.size, 10);
	assert.equal(succeeded.get(4), 8);
});

test("boundedMap isolates one item's failure from the rest", async () => {
	const items = [1, 2, 3, 4];
	const { succeeded, failed } = await boundedMap(items, 2, async (item) => {
		if (item === 3) throw new Error("boom");
		return item;
	});
	assert.equal(succeeded.size, 3);
	assert.deepEqual(failed, [3]);
});

test("isFetchComplete: 0 attempts is trivially complete", () => {
	assert.equal(isFetchComplete(0, 0), true);
});

test("isFetchComplete: under the 5% failure threshold is complete", () => {
	assert.equal(isFetchComplete(100, 5), true);
	assert.equal(isFetchComplete(100, 6), false);
});
