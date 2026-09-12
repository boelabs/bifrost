import { rerankResponseSummary, rerankRequestSummary } from "./logging.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

test("rerank logging keeps sizes and option names without query or documents", () => {
	const summary = rerankRequestSummary({
		model: "public-reranker",
		query: "secret query",
		documents: [
			{ type: "text", text: "secret first document" },
			{ type: "text", text: "secret second document" },
		],
		topN: 1,
		provider: { only: ["secret-provider"], zdr: true },
	});
	assert.deepEqual(summary, {
		model: "public-reranker",
		document_count: 2,
		document_bytes: 43,
		query_bytes: 12,
		top_n: 1,
		provider_options: ["only", "zdr"],
	});
	assert.doesNotMatch(
		JSON.stringify(summary),
		/secret query|secret first|secret-provider/,
	);
});

test("rerank response logging stores only result indexes, usage, and cost", () => {
	assert.deepEqual(
		rerankResponseSummary(
			{
				results: [
					{ index: 2, relevanceScore: 0.9 },
					{ index: 0, relevanceScore: 0.1 },
				],
				usage: {
					promptTokens: 0,
					completionTokens: 0,
					totalTokens: 0,
					searchUnits: 1,
				},
			},
			{
				inputCents: 0,
				cacheReadCents: 0,
				cacheWriteCents: 0,
				outputCents: 0,
				searchUnitCents: 0.1,
				providerReportedCents: null,
				totalCents: 0.1,
			},
		),
		{
			result_count: 2,
			indexes: [2, 0],
			usage: { total_tokens: 0, search_units: 1 },
			cost_cents: 0.1,
		},
	);
});
