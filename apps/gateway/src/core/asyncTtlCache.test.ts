import { createAsyncTtlCache } from "./asyncTtlCache.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

test("async TTL cache coalesces concurrent loads and refreshes after expiry", async () => {
	let loads = 0;
	let currentTime = 100;
	const cache = createAsyncTtlCache(
		async () => {
			loads += 1;
			return { load: loads };
		},
		50,
		() => currentTime,
	);

	const [first, concurrent] = await Promise.all([cache.get(), cache.get()]);
	assert.strictEqual(first, concurrent);
	assert.equal(loads, 1);
	assert.strictEqual(await cache.get(), first);

	currentTime = 150;
	assert.deepEqual(await cache.get(), { load: 2 });
});

test("async TTL cache invalidation cannot be undone by an older in-flight load", async () => {
	let resolveFirst!: (value: string) => void;
	let loads = 0;
	const cache = createAsyncTtlCache(async () => {
		loads += 1;
		if (loads === 1) {
			return new Promise<string>((resolve) => {
				resolveFirst = resolve;
			});
		}
		return "fresh";
	}, 1_000);

	const staleLoad = cache.get();
	cache.invalidate();
	assert.equal(await cache.get(), "fresh");
	resolveFirst("stale");
	assert.equal(await staleLoad, "stale");
	assert.equal(await cache.get(), "fresh");
	assert.equal(loads, 2);
});
