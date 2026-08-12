import type { CatalogEntry } from "#catalog/types.ts";
import type { MatchedCandidate } from "./match.ts";
import type { EnrichmentModel } from "./types.ts";
import { mergeCatalogEntry } from "./merge.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

function candidate(
	bySource: MatchedCandidate["bySource"],
	confirmed = true,
): MatchedCandidate {
	return {
		adapterKey: "openai",
		upstreamModel: "gpt-5.5",
		bySource,
		confirmed,
	};
}

function stub(): CatalogEntry {
	return { operations: {} };
}

test("with only one source reporting a numeric field, that value is used", () => {
	const c = candidate({
		"vercel-ai-gateway": {
			model: {
				source: "vercel-ai-gateway",
				id: "openai/gpt-5.5",
				inputModalities: [],
				outputModalities: ["text"],
				endpoints: [],
				pricing: { inputCentsPerMTokens: 200 },
			},
			endpoint: undefined,
		},
	});
	const result = mergeCatalogEntry(stub(), c, undefined);
	assert.equal(result.entry.pricing?.inputCentsPerMTokens, 200);
	assert.equal(result.conflicts.length, 0);
});

test("two sources agreeing within tolerance apply the value, preferring Vercel's exact figure", () => {
	const c = candidate({
		"vercel-ai-gateway": {
			model: {
				source: "vercel-ai-gateway",
				id: "openai/gpt-5.5",
				inputModalities: [],
				outputModalities: ["text"],
				endpoints: [],
				pricing: { inputCentsPerMTokens: 200 },
			},
			endpoint: undefined,
		},
		openrouter: {
			model: {
				source: "openrouter",
				id: "openai/gpt-5.5",
				inputModalities: [],
				outputModalities: ["text"],
				endpoints: [],
				pricing: { inputCentsPerMTokens: 201 },
			},
			endpoint: undefined,
		},
	});
	const result = mergeCatalogEntry(stub(), c, undefined);
	assert.equal(result.entry.pricing?.inputCentsPerMTokens, 200);
});

test("models.dev breaks a tie when it agrees with one of the two existence sources", () => {
	const c = candidate({
		"vercel-ai-gateway": {
			model: {
				source: "vercel-ai-gateway",
				id: "openai/gpt-5.5",
				inputModalities: [],
				outputModalities: ["text"],
				endpoints: [],
				pricing: { inputCentsPerMTokens: 200 },
			},
			endpoint: undefined,
		},
		openrouter: {
			model: {
				source: "openrouter",
				id: "openai/gpt-5.5",
				inputModalities: [],
				outputModalities: ["text"],
				endpoints: [],
				pricing: { inputCentsPerMTokens: 350 },
			},
			endpoint: undefined,
		},
	});
	const modelsDevMatch: EnrichmentModel = {
		providerIdRaw: "openai",
		modelIdRaw: "gpt-5.5",
		pricing: { inputCentsPerMTokens: 201 },
	};
	const result = mergeCatalogEntry(stub(), c, modelsDevMatch);
	assert.equal(result.entry.pricing?.inputCentsPerMTokens, 200); // vercel wins, agreeing with models.dev
});

test("a genuine 3-way disagreement is reported as a conflict and nothing is applied", () => {
	const c = candidate({
		"vercel-ai-gateway": {
			model: {
				source: "vercel-ai-gateway",
				id: "openai/gpt-5.5",
				inputModalities: [],
				outputModalities: ["text"],
				endpoints: [],
				pricing: { inputCentsPerMTokens: 100 },
			},
			endpoint: undefined,
		},
		openrouter: {
			model: {
				source: "openrouter",
				id: "openai/gpt-5.5",
				inputModalities: [],
				outputModalities: ["text"],
				endpoints: [],
				pricing: { inputCentsPerMTokens: 200 },
			},
			endpoint: undefined,
		},
	});
	const modelsDevMatch: EnrichmentModel = {
		providerIdRaw: "openai",
		modelIdRaw: "gpt-5.5",
		pricing: { inputCentsPerMTokens: 300 },
	};
	const existing: CatalogEntry = {
		operations: { "text.generate": {} },
		pricing: { inputCentsPerMTokens: 150 },
	};
	const result = mergeCatalogEntry(existing, c, modelsDevMatch);
	assert.equal(result.entry.pricing?.inputCentsPerMTokens, 150); // untouched
	assert.equal(result.conflicts.length, 1);
	assert.equal(result.conflicts[0]!.field, "pricing.inputCentsPerMTokens");
});

