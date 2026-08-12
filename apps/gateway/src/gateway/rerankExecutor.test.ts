import { jsonResponse, withStubbedFetch } from "#test-support/fetch.ts";
import { openrouterAdapter } from "#adapters/openrouter/index.ts";
import type { CanonicalRerankRequest } from "#core/rerank.ts";
import type { AdapterContext } from "#adapters/types.ts";
import { GatewayError } from "#core/errors.ts";
import { executeRerank } from "./executor.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

const request: CanonicalRerankRequest = {
	model: "public-reranker",
	query: "query",
	documents: [
		{ type: "text", text: "first" },
		{ type: "text", text: "second" },
	],
};

function context(): AdapterContext {
	return {
		upstreamModel: "cohere/rerank-v3.5",
		credentials: { apiKey: "test", baseUrl: "https://upstream.example/v1" },
		meta: {
			capabilities: {
				tools: false,
				vision: false,
				reasoning: false,
				structuredOutputs: false,
			},
			rerank: { documentModalities: ["text"] },
		},
		transport: "openrouter_rerank",
		requestId: "req-rerank",
	};
}

test("rerank executor dispatches instrumented JSON and returns verified completed terminal", async () => {
	await withStubbedFetch(
		async (input, init) => {
			assert.equal(String(input), "https://upstream.example/v1/rerank");
			assert.equal(init?.method, "POST");
			return jsonResponse(
				{
					id: "gen-rerank-1",
					results: [
						{ index: 1, relevance_score: 0.9 },
						{ index: 0, relevance_score: 0.1 },
					],
					usage: { search_units: 1, total_tokens: 20 },
				},
				200,
				{ "x-request-id": "upstream-request-1" },
			);
		},
		async () => {
			const result = await executeRerank(openrouterAdapter, request, context());
			assert.equal(result.kind, "json");
			assert.deepEqual(result.terminal, {
				outcome: "completed",
				reason: "stop",
				usage: null,
			});
			assert.equal(result.response.results[0]?.index, 1);
			assert.equal(result.diagnostics.providerRequestId, "gen-rerank-1");
		},
	);
});

test("rerank executor classifies malformed rankings as retryable protocol errors", async () => {
	await withStubbedFetch(
		async () =>
			jsonResponse({
				results: [
					{ index: 0, relevance_score: 0.1 },
					{ index: 1, relevance_score: 0.9 },
				],
			}),
		async () => {
			await assert.rejects(
				() => executeRerank(openrouterAdapter, request, context()),
				(error: unknown) =>
					GatewayError.is(error) &&
					error.code === "upstream_protocol_error" &&
					error.retryable,
			);
		},
	);
});

test("rerank executor honors an exhausted first-output deadline before dispatch", async () => {
	let dispatched = false;
	await withStubbedFetch(
		async () => {
			dispatched = true;
			return jsonResponse({});
		},
		async () => {
			const ctx = context();
			ctx.attemptStartedAt = Date.now() - 100;
			ctx.executionPolicy = {
				firstOutputMs: 10,
				idleMs: null,
				reasoningOnlyMs: null,
				preCommitMs: 60_000,
				totalMs: 60_000,
				maxAttempts: 3,
			};
			await assert.rejects(
				() => executeRerank(openrouterAdapter, request, ctx),
				(error: unknown) =>
					GatewayError.is(error) &&
					error.code === "upstream_first_output_timeout",
			);
		},
	);
	assert.equal(dispatched, false);
});
