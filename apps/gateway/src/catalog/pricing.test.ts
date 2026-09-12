import { pricing, tier } from "./pricing.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

test("pricing: base without cache or tiers", () => {
	assert.deepEqual(pricing({ input: 200, output: 800 }), {
		inputCentsPerMTokens: 200,
		outputCentsPerMTokens: 800,
	});
});

test("pricing: includes cacheRead and cacheWrite when provided", () => {
	assert.deepEqual(
		pricing({ input: 500, cacheRead: 50, cacheWrite: 625, output: 2500 }),
		{
			inputCentsPerMTokens: 500,
			outputCentsPerMTokens: 2500,
			cacheReadCentsPerMTokens: 50,
			cacheWriteCentsPerMTokens: 625,
		},
	);
});

test("tier by multiplier resolves to absolutes; cacheRead scales with the input mult", () => {
	const p = pricing({
		input: 500,
		cacheRead: 50,
		output: 3000,
		tiers: [tier(272_000, { input: 2, output: 1.5 })],
	});
	assert.deepEqual(p.tiers, [
		{
			aboveInputTokens: 272_000,
			inputCentsPerMTokens: 1000,
			outputCentsPerMTokens: 4500,
			cacheReadCentsPerMTokens: 100, // 50 x 2 (inherits the input mult)
		},
	]);
});

test("tier: cacheRead/cacheWrite do not appear if the base does not have them", () => {
	const p = pricing({
		input: 200,
		output: 800,
		tiers: [tier(200_000, { input: 2 })],
	});
	assert.deepEqual(p.tiers, [
		{
			aboveInputTokens: 200_000,
			inputCentsPerMTokens: 400,
			// output without mult -> not set; cacheRead/Write absent (no base)
		},
	]);
});
