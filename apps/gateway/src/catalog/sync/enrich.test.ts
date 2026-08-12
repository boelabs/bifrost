import type { CatalogEntry } from "#catalog/types.ts";
import type { MatchedCandidate } from "./match.ts";
import type { EnrichmentModel } from "./types.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

import {
	draftReasoningLevels,
	enrichCatalogEntry,
	findModelsDevMatch,
} from "./enrich.ts";

function candidate(bySource: MatchedCandidate["bySource"]): MatchedCandidate {
	return {
		adapterKey: "openai",
		upstreamModel: "gpt-5.5",
		bySource,
		confirmed: true,
	};
}

function existenceModel(
	contextWindow?: number,
	inputPrice?: number,
): MatchedCandidate["bySource"] {
	return {
		"vercel-ai-gateway": {
			model: {
				source: "vercel-ai-gateway",
				id: "openai/gpt-5.5",
				inputModalities: [],
				outputModalities: ["text"],
				endpoints: [],
				...(contextWindow !== undefined ? { contextWindow } : {}),
				...(inputPrice !== undefined
					? { pricing: { inputCentsPerMTokens: inputPrice } }
					: {}),
			},
			endpoint: undefined,
		},
	};
}

function baseEntry(): CatalogEntry {
	return { operations: { "text.generate": {} } };
}

test("findModelsDevMatch requires corroboration: agreeing context window", () => {
	const c = candidate(existenceModel(400_000));
	const models: EnrichmentModel[] = [
		{ providerIdRaw: "openai", modelIdRaw: "gpt-5.5", contextWindow: 400_000 },
	];
	const found = findModelsDevMatch(c, models);
	assert.equal(found?.corroborated, true);
});

test("findModelsDevMatch: a fuzzy name match with no numeric agreement is not corroborated", () => {
	const c = candidate(existenceModel(400_000, 125));
	const models: EnrichmentModel[] = [
		{
			providerIdRaw: "openai",
			modelIdRaw: "gpt-5.5",
			contextWindow: 999_999_999,
			pricing: { inputCentsPerMTokens: 999_999 },
		},
	];
	const found = findModelsDevMatch(c, models);
	assert.equal(found?.corroborated, false);
});

test("findModelsDevMatch returns undefined when the provider has no models.dev alias", () => {
	const c: MatchedCandidate = {
		adapterKey: "openaicompatible",
		upstreamModel: "x",
		bySource: {},
		confirmed: false,
	};
	assert.equal(findModelsDevMatch(c, []), undefined);
});

test("enrichCatalogEntry applies nothing from a match without reasoning data", () => {
	const c = candidate(existenceModel(400_000));
	const models: EnrichmentModel[] = [
		{ providerIdRaw: "openai", modelIdRaw: "gpt-5.5", contextWindow: 400_000 },
	];
	const modelsDevMatch = findModelsDevMatch(c, models)?.match;
	const result = enrichCatalogEntry(baseEntry(), c, modelsDevMatch, new Map());
	assert.deepEqual(result.changes, []);
	assert.deepEqual(result.entry, baseEntry());
});

test("draftReasoningLevels: effort values matching our vocabulary become levels, others are flagged", () => {
	const { levels, unrecognized } = draftReasoningLevels([
		{ type: "effort", values: ["low", "medium", "high", "xhigh", "max"] },
	]);
	assert.deepEqual([...levels].sort(), [
		"high",
		"low",
		"max",
		"medium",
		"xhigh",
	]);
	assert.deepEqual(unrecognized, []);
});

test("draftReasoningLevels: a toggle alongside an effort ladder adds the off switch", () => {
	const { levels } = draftReasoningLevels([
		{ type: "toggle" },
		{ type: "effort", values: ["low", "high"] },
	]);
	assert.ok(levels.includes("none"));
	assert.ok(levels.includes("low"));
	assert.ok(levels.includes("high"));
});

test("draftReasoningLevels: a bare toggle with no effort ladder drafts the documented on/off pattern", () => {
	const { levels } = draftReasoningLevels([{ type: "toggle" }]);
	assert.deepEqual([...levels].sort(), ["high", "none"]);
});

