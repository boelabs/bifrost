import { parsePricing, type Pricing } from "./pricing.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

test("pricing: accepts every gateway rate and keeps zero values", () => {
	const pricing = {
		inputCentsPerMTokens: 0,
		outputCentsPerMTokens: 12.5,
		cacheReadCentsPerMTokens: 0,
		cacheWriteCentsPerMTokens: 7,
		searchUnitCents: 0,
	};

	assert.deepEqual(parsePricing(pricing), pricing);
});

test("pricing: accepts complete tiered pricing and round-trips a clone", () => {
	const pricing: Pricing = {
		inputCentsPerMTokens: 150,
		outputCentsPerMTokens: 600,
		cacheReadCentsPerMTokens: 75,
		cacheWriteCentsPerMTokens: 200,
		searchUnitCents: 0.25,
		tiers: [
			{
				aboveInputTokens: 128_000,
				inputCentsPerMTokens: 300,
				outputCentsPerMTokens: 900,
				cacheReadCentsPerMTokens: 150,
				cacheWriteCentsPerMTokens: 400,
			},
			{ aboveInputTokens: 1_000_000, outputCentsPerMTokens: 1200 },
		],
	};

	const parsed = parsePricing(pricing);
	assert.deepEqual(parsed, pricing);
	assert.notEqual(parsed, pricing);
	assert.notEqual(parsed?.tiers, pricing.tiers);
});

test("pricing: blank values are absent while an empty object is valid", () => {
	assert.equal(parsePricing(undefined), undefined);
	assert.equal(parsePricing(null), undefined);
	assert.deepEqual(parsePricing({}), {});
	assert.deepEqual(parsePricing({ inputCentsPerMTokens: 0 }), {
		inputCentsPerMTokens: 0,
	});
});

test("pricing: rejects invalid rates and malformed tiers", () => {
	for (const value of [
		{ inputCentsPerMTokens: -1 },
		{ outputCentsPerMTokens: Number.NaN },
		{ cacheReadCentsPerMTokens: Number.POSITIVE_INFINITY },
		{ tiers: [{ aboveInputTokens: 0 }] },
		{ tiers: [{ aboveInputTokens: 1.5 }] },
		{ tiers: [{ aboveInputTokens: 1 }, { aboveInputTokens: 1 }] },
		{ tiers: [{ aboveInputTokens: 1, searchUnitCents: 1 }] },
		{ unexpected: 1 },
	]) {
		assert.throws(() => parsePricing(value), /Invalid pricing/);
	}
});
