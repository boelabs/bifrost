import { aggregateCacheUsage, cacheReuseRate, tokenCount } from "./cache-usage";
import assert from "node:assert/strict";
import { test } from "node:test";

test("cache usage distinguishes missing measurements from observed zero", () => {
	assert.deepEqual(aggregateCacheUsage([{}, { cacheReadTokens: null }]), {});
	assert.equal(tokenCount(undefined), "—");
	assert.equal(tokenCount(null), "—");
	assert.equal(tokenCount(0), "0");
	assert.equal(
		cacheReuseRate({ cacheReadTokens: 0, uncachedInputTokens: 100 }),
		0,
	);
	assert.equal(
		cacheReuseRate({ cacheReadTokens: 0, uncachedInputTokens: 0 }),
		null,
	);
	assert.equal(cacheReuseRate({ cacheReadTokens: 50 }), null);
});

test("cache reuse weights token volume and excludes unclassified input and writes", () => {
	const usage = aggregateCacheUsage([
		{
			cacheReadTokens: 80,
			uncachedInputTokens: 20,
			cacheWriteTokens: 10,
			cacheReadReported: 1,
		},
		{ cacheReadTokens: 0, uncachedInputTokens: 100, cacheReadReported: 1 },
		{
			cacheReadTokens: null,
			cacheUnreportedInputTokens: 800,
			cacheReadReported: 0,
		},
	]);
	assert.equal(usage.cacheReadTokens, 80);
	assert.equal(usage.uncachedInputTokens, 120);
	assert.equal(usage.cacheReadReported, 2);
	assert.equal(usage.cacheUnreportedInputTokens, 800);
	assert.equal(cacheReuseRate(usage), 0.4);
});