test("draftReasoningLevels: budget_tokens alone contributes no discrete levels", () => {
	const { levels } = draftReasoningLevels([
		{ type: "budget_tokens", min: 1024 },
	]);
	assert.deepEqual(levels, []);
});

test("enrichCatalogEntry drafts a reasoning spec and sets needsHumanReview together", () => {
	const c = candidate(existenceModel(1_000_000));
	const models: EnrichmentModel[] = [
		{
			providerIdRaw: "openai",
			modelIdRaw: "gpt-5.5",
			contextWindow: 1_000_000,
			reasoning: true,
			reasoningOptions: [{ type: "effort", values: ["low", "medium", "high"] }],
		},
	];
	const modelsDevMatch = findModelsDevMatch(c, models)?.match;
	const result = enrichCatalogEntry(baseEntry(), c, modelsDevMatch, new Map());
	assert.equal(
		result.entry.operations["text.generate"]?.capabilities?.reasoning,
		true,
	);
	assert.ok(result.entry.operations["text.generate"]?.reasoning);
	assert.deepEqual(result.entry.needsHumanReview, [
		"operations.text.generate.reasoning",
	]);
});

test("enrichCatalogEntry never drafts a spec whose only kind in use requires undraftable config", () => {
	// Regression test: an adapter whose catalog only ever uses "openai_body" (which jsonCatalog.ts's
	// loader requires a `bodyField` sub-object for, and this sync can never safely infer that) must not
	// get a half-written {kind: "openai_body", levels: [...]} spec - that's structurally invalid and
	// breaks catalog loading entirely, not just the needsHumanReview gate.
	const c = candidate(existenceModel(1_000_000));
	const models: EnrichmentModel[] = [
		{
			providerIdRaw: "openai",
			modelIdRaw: "gpt-5.5",
			contextWindow: 1_000_000,
			reasoning: true,
			reasoningOptions: [{ type: "effort", values: ["low", "medium", "high"] }],
		},
	];
	const modelsDevMatch = findModelsDevMatch(c, models)?.match;
	const kindsInUseByAdapter = new Map([["openai", ["openai_body"] as const]]);
	const result = enrichCatalogEntry(
		baseEntry(),
		c,
		modelsDevMatch,
		kindsInUseByAdapter,
	);
	assert.equal(result.entry.operations["text.generate"]?.reasoning, undefined);
	assert.equal(
		result.entry.operations["text.generate"]?.capabilities?.reasoning,
		undefined,
	);
	// Still flagged, so the gap doesn't silently disappear - just never with a broken spec attached.
	assert.deepEqual(result.entry.needsHumanReview, [
		"operations.text.generate.reasoning",
	]);
});

test("enrichCatalogEntry never re-drafts an already human-verified reasoning spec", () => {
	const c = candidate(existenceModel(1_000_000));
	const models: EnrichmentModel[] = [
		{
			providerIdRaw: "openai",
			modelIdRaw: "gpt-5.5",
			contextWindow: 1_000_000,
			reasoning: true,
			reasoningOptions: [
				{ type: "effort", values: ["low", "medium", "high", "xhigh"] },
			],
		},
	];
	const modelsDevMatch = findModelsDevMatch(c, models)?.match;
	const verified = baseEntry();
	verified.operations["text.generate"]!.capabilities = { reasoning: true };
	verified.operations["text.generate"]!.reasoning = {
		kind: "openai_effort",
		levels: ["low", "medium", "high"],
	};
	const result = enrichCatalogEntry(verified, c, modelsDevMatch, new Map());
	assert.deepEqual(
		result.entry.operations["text.generate"]?.reasoning?.levels,
		["low", "medium", "high"],
	);
	assert.equal(result.entry.needsHumanReview, undefined);
});

test("enrichCatalogEntry does nothing when there's no corroborated models.dev match", () => {
	const c = candidate(existenceModel(1_000_000));
	const result = enrichCatalogEntry(baseEntry(), c, undefined, new Map());
	assert.deepEqual(result.changes, []);
	assert.equal(result.entry.needsHumanReview, undefined);
});
