import { computeCost } from "#logging/cost.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

import {
	toOpenRouterRerankResponse,
	rerankRequestToCanonical,
	rerankRequestSchema,
} from "./rerank.ts";

test("rerank contract normalizes strings, objects, and mixed lists", () => {
	const request = rerankRequestSchema.parse({
		model: "cohere/rerank-v3.5",
		query: "capital of France",
		documents: ["Paris", { text: "Berlin" }],
		top_n: 10,
	});
	assert.deepEqual(rerankRequestToCanonical(request), {
		model: "cohere/rerank-v3.5",
		query: "capital of France",
		documents: [
			{ type: "text", text: "Paris" },
			{ type: "text", text: "Berlin" },
		],
		topN: 10,
	});
});

test("rerank contract accepts the complete strict OpenRouter provider preference object", () => {
	const provider = {
		allow_fallbacks: true,
		data_collection: "deny" as const,
		enforce_distillable_text: true,
		ignore: ["provider-a"],
		max_price: {
			audio: "1",
			completion: "2",
			image: "3",
			prompt: "4",
			request: "5",
		},
		only: ["provider-b"],
		order: ["provider-b", "provider-c"],
		preferred_max_latency: { p50: 100, p90: 300 },
		preferred_min_throughput: 20,
		quantizations: ["fp8"],
		require_parameters: true,
		sort: { by: "throughput", partition: "model" as const },
		zdr: true,
	};
	const parsed = rerankRequestSchema.parse({
		model: "m",
		query: "q",
		documents: ["d"],
		provider,
	});
	assert.deepEqual(parsed.provider, provider);
	assert.deepEqual(rerankRequestToCanonical(parsed).provider, provider);
	assert.equal(
		rerankRequestSchema.safeParse({
			model: "m",
			query: "q",
			documents: ["d"],
			provider: { ...provider, future_field: true },
		}).success,
		false,
	);
});

test("rerank contract rejects blank content, images, unknown fields, and invalid list sizes", () => {
	for (const request of [
		{ model: " ", query: "q", documents: ["d"] },
		{ model: "m", query: " \n", documents: ["d"] },
		{ model: "m", query: "q", documents: [] },
		{ model: "m", query: "q", documents: [""] },
		{ model: "m", query: "q", documents: [{ text: "d", extra: true }] },
		{ model: "m", query: "q", documents: [{ image: "https://x.test/i" }] },
		{ model: "m", query: "q", documents: ["d"], top_n: 0 },
		{ model: "m", query: "q", documents: ["d"], stream: false },
	]) {
		assert.equal(rerankRequestSchema.safeParse(request).success, false);
	}
	assert.equal(
		rerankRequestSchema.safeParse({
			model: "m",
			query: "q",
			documents: Array.from({ length: 1_001 }, () => "d"),
		}).success,
		false,
	);
});

test("rerank response reconstructs documents, preserves the public model, and accounts cost", () => {
	const request = rerankRequestToCanonical(
		rerankRequestSchema.parse({
			model: "public-reranker",
			query: "q",
			documents: ["first", { text: "second" }],
		}),
	);
	const usage = {
		promptTokens: 0,
		completionTokens: 0,
		totalTokens: 0,
		searchUnits: 1,
	};
	const cost = computeCost({ pricing: { searchUnitCents: 0.25 } }, usage);
	const response = toOpenRouterRerankResponse(
		request,
		{
			id: "gen-rerank-1",
			provider: "Cohere",
			results: [
				{ index: 1, relevanceScore: 0.9 },
				{ index: 0, relevanceScore: -0.5 },
			],
			usage,
		},
		cost,
	);
	assert.deepEqual(response, {
		id: "gen-rerank-1",
		model: "public-reranker",
		provider: "Cohere",
		results: [
			{ index: 1, relevance_score: 0.9, document: { text: "second" } },
			{ index: 0, relevance_score: -0.5, document: { text: "first" } },
		],
		usage: { total_tokens: 0, search_units: 1, cost: 0.0025 },
	});
});
