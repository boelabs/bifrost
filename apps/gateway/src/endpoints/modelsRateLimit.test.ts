import { createFixedWindowRateLimiter } from "./modelsRateLimit.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

test("public model limiter isolates clients and resets at the next minute", () => {
	let timestamp = 1_000;
	const consume = createFixedWindowRateLimiter(2, () => timestamp);

	assert.equal(consume("client-a"), null);
	assert.equal(consume("client-a"), null);
	assert.equal(consume("client-b"), null);
	assert.equal(consume("client-a"), 59);

	timestamp = 60_000;
	assert.equal(consume("client-a"), null);
});
