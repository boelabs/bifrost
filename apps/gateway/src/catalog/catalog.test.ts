import { resolveModelMetadata, getCatalogEntry } from "./index.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

const activeOpenAITextModels = [
	"gpt-5.6",
	"gpt-5.6-sol",
	"gpt-5.6-terra",
	"gpt-5.6-luna",
	"gpt-5.5",
	"gpt-5.5-pro",
	"gpt-5.4",
	"gpt-5.4-pro",
	"gpt-5.4-mini",
	"gpt-5.4-nano",
	"gpt-5.3-codex",
	"gpt-5.2",
	"gpt-5.2-pro",
	"gpt-5.1",
	"gpt-5",
	"gpt-5-mini",
	"gpt-5-nano",
	"gpt-5-pro",
	"o3-pro",
	"o3",
	"gpt-4.1",
	"gpt-4.1-mini",
	"gpt-4o-mini",
];

const activeGeminiTextModels = [
	"gemini-3.6-flash",
	"gemini-3.1-pro-preview",
	"gemini-3.1-pro-preview-customtools",
	"gemini-3.5-flash",
	"gemini-3.5-flash-lite",
	"gemini-3-flash-preview",
	"gemini-3.1-flash-lite",
	"gemini-2.5-pro",
	"gemini-2.5-flash",
	"gemini-2.5-flash-lite",
];

const activeGeminiEmbeddingModels = [
	"gemini-embedding-2",
	"gemini-embedding-001",
];

const activeAzureEmbeddingModels = [
	"text-embedding-3-large",
	"text-embedding-3-small",
	"text-embedding-ada-002",
];

test("catalog maps active OpenAI text/chat models", () => {
	for (const model of activeOpenAITextModels) {
		assert.ok(getCatalogEntry("openai", model), model);
	}
});

test("catalog maps active Google AI Studio text/chat models", () => {
	for (const model of activeGeminiTextModels) {
		assert.ok(getCatalogEntry("googleaistudio", model), model);
	}
});

test("latest Gemini Flash models expose documented thinking without deprecated sampling", () => {
	for (const model of ["gemini-3.6-flash", "gemini-3.5-flash-lite"]) {
		const operation = getCatalogEntry("googleaistudio", model)?.operations[
			"text.generate"
		];
		assert.deepEqual(operation?.reasoning, {
			kind: "gemini_level",
			levels: ["minimal", "low", "medium", "high"],
		});
		assert.equal(operation?.maxInputTokens, 1048576);
		assert.equal(operation?.maxOutputTokens, 65536);
		assert.equal(operation?.parameters?.temperature, undefined);
		assert.equal(operation?.parameters?.top_p, undefined);
	}
});

test("catalog maps active Google AI Studio embedding models", () => {
	for (const model of activeGeminiEmbeddingModels) {
		const entry = getCatalogEntry("googleaistudio", model);
		assert.ok(entry, model);
		assert.ok(entry.operations["embedding.create"], model);
	}
});

test("catalog maps active Azure OpenAI embedding models", () => {
	for (const model of activeAzureEmbeddingModels) {
		const entry = getCatalogEntry("azureopenai", model);
		assert.ok(entry, model);
		assert.ok(entry.operations["embedding.create"], model);
	}
});

