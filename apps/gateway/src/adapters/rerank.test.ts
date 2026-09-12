import { makeOpenRouterRerankHandler } from "./openrouter/rerank.ts";
import type { CanonicalRerankRequest } from "#core/rerank.ts";
import { makeVercelRerankHandler } from "./vercel/rerank.ts";
import type { AdapterContext } from "./types.ts";
import { GatewayError } from "#core/errors.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

function context(transport: AdapterContext["transport"]): AdapterContext {
	return {
		upstreamModel: "cohere/rerank-v3.5",
		credentials: {
			apiKey: "secret-key",
			baseUrl: "https://gateway.example/v1/",
			headers: { "x-client": "test" },
		},
		meta: {
			capabilities: {
				tools: false,
				vision: false,
				reasoning: false,
				structuredOutputs: false,
			},
			rerank: { documentModalities: ["text"] },
		},
		transport,
		requestId: "req-rerank",
	};
}

const request: CanonicalRerankRequest = {
	model: "public-reranker",
	query: "capital of France",
	documents: [
		{ type: "text", text: "Paris" },
		{ type: "text", text: "Berlin" },
	],
	topN: 1,
	provider: { only: ["cohere"], allow_fallbacks: false },
};

test("OpenRouter rerank sends its native request and preserves provider routing", () => {
	const built = makeOpenRouterRerankHandler().buildRequest(
		request,
		context("openrouter_rerank"),
	);
	assert.equal(built.url, "https://gateway.example/v1/rerank");
	assert.equal(built.headers.authorization, "Bearer secret-key");
	assert.equal(built.headers["x-client"], "test");
	assert.deepEqual(JSON.parse(built.body!), {
		model: "cohere/rerank-v3.5",
		query: "capital of France",
		documents: ["Paris", "Berlin"],
		top_n: 1,
		provider: { only: ["cohere"], allow_fallbacks: false },
	});
});

test("Vercel rerank sends the Cohere-compatible request without inventing provider routing", () => {
	const built = makeVercelRerankHandler().buildRequest(
		request,
		context("cohere_rerank"),
	);
	assert.equal(built.url, "https://gateway.example/v1/rerank");
	assert.deepEqual(JSON.parse(built.body!), {
		model: "cohere/rerank-v3.5",
		query: "capital of France",
		documents: ["Paris", "Berlin"],
		top_n: 1,
		return_documents: false,
	});
});

test("OpenRouter rerank parses ranking, ids, provider, tokens, search units, and provider cost", () => {
	const ctx = context("openrouter_rerank");
	const parsed = makeOpenRouterRerankHandler().parseResponse(
		{
			id: "gen-rerank-1",
			provider: "Cohere",
			results: [{ index: 1, relevance_score: 0.98 }],
			usage: { total_tokens: 150, search_units: 1, cost: 0.0025 },
		},
		ctx,
	);
	assert.deepEqual(parsed, {
		id: "gen-rerank-1",
		provider: "Cohere",
		results: [{ index: 1, relevanceScore: 0.98 }],
		usage: {
			promptTokens: 150,
			completionTokens: 0,
			totalTokens: 150,
			searchUnits: 1,
			providerCostCents: 0.25,
		},
	});
	assert.equal(ctx.diagnostics?.providerRequestId, "gen-rerank-1");
});

test("Vercel rerank parses Cohere billed units and omits provider", () => {
	const parsed = makeVercelRerankHandler().parseResponse(
		{
			id: "rerank-1",
			results: [{ index: 0, relevance_score: 0.8 }],
			meta: {
				billed_units: { search_units: 2 },
				tokens: { input_tokens: 40 },
			},
		},
		context("cohere_rerank"),
	);
	assert.deepEqual(parsed, {
		id: "rerank-1",
		results: [{ index: 0, relevanceScore: 0.8 }],
		usage: {
			promptTokens: 40,
			completionTokens: 0,
			totalTokens: 40,
			searchUnits: 2,
		},
	});
});

test("rerank adapters map nested and Cohere errors with Retry-After without leaking secrets", () => {
	for (const [handler, transport, body] of [
		[
			makeOpenRouterRerankHandler(),
			"openrouter_rerank",
			{ error: { message: "provider rejected secret-key" } },
		],
		[
			makeVercelRerankHandler(),
			"cohere_rerank",
			{ message: "cohere rejected secret-key" },
		],
	] as const) {
		const error = handler.mapError(
			{ status: 429, body, headers: { "retry-after": "2" } },
			context(transport),
		);
		assert.ok(GatewayError.is(error));
		assert.equal(error.retryAfterMs, 2_000);
		assert.doesNotMatch(error.publicMessage, /secret-key/);
	}
});
