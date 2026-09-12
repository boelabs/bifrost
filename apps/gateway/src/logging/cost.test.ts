import { computeCost, estimateMaximumCostCents } from "./cost.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

test("input/output cost with pricing per 1M tokens", () => {
	const c = computeCost(
		{ pricing: { inputCentsPerMTokens: 150, outputCentsPerMTokens: 600 } },
		{ promptTokens: 1000, completionTokens: 500, totalTokens: 1500 },
	);
	// 1000 * 150/1e6 = 0.15 cents ; 500 * 600/1e6 = 0.30 cents
	assert.ok(Math.abs(c.inputCents - 0.15) < 1e-9);
	assert.ok(Math.abs(c.outputCents - 0.3) < 1e-9);
	assert.ok(Math.abs(c.totalCents - 0.45) < 1e-9);
});

test("cached tokens are charged at their rate and subtracted from input", () => {
	const c = computeCost(
		{
			pricing: {
				inputCentsPerMTokens: 1000,
				outputCentsPerMTokens: 0,
				cacheReadCentsPerMTokens: 100,
			},
		},
		{
			promptTokens: 1000,
			completionTokens: 0,
			totalTokens: 1000,
			cacheReadTokens: 400,
		},
	);
	// 600 uncached * 1000/1e6 = 0.6 ; 400 cached * 100/1e6 = 0.04
	assert.ok(Math.abs(c.inputCents - 0.6) < 1e-9);
	assert.ok(Math.abs(c.cacheReadCents - 0.04) < 1e-9);
	assert.ok(Math.abs(c.totalCents - 0.64) < 1e-9);
});

test("cache-write is charged at its rate and subtracted from input (along with read)", () => {
	const c = computeCost(
		{
			pricing: {
				inputCentsPerMTokens: 1000,
				outputCentsPerMTokens: 0,
				cacheReadCentsPerMTokens: 100,
				cacheWriteCentsPerMTokens: 1250,
			},
		},
		{
			promptTokens: 1000,
			completionTokens: 0,
			totalTokens: 1000,
			cacheReadTokens: 400,
			cacheWriteTokens: 200,
		},
	);
	// 400 uncached * 1000/1e6 = 0.4 ; 400 read * 100/1e6 = 0.04 ; 200 write * 1250/1e6 = 0.25
	assert.ok(Math.abs(c.inputCents - 0.4) < 1e-9);
	assert.ok(Math.abs(c.cacheReadCents - 0.04) < 1e-9);
	assert.ok(Math.abs(c.cacheWriteCents - 0.25) < 1e-9);
	assert.ok(Math.abs(c.totalCents - 0.69) < 1e-9);
});

test("cache-write without its own rate falls back to input rate", () => {
	const c = computeCost(
		{ pricing: { inputCentsPerMTokens: 1000, outputCentsPerMTokens: 0 } },
		{
			promptTokens: 1000,
			completionTokens: 0,
			totalTokens: 1000,
			cacheWriteTokens: 300,
		},
	);
	// 700 uncached * 1000/1e6 = 0.7 ; 300 write * 1000/1e6 = 0.3
	assert.ok(Math.abs(c.inputCents - 0.7) < 1e-9);
	assert.ok(Math.abs(c.cacheWriteCents - 0.3) < 1e-9);
	assert.ok(Math.abs(c.totalCents - 1.0) < 1e-9);
});

test("tiered pricing: below threshold uses base; above threshold uses tier (whole request)", () => {
	const pricing = {
		inputCentsPerMTokens: 500,
		cacheReadCentsPerMTokens: 50,
		outputCentsPerMTokens: 3000,
		tiers: [
			{
				aboveInputTokens: 272_000,
				inputCentsPerMTokens: 1000,
				cacheReadCentsPerMTokens: 100,
				outputCentsPerMTokens: 4500,
			},
		],
	};
	// 200k prompt (<=272k): base rate.
	const lo = computeCost(
		{ pricing },
		{ promptTokens: 200_000, completionTokens: 1000, totalTokens: 201_000 },
	);
	assert.ok(Math.abs(lo.inputCents - (200_000 * 500) / 1e6) < 1e-9);
	assert.ok(Math.abs(lo.outputCents - (1000 * 3000) / 1e6) < 1e-9);
	// 300k prompt (>272k): all at the tier rate, including output.
	const hi = computeCost(
		{ pricing },
		{ promptTokens: 300_000, completionTokens: 1000, totalTokens: 301_000 },
	);
	assert.ok(Math.abs(hi.inputCents - (300_000 * 1000) / 1e6) < 1e-9);
	assert.ok(Math.abs(hi.outputCents - (1000 * 4500) / 1e6) < 1e-9);
});

test("tiered pricing: tier cache read applies and is subtracted from input", () => {
	const pricing = {
		inputCentsPerMTokens: 200,
		cacheReadCentsPerMTokens: 20,
		outputCentsPerMTokens: 1200,
		tiers: [
			{
				aboveInputTokens: 200_000,
				inputCentsPerMTokens: 400,
				cacheReadCentsPerMTokens: 40,
				outputCentsPerMTokens: 1800,
			},
		],
	};
	const c = computeCost(
		{ pricing },
		{
			promptTokens: 250_000,
			completionTokens: 0,
			totalTokens: 250_000,
			cacheReadTokens: 50_000,
		},
	);
	// 200k uncached * 400/1e6 ; 50k read * 40/1e6
	assert.ok(Math.abs(c.inputCents - (200_000 * 400) / 1e6) < 1e-9);
	assert.ok(Math.abs(c.cacheReadCents - (50_000 * 40) / 1e6) < 1e-9);
});

test("without pricing cost is 0", () => {
	const c = computeCost(
		{},
		{ promptTokens: 100, completionTokens: 100, totalTokens: 200 },
	);
	assert.equal(c.totalCents, 0);
});

test("search-unit pricing is additive with token pricing", () => {
	const cost = computeCost(
		{
			pricing: {
				inputCentsPerMTokens: 100,
				outputCentsPerMTokens: 200,
				searchUnitCents: 0.25,
			},
		},
		{
			promptTokens: 1_000,
			completionTokens: 500,
			totalTokens: 1_500,
			searchUnits: 2,
			providerCostCents: 0.4,
		},
	);
	assert.equal(cost.searchUnitCents, 0.5);
	assert.equal(cost.providerReportedCents, 0.4);
	assert.ok(Math.abs(cost.totalCents - 0.7) < 1e-9);
});

test("provider-reported cost is the fallback only when pricing is absent", () => {
	const usage = {
		promptTokens: 0,
		completionTokens: 0,
		totalTokens: 0,
		searchUnits: 1,
		providerCostCents: 0.35,
	};
	assert.equal(computeCost({}, usage).totalCents, 0.35);
	assert.equal(
		computeCost({ pricing: { searchUnitCents: 0.2 } }, usage).totalCents,
		0.2,
	);
});

test("maximum cost reservation uses the highest tier and rejects unknown pricing", () => {
	assert.equal(estimateMaximumCostCents({}, 1_000), null);
	assert.equal(estimateMaximumCostCents({ pricing: {} }, 1_000), null);
	assert.equal(
		estimateMaximumCostCents(
			{
				pricing: {
					inputCentsPerMTokens: 100,
					outputCentsPerMTokens: 200,
					searchUnitCents: 0.5,
					tiers: [{ aboveInputTokens: 10, outputCentsPerMTokens: 400 }],
				},
			},
			1_000,
			2,
		),
		1.4,
	);
});
