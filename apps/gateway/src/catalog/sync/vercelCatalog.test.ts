import { buildVercelCatalog, pricingForVercelModel } from "./vercelCatalog.ts";
import type { VercelModel } from "./sources/vercel.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

function language(
	id: string,
	overrides: Partial<VercelModel> = {},
): VercelModel {
	return {
		id,
		type: "language",
		context_window: 1_000_000,
		max_tokens: 128_000,
		tags: ["reasoning", "tool-use", "vision"],
		modalities: { input: ["text", "image", "pdf"], output: ["text"] },
		supported_parameters: [
			"max_tokens",
			"temperature",
			"tools",
			"tool_choice",
			"reasoning",
			"include_reasoning",
		],
		...overrides,
	};
}

test("Vercel catalog owns full creator/model ids and source-specific text metadata", () => {
	const generated = buildVercelCatalog([
		language("minimax/minimax-m3", {
			reasoning_options: [{ type: "toggle" }],
			pricing: {
				input: "0.0000003",
				input_tiers: [
					{ cost: "0.0000003", min: 0, max: 512_000 },
					{ cost: "0.0000012", min: 512_000 },
				],
				output: "0.0000012",
				output_tiers: [
					{ cost: "0.0000012", min: 0, max: 512_000 },
					{ cost: "0.0000048", min: 512_000 },
				],
				input_cache_read: "0.00000006",
				input_cache_read_tiers: [
					{ cost: "0.00000006", min: 0, max: 512_000 },
					{ cost: "0.00000024", min: 512_000 },
				],
			},
		}),
	]);
	const entry = generated.document.models["minimax/minimax-m3"];
	const text = entry?.operations["text.generate"];
	assert.ok(text);
	assert.equal(text.maxInputTokens, 1_000_000);
	assert.equal(text.maxOutputTokens, 128_000);
	assert.deepEqual(text.modalities, {
		input: ["image", "pdf", "text"],
		output: ["text"],
	});
	assert.deepEqual(text.capabilities, {
		tools: true,
		vision: true,
		reasoning: true,
		structuredOutputs: false,
	});
	assert.deepEqual(text.reasoning, {
		kind: "openai_effort",
		levels: ["none", "high"],
	});
	assert.equal(text.parameters?.reasoning_effort, true);
	assert.deepEqual(entry.pricing, {
		inputCentsPerMTokens: 30,
		outputCentsPerMTokens: 120,
		cacheReadCentsPerMTokens: 6,
		tiers: [
			{
				aboveInputTokens: 512_000,
				inputCentsPerMTokens: 120,
				outputCentsPerMTokens: 480,
				cacheReadCentsPerMTokens: 24,
			},
		],
	});
});

test("Vercel effort levels preserve xhigh and max as distinct values", () => {
	const generated = buildVercelCatalog([
		language("openai/gpt-5.6-sol", {
			reasoning_options: [
				{
					type: "effort",
					values: ["none", "low", "high", "xhigh", "max"],
				},
			],
		}),
	]);
	assert.deepEqual(
		generated.document.models["openai/gpt-5.6-sol"]?.operations["text.generate"]
			?.reasoning,
		{
			kind: "openai_effort",
			levels: ["none", "low", "high", "xhigh", "max"],
		},
	);
});

test("Vercel sync reports future effort labels instead of silently treating them as canonical", () => {
	const generated = buildVercelCatalog([
		language("example/future-reasoner", {
			reasoning_options: [{ type: "effort", values: ["low", "high", "ultra"] }],
		}),
	]);
	assert.deepEqual(generated.report.unrecognizedReasoningEfforts, [
		{ id: "example/future-reasoner", values: ["ultra"] },
	]);
	assert.deepEqual(
		generated.document.models["example/future-reasoner"]?.operations[
			"text.generate"
		]?.reasoning,
		{ kind: "openai_effort", levels: ["low", "high"] },
	);
});

test("Vercel budget-only reasoning is reported and never turned into invented effort budgets", () => {
	const generated = buildVercelCatalog([
		language("example/budget-reasoner", {
			reasoning_options: [{ type: "budget_tokens", min: 1_024, max: 64_000 }],
		}),
	]);
	assert.deepEqual(
		generated.document.models["example/budget-reasoner"]?.operations[
			"text.generate"
		]?.reasoning,
		{ kind: "fixed", levels: ["high"] },
	);
	assert.deepEqual(generated.report.reasoningWithoutEffortLevels, [
		"example/budget-reasoner",
	]);
});

