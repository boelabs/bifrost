import { normalizeModel } from "./modelsDev.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

test("normalizeModel converts models.dev's dollars-per-million cost into cents-per-million", () => {
	// Real sample from models.dev/api.json: openai/gpt-5.
	const model = normalizeModel("openai", {
		id: "gpt-5",
		reasoning: true,
		cost: { input: 1.25, output: 10.0, cache_read: 0.125, cache_write: 1.25 },
		limit: { context: 400_000, input: 272_000, output: 128_000 },
	});
	assert.equal(model.providerIdRaw, "openai");
	assert.equal(model.modelIdRaw, "gpt-5");
	assert.equal(model.contextWindow, 400_000);
	assert.equal(model.maxOutputTokens, 128_000);
	assert.deepEqual(model.pricing, {
		inputCentsPerMTokens: 125,
		outputCentsPerMTokens: 1000,
		cacheReadCentsPerMTokens: 12.5,
		cacheWriteCentsPerMTokens: 125,
	});
	assert.equal(model.reasoning, true);
});

test("normalizeModel: reasoning_options with multiple axes (toggle + effort) both survive normalization", () => {
	// Real sample: anthropic/claude-sonnet-5 has both a toggle and an effort ladder.
	const model = normalizeModel("anthropic", {
		id: "claude-sonnet-5",
		reasoning: true,
		reasoning_options: [
			{ type: "toggle" },
			{ type: "effort", values: ["low", "medium", "high", "xhigh", "max"] },
		],
		cost: { input: 2, output: 10, cache_read: 0.2, cache_write: 2.5 },
		limit: { context: 1_000_000, output: 128_000 },
	});
	assert.deepEqual(model.reasoningOptions, [
		{ type: "toggle" },
		{ type: "effort", values: ["low", "medium", "high", "xhigh", "max"] },
	]);
});

test("normalizeModel: budget_tokens reasoning option keeps min/max, omits undefined fields", () => {
	// Real sample: anthropic/claude-sonnet-4-6 mixes an effort ladder with a budget_tokens option.
	const model = normalizeModel("anthropic", {
		id: "claude-sonnet-4-6",
		reasoning: true,
		reasoning_options: [
			{ type: "effort", values: ["low", "medium", "high", "max"] },
			{ type: "budget_tokens", min: 1024 },
		],
	});
	assert.deepEqual(model.reasoningOptions?.[1], {
		type: "budget_tokens",
		min: 1024,
	});
});

test("normalizeModel omits fields models.dev didn't report, rather than nulling them", () => {
	const model = normalizeModel("zai", { id: "glm-5.1" });
	assert.equal("cost" in model, false);
	assert.equal("pricing" in model, false);
	assert.equal("reasoningOptions" in model, false);
	assert.equal("contextWindow" in model, false);
});

test("normalizeModel drops an empty reasoning_options array instead of keeping []", () => {
	const model = normalizeModel("zai", {
		id: "glm-5.1",
		reasoning: false,
		reasoning_options: [],
	});
	assert.equal("reasoningOptions" in model, false);
});
