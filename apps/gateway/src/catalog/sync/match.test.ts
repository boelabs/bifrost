import type { SourceFetchResult, SourceModel } from "./types.ts";
import { matchCandidates } from "./match.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

function fetchResult(
	source: SourceFetchResult["source"],
	models: SourceModel[],
): SourceFetchResult {
	return {
		source,
		models,
		attempted: models.length,
		failed: [],
		complete: true,
	};
}

function model(
	source: SourceModel["source"],
	id: string,
	endpoints: SourceModel["endpoints"] = [],
): SourceModel {
	return { source, id, inputModalities: [], outputModalities: [], endpoints };
}

test("a model reported by both existence sources is confirmed", () => {
	const results = [
		fetchResult("vercel-ai-gateway", [
			model("vercel-ai-gateway", "anthropic/claude-sonnet-5"),
		]),
		fetchResult("openrouter", [
			model("openrouter", "anthropic/claude-sonnet-5"),
		]),
	];
	const matched = matchCandidates(results);
	const candidate = matched.find((c) => c.adapterKey === "anthropic");
	assert.ok(candidate);
	assert.equal(candidate.upstreamModel, "claude-sonnet-5");
	assert.equal(candidate.confirmed, true);
	assert.ok(candidate.bySource["vercel-ai-gateway"]);
	assert.ok(candidate.bySource.openrouter);
});

test("a model reported by only one existence source is not confirmed", () => {
	const results = [
		fetchResult("vercel-ai-gateway", [
			model("vercel-ai-gateway", "anthropic/claude-sonnet-5"),
		]),
		fetchResult("openrouter", []),
	];
	const matched = matchCandidates(results);
	assert.equal(matched.length, 1);
	assert.equal(matched[0]!.confirmed, false);
});

test("an ambiguous id prefix is disambiguated by the endpoint's provider tag", () => {
	const results = [
		fetchResult("vercel-ai-gateway", [
			model("vercel-ai-gateway", "openai/gpt-5.5", [
				{ providerTag: "azure", active: true },
			]),
		]),
	];
	const matched = matchCandidates(results);
	// Only azureopenai matches (endpoint confirms it); the plain "openai" candidate has no matching
	// endpoint and requiresEndpointMatch is unset for it too, so it still gets created but with the
	// fallback (first) endpoint - both candidates exist, but only one is the *correct* provider.
	const azure = matched.find((c) => c.adapterKey === "azureopenai");
	assert.ok(azure, "azureopenai candidate should exist");
	assert.equal(
		azure.bySource["vercel-ai-gateway"]?.endpoint?.providerTag,
		"azure",
	);
});

test("azureopenai is dropped when no endpoint confirms it (requiresEndpointMatch)", () => {
	const results = [
		fetchResult("vercel-ai-gateway", [
			model("vercel-ai-gateway", "openai/gpt-5.5", [
				{ providerTag: "openai", active: true },
			]),
		]),
	];
	const matched = matchCandidates(results);
	assert.equal(
		matched.some((c) => c.adapterKey === "azureopenai"),
		false,
	);
	assert.ok(matched.some((c) => c.adapterKey === "openai"));
});

test("an unrecognized model id produces no candidates", () => {
	const results = [
		fetchResult("vercel-ai-gateway", [
			model("vercel-ai-gateway", "openrouter/fusion"),
		]),
	];
	assert.deepEqual(matchCandidates(results), []);
});