test("Vercel catalog generates conservative embedding and image profiles", () => {
	const generated = buildVercelCatalog([
		{
			id: "openai/text-embedding-3-small",
			type: "embedding",
			context_window: 8_191,
			supported_parameters: ["dimensions"],
			pricing: { input: "0.00000002" },
		},
		{
			id: "xai/grok-imagine-image",
			type: "image",
			pricing: { image: "0.02" },
		},
	]);
	assert.deepEqual(
		generated.document.models["openai/text-embedding-3-small"]?.operations[
			"embedding.create"
		],
		{
			encodingFormats: ["float", "base64"],
			maxInputTokens: 8_191,
			supportsDimensions: true,
			supportsTokenInput: false,
		},
	);
	assert.deepEqual(
		generated.document.models["xai/grok-imagine-image"]?.operations[
			"image.generate"
		],
		{
			outputFormats: ["png", "jpeg", "webp"],
			responseFormats: ["b64_json"],
			autoSize: {},
			nativeOutputFormat: false,
			nativeOutputCompression: false,
		},
	);
	assert.deepEqual(generated.report.unrepresentedPricing, [
		{ id: "xai/grok-imagine-image", field: "pricing.image" },
	]);
});

test("Vercel reranking models generate text-only profiles and safe pricing", () => {
	const generated = buildVercelCatalog([
		{
			id: "cohere/rerank-v4-pro",
			type: "reranking",
			context_window: 32_768,
			modalities: { input: ["text", "image"], output: ["rerank"] },
			pricing: { input: "0", output: "0" },
		},
		{
			id: "voyage/rerank-2.5",
			type: "reranking",
			context_window: 32_000,
			pricing: { input: "0.00000005", output: "0" },
		},
	]);
	assert.deepEqual(generated.document.models["cohere/rerank-v4-pro"], {
		operations: {
			rerank: {
				documentModalities: ["text"],
				maxDocuments: 1_000,
				maxTokensPerDocument: 32_768,
				documentsPerSearchUnit: 100,
			},
		},
		pricing: { searchUnitCents: 0.25 },
	});
	assert.deepEqual(generated.document.models["voyage/rerank-2.5"]?.pricing, {
		inputCentsPerMTokens: 5,
		outputCentsPerMTokens: 0,
	});
	assert.deepEqual(generated.report.ambiguousZeroPricing, [
		"cohere/rerank-v4-pro",
	]);
	assert.deepEqual(generated.report.multimodalRerankWithheld, [
		"cohere/rerank-v4-pro",
	]);
});

test("Vercel multimodal language models expose image operations from source modalities", () => {
	const generated = buildVercelCatalog([
		language("google/gemini-image", {
			modalities: {
				input: ["text", "image"],
				output: ["text", "image"],
			},
		}),
	]);
	const operations =
		generated.document.models["google/gemini-image"]?.operations;
	assert.ok(operations?.["text.generate"]);
	assert.ok(operations?.["image.generate"]);
	assert.ok(operations?.["image.edit"]);
});

test("Vercel catalog skips operations the adapter does not implement", () => {
	const generated = buildVercelCatalog([
		{ id: "example/video", type: "video" },
		{ id: "example/speech", type: "speech" },
	]);
	assert.deepEqual(generated.document.models, {});
	assert.deepEqual(generated.report.skippedByType, { speech: 1, video: 1 });
	assert.equal(generated.report.skippedModels.length, 2);
});

test("Vercel catalog rejects duplicate source ids", () => {
	assert.throws(
		() =>
			buildVercelCatalog([
				language("example/model"),
				language("example/model"),
			]),
		/Duplicate Vercel model id/,
	);
});

test("Vercel tier conversion ignores zero thresholds and carries each active rate", () => {
	assert.deepEqual(
		pricingForVercelModel({
			input: "0.000001",
			input_tiers: [
				{ cost: "0.000001", min: 0, max: 200_001 },
				{ cost: "0.000002", min: 200_001 },
			],
			output: "0.000003",
		}),
		{
			inputCentsPerMTokens: 100,
			outputCentsPerMTokens: 300,
			tiers: [
				{
					aboveInputTokens: 200_001,
					inputCentsPerMTokens: 200,
				},
			],
		},
	);
});

test("Vercel tier conversion uses the zero tier when a redundant base field is absent", () => {
	assert.deepEqual(
		pricingForVercelModel({
			input_tiers: [{ cost: "0.0000015", min: 0 }],
		}),
		{ inputCentsPerMTokens: 150 },
	);
});
