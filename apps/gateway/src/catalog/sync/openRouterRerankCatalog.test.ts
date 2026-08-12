import { buildOpenRouterRerankCatalog } from "./openRouterRerankCatalog.ts";
import type { OpenRouterModel } from "./sources/openrouter.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

function rerankModel(
	id: string,
	overrides: Partial<OpenRouterModel> = {},
): OpenRouterModel {
	return {
		id,
		architecture: {
			input_modalities: ["text"],
			output_modalities: ["rerank"],
		},
		context_length: 4_096,
		pricing: { prompt: "0", completion: "0" },
		...overrides,
	};
}

test("OpenRouter rerank sync retains every rerank id and reviewed search pricing", () => {
	const generated = buildOpenRouterRerankCatalog([
		rerankModel("cohere/rerank-v3.5"),
		rerankModel("nvidia/reranker:free", {
			architecture: {
				input_modalities: ["text", "image"],
				output_modalities: ["rerank"],
			},
		}),
	]);
	assert.deepEqual(generated.document.models["cohere/rerank-v3.5"], {
		operations: {
			rerank: {
				documentModalities: ["text"],
				maxDocuments: 1_000,
				maxTokensPerDocument: 4_096,
				documentsPerSearchUnit: 100,
			},
		},
		pricing: { searchUnitCents: 0.1 },
	});
	assert.deepEqual(
		generated.document.models["nvidia/reranker:free"]?.operations.rerank
			?.documentModalities,
		["text"],
	);
	assert.deepEqual(generated.report.multimodalRerankWithheld, [
		"nvidia/reranker:free",
	]);
	assert.deepEqual(generated.report.ambiguousZeroPricing, [
		"cohere/rerank-v3.5",
	]);
});

test("OpenRouter rerank sync reports unknown paid pricing and skips non-rerank output", () => {
	const generated = buildOpenRouterRerankCatalog([
		rerankModel("voyageai/rerank-2.5"),
		{
			id: "example/chat",
			architecture: {
				input_modalities: ["text"],
				output_modalities: ["text"],
			},
		},
	]);
	assert.deepEqual(generated.report.paidModelsWithoutCost, [
		"voyageai/rerank-2.5",
	]);
	assert.deepEqual(generated.report.skippedModels, [
		{
			id: "example/chat",
			reason: 'Source model does not declare output modality "rerank"',
		},
	]);
});
