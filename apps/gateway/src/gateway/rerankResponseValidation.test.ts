import { assertRerankResponseValid } from "./rerankResponseValidation.ts";
import type { CanonicalRerankResponse } from "#core/rerank.ts";
import type { CanonicalRerankRequest } from "#core/rerank.ts";
import { GatewayError } from "#core/errors.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

const request: CanonicalRerankRequest = {
	model: "m",
	query: "q",
	documents: [
		{ type: "text", text: "a" },
		{ type: "text", text: "b" },
		{ type: "text", text: "c" },
	],
	topN: 2,
};

function valid(): CanonicalRerankResponse {
	return {
		results: [
			{ index: 2, relevanceScore: 3.5 },
			{ index: 0, relevanceScore: -1 },
		],
		usage: {
			promptTokens: 4,
			completionTokens: 0,
			totalTokens: 4,
			searchUnits: 1,
		},
	};
}

function isProtocolError(error: unknown): boolean {
	return (
		GatewayError.is(error) &&
		error.code === "upstream_protocol_error" &&
		error.retryable &&
		error.deploymentHealth === "penalize"
	);
}

test("rerank response validation accepts finite descending scores outside [0,1]", () => {
	assert.doesNotThrow(() => assertRerankResponseValid(request, valid()));
});

test("rerank response validation rejects cardinality and invalid indexes", () => {
	const cases: CanonicalRerankResponse[] = [
		{ results: [{ index: 0, relevanceScore: 1 }] },
		{
			results: [
				{ index: 0, relevanceScore: 1 },
				{ index: 0, relevanceScore: 0 },
			],
		},
		{
			results: [
				{ index: 3, relevanceScore: 1 },
				{ index: 0, relevanceScore: 0 },
			],
		},
		{
			results: [
				{ index: 0.5, relevanceScore: 1 },
				{ index: 1, relevanceScore: 0 },
			],
		},
	];
	for (const response of cases)
		assert.throws(
			() => assertRerankResponseValid(request, response),
			isProtocolError,
		);
});

test("rerank response validation rejects non-finite or ascending scores", () => {
	for (const scores of [
		[Number.NaN, 0],
		[0, Number.POSITIVE_INFINITY],
		[0.1, 0.2],
	]) {
		const response = valid();
		response.results[0]!.relevanceScore = scores[0]!;
		response.results[1]!.relevanceScore = scores[1]!;
		assert.throws(
			() => assertRerankResponseValid(request, response),
			isProtocolError,
		);
	}
});

test("rerank response validation rejects negative, fractional, or inconsistent usage", () => {
	const usages = [
		{ promptTokens: -1, completionTokens: 0, totalTokens: -1 },
		{ promptTokens: 1.5, completionTokens: 0, totalTokens: 1.5 },
		{ promptTokens: 1, completionTokens: 1, totalTokens: 1 },
		{ promptTokens: 0, completionTokens: 0, totalTokens: 0, searchUnits: 0.5 },
		{
			promptTokens: 0,
			completionTokens: 0,
			totalTokens: 0,
			providerCostCents: Number.NaN,
		},
	];
	for (const usage of usages) {
		const response = valid();
		response.usage = usage;
		assert.throws(
			() => assertRerankResponseValid(request, response),
			isProtocolError,
		);
	}
});

test("top_n above the document count expects the natural document count", () => {
	assert.doesNotThrow(() =>
		assertRerankResponseValid(
			{ ...request, topN: 50 },
			{
				results: [
					{ index: 0, relevanceScore: 3 },
					{ index: 1, relevanceScore: 2 },
					{ index: 2, relevanceScore: 1 },
				],
			},
		),
	);
});