test("Azure OpenAI and Azure Foundry keep their own catalogs", () => {
	assert.ok(getCatalogEntry("azureopenai", "gpt-5.6-sol"));
	assert.ok(getCatalogEntry("azureopenai", "gpt-5.6-terra"));
	assert.ok(getCatalogEntry("azureopenai", "gpt-5.6-luna"));
	assert.ok(getCatalogEntry("azureopenai", "gpt-5.4"));
	assert.ok(getCatalogEntry("azureopenai", "gpt-4.1-nano"));
	assert.equal(
		getCatalogEntry("azurefoundry", "text-embedding-3-small"),
		undefined,
		"Azure OpenAI embeddings do not contaminate Foundry",
	);
	assert.equal(
		getCatalogEntry("azureopenai", "gpt-5.2-pro"),
		undefined,
		"Direct OpenAI does not contaminate Azure",
	);
	assert.equal(getCatalogEntry("azureopenai", "DeepSeek-V3.1"), undefined);

	const deepseek = getCatalogEntry("azurefoundry", "DeepSeek-V3.1")?.operations[
		"text.generate"
	];
	assert.equal(deepseek?.maxInputTokens, 131_072);
	assert.equal(deepseek?.capabilities?.tools, true);
	assert.equal(deepseek?.capabilities?.reasoning, true);
	const deepseekV4 = getCatalogEntry("azurefoundry", "DeepSeek-V4-Flash")
		?.operations["text.generate"];
	assert.deepEqual(deepseekV4?.reasoning, {
		kind: "openai_effort",
		levels: ["none", "high", "max"],
	});
	assert.deepEqual(
		getCatalogEntry("azurefoundry", "DeepSeek-V4-Pro")?.operations[
			"text.generate"
		]?.reasoning,
		deepseekV4?.reasoning,
		"DeepSeek V4 Flash and Pro must expose the same efforts",
	);
	assert.deepEqual(
		getCatalogEntry("azurefoundry", "Kimi-K2.6")?.operations["text.generate"]
			?.reasoning,
		{
			kind: "fixed",
			levels: ["high"],
		},
	);
	assert.ok(getCatalogEntry("azurefoundry", "grok-4.3"));
	assert.equal(
		getCatalogEntry("azurefoundry", "deepseek-v4-flash"),
		undefined,
		"Direct API does not contaminate Foundry",
	);
	assert.equal(
		getCatalogEntry("deepseek", "DeepSeek-V3.1"),
		undefined,
		"Foundry does not contaminate direct API",
	);
});

test("catalog does not match deprecated sibling variants by loose prefix", () => {
	assert.equal(getCatalogEntry("openai", "gpt-5.3-chat-mini"), undefined);
	assert.equal(getCatalogEntry("openai", "gpt-5.2-codex-legacy"), undefined);
	assert.equal(getCatalogEntry("openai", "gpt-4.1-ultra"), undefined);
	assert.equal(
		getCatalogEntry("googleaistudio", "gemini-3-pro-preview-legacy"),
		undefined,
	);
	assert.equal(
		getCatalogEntry("googleaistudio", "gemini-3.1-flash-lite-preview-legacy"),
		undefined,
	);
	assert.equal(
		getCatalogEntry("googleaistudio", "gemini-2.5-flash-preview-09-2025"),
		undefined,
	);
});

test("catalog still matches dated snapshots of active base models", () => {
	assert.ok(getCatalogEntry("openai", "gpt-5.5-2026-04-23"));
	assert.ok(getCatalogEntry("openai", "gpt-5.4-mini-2026-03-17"));
});

test("Anthropic catalog exposes Opus 5 reasoning, fast mode, and model-specific tiers", () => {
	const opus5Entry = getCatalogEntry("anthropic", "claude-opus-5");
	const opus5 = opus5Entry?.operations["text.generate"];
	assert.equal(opus5?.maxInputTokens, 1_000_000);
	assert.equal(opus5?.maxOutputTokens, 128_000);
	assert.deepEqual(opus5?.reasoning, {
		kind: "anthropic_adaptive",
		levels: ["none", "low", "medium", "high", "xhigh", "max"],
	});
	assert.equal(opus5?.parameters?.temperature, undefined);
	assert.equal(opus5?.parameters?.top_p, undefined);
	assert.equal(opus5?.parameters?.top_k, undefined);

	const opus5Fast = getCatalogEntry("anthropic", "claude-opus-5-fast");
	assert.deepEqual(
		opus5Fast?.operations["text.generate"]?.reasoning,
		opus5?.reasoning,
	);
	assert.equal(opus5Fast?.pricing?.inputCentsPerMTokens, 1_000);
	assert.equal(opus5Fast?.pricing?.outputCentsPerMTokens, 5_000);
	assert.equal(
		getCatalogEntry("anthropic", "claude-opus-4-7-fast")?.deprecated,
		true,
	);

	const opus48 = getCatalogEntry("anthropic", "claude-opus-4-8")?.operations[
		"text.generate"
	]?.reasoning;
	assert.deepEqual(opus48?.levels, [
		"none",
		"low",
		"medium",
		"high",
		"xhigh",
		"max",
	]);

	const opus46 = getCatalogEntry("anthropic", "claude-opus-4-6")?.operations[
		"text.generate"
	]?.reasoning;
	assert.deepEqual(opus46?.levels, ["none", "low", "medium", "high", "max"]);
	assert.equal(opus46?.levels.includes("xhigh"), false);
});