test("no source reporting a field leaves an existing value untouched (silence is not removal)", () => {
	const c = candidate({
		"vercel-ai-gateway": {
			model: {
				source: "vercel-ai-gateway",
				id: "openai/gpt-5.5",
				inputModalities: [],
				outputModalities: ["text"],
				endpoints: [],
				pricing: {},
			},
			endpoint: undefined,
		},
	});
	const existing: CatalogEntry = {
		operations: { "text.generate": {} },
		pricing: { inputCentsPerMTokens: 999 },
	};
	const result = mergeCatalogEntry(existing, c, undefined);
	assert.equal(result.entry.pricing?.inputCentsPerMTokens, 999);
});

test("supported parameters are unioned in, never removing an existing manually-set entry", () => {
	const c = candidate({
		"vercel-ai-gateway": {
			model: {
				source: "vercel-ai-gateway",
				id: "openai/gpt-5.5",
				inputModalities: [],
				outputModalities: ["text"],
				endpoints: [],
				supportedParameters: ["tools", "temperature"],
			},
			endpoint: undefined,
		},
	});
	const existing: CatalogEntry = {
		operations: {
			"text.generate": { parameters: { temperature: { mode: "unsupported" } } },
		},
	};
	const result = mergeCatalogEntry(existing, c, undefined);
	const params = result.entry.operations["text.generate"]?.parameters;
	assert.deepEqual(params?.temperature, { mode: "unsupported" }); // preserved, not downgraded
	assert.equal(params?.tools, true); // newly added
});

test("ensureOperations creates text.generate on a stub when output modalities allow text", () => {
	const c = candidate({
		"vercel-ai-gateway": {
			model: {
				source: "vercel-ai-gateway",
				id: "openai/gpt-5.5",
				inputModalities: ["text"],
				outputModalities: ["text"],
				endpoints: [],
			},
			endpoint: undefined,
		},
	});
	const result = mergeCatalogEntry(stub(), c, undefined);
	assert.ok(result.entry.operations["text.generate"]);
});

test("ensureOperations never adds text.generate to an entry that already declares a different operation", () => {
	// Regression test: a real bug shipped where this added a phantom text.generate to every
	// embedding/image/audio-transcription model whose matched source reported empty outputModalities
	// (common when a source's endpoint data is sparse), making pure embedding/image models look
	// chat-capable. An entry that already declares ANY operation has already been deliberately scoped and
	// must never get another one "topped up" just because modality data was missing.
	const c = candidate({
		"vercel-ai-gateway": {
			model: {
				source: "vercel-ai-gateway",
				id: "openai/text-embedding-3-large",
				inputModalities: [],
				outputModalities: [], // sparse source data - the exact trigger for the original bug
				endpoints: [],
			},
			endpoint: undefined,
		},
	});
	const existing: CatalogEntry = {
		operations: { "embedding.create": { dimensions: 3072 } },
	};
	const result = mergeCatalogEntry(existing, c, undefined);
	assert.equal(result.entry.operations["text.generate"], undefined);
	assert.ok(result.entry.operations["embedding.create"]);
});

test("never touches capabilities.reasoning or operations.text.generate.reasoning", () => {
	const c = candidate({
		"vercel-ai-gateway": {
			model: {
				source: "vercel-ai-gateway",
				id: "openai/gpt-5.5",
				inputModalities: [],
				outputModalities: ["text"],
				endpoints: [],
				supportedParameters: ["reasoning", "reasoning_effort"],
			},
			endpoint: undefined,
		},
		openrouter: {
			model: {
				source: "openrouter",
				id: "openai/gpt-5.5",
				inputModalities: [],
				outputModalities: ["text"],
				endpoints: [],
				supportedParameters: ["reasoning", "reasoning_effort"],
			},
			endpoint: undefined,
		},
	});
	const before = stub();
	const result = mergeCatalogEntry(before, c, undefined);
	assert.equal(
		result.entry.operations["text.generate"]?.capabilities?.reasoning,
		undefined,
	);
	assert.equal(result.entry.operations["text.generate"]?.reasoning, undefined);
	// "reasoning"/"reasoning_effort" still land in the parameter map (that's a separate, safe signal) -
	// only the capability flag and the ReasoningSpec are excluded.
	assert.equal(
		result.entry.operations["text.generate"]?.parameters?.reasoning,
		true,
	);
});