test("retired DeepSeek compatibility aliases are marked deprecated", () => {
	for (const model of ["deepseek-chat", "deepseek-reasoner"]) {
		assert.equal(getCatalogEntry("deepseek", model)?.deprecated, true, model);
	}
});

test("resolved model metadata exposes limits and reasoning defaults from catalog", () => {
	const gpt56 = resolveModelMetadata("openai", "gpt-5.6-sol");
	assert.equal(gpt56.maxInputTokens, 1_050_000);
	assert.equal(gpt56.maxOutputTokens, 128_000);
	assert.deepEqual(gpt56.reasoning?.levels, [
		"none",
		"low",
		"medium",
		"high",
		"xhigh",
		"max",
	]);
	assert.equal(gpt56.reasoning?.upstreamEffortMap, undefined);
	assert.equal(gpt56.pricing?.cacheWriteCentsPerMTokens, 625);
	assert.equal(gpt56.pricing?.tiers?.[0]?.cacheWriteCentsPerMTokens, 1_250);

	const openai = resolveModelMetadata("openai", "gpt-5.4");
	assert.equal(openai.maxInputTokens, 1_050_000);
	assert.equal(openai.maxOutputTokens, 128_000);
	assert.equal(openai.reasoning?.kind, "openai_effort");
	assert.deepEqual(openai.reasoning?.levels, [
		"none",
		"low",
		"medium",
		"high",
		"xhigh",
	]);
	// "none" ∈ levels is the new shape for "can disable reasoning".
	assert.equal(openai.reasoning?.levels.includes("none"), true);
	assert.equal(openai.capabilities.structuredOutputs, true);

	const gemini = resolveModelMetadata(
		"googleaistudio",
		"gemini-3.1-pro-preview",
	);
	assert.equal(gemini.maxInputTokens, 1_048_576);
	assert.equal(gemini.maxOutputTokens, 65_536);
	assert.equal(gemini.reasoning?.kind, "gemini_level");
	// gemini-3.1-pro-preview is a mandatory reasoner: no off switch ("none" ∉ levels).
	assert.equal(gemini.reasoning?.levels.includes("none"), false);
	assert.equal(gemini.capabilities.structuredOutputs, true);

	const geminiEmbedding = resolveModelMetadata(
		"googleaistudio",
		"gemini-embedding-2",
	);
	assert.deepEqual(geminiEmbedding.supportedCallTypes, ["embeddings"]);
	assert.equal(geminiEmbedding.embedding?.maxInputTokens, 8192);
	assert.equal(geminiEmbedding.embedding?.supportsDimensions, true);
	assert.deepEqual(geminiEmbedding.embedding?.encodingFormats, ["float"]);
	assert.equal(geminiEmbedding.pricing?.inputCentsPerMTokens, 20);

	const azureEmbedding = resolveModelMetadata(
		"azureopenai",
		"text-embedding-3-large",
	);
	assert.deepEqual(azureEmbedding.supportedCallTypes, ["embeddings"]);
	assert.equal(azureEmbedding.embedding?.dimensions, 3072);
	assert.equal(azureEmbedding.embedding?.supportsDimensions, true);
	assert.equal(azureEmbedding.pricing?.inputCentsPerMTokens, 13);

	const gpt41 = resolveModelMetadata("openai", "gpt-4.1");
	assert.equal(gpt41.capabilities.reasoning, false);
	assert.equal(gpt41.reasoning, undefined);
});

test("unknown models default to no structured outputs; declared through text.generate", () => {
	assert.equal(
		resolveModelMetadata("openaicompatible", "some-local-model").capabilities
			.structuredOutputs,
		false,
	);
	assert.equal(
		resolveModelMetadata("openaicompatible", "some-local-model", {
			operations: {
				"text.generate": { capabilities: { structuredOutputs: true } },
			},
		}).capabilities.structuredOutputs,
		true,
	);
});
