import assert from "node:assert/strict";
import { test } from "node:test";

import {
	type OpenRouterEndpoint,
	type OpenRouterModel,
	normalizeEndpoint,
	normalizeModel,
} from "./openrouter.ts";

const sampleModel: OpenRouterModel = {
	id: "anthropic/claude-sonnet-5",
	name: "Anthropic: Claude Sonnet 5",
	architecture: {
		input_modalities: ["text", "image"],
		output_modalities: ["text"],
	},
	pricing: { prompt: "0.000002", completion: "0.00001" },
	top_provider: { context_length: 1_000_000, max_completion_tokens: 128_000 },
	supported_parameters: ["tools", "reasoning", "response_format"],
};

const sampleEndpoint: OpenRouterEndpoint = {
	model_id: "anthropic/claude-sonnet-5",
	provider_name: "Anthropic",
	tag: "anthropic",
	context_length: 1_000_000,
	max_completion_tokens: 128_000,
	pricing: { prompt: "0.000002", completion: "0.00001" },
	supported_parameters: ["tools", "reasoning", "response_format"],
	status: 0,
};

test("normalizeModel maps OpenRouter's model-level fields into the shared shape", () => {
	const model = normalizeModel(sampleModel, [sampleEndpoint]);
	assert.equal(model.source, "openrouter");
	assert.equal(model.id, "anthropic/claude-sonnet-5");
	assert.equal(model.contextWindow, 1_000_000);
	assert.equal(model.maxTokens, 128_000);
	assert.deepEqual(model.pricing, {
		inputCentsPerMTokens: 200,
		outputCentsPerMTokens: 1000,
	});
	assert.equal(model.endpoints.length, 1);
});

test("normalizeEndpoint prefers `tag` over `provider_name` for the provider tag", () => {
	const endpoint = normalizeEndpoint(sampleEndpoint);
	assert.equal(endpoint.providerTag, "anthropic");
	assert.equal(endpoint.active, true);
});

test("normalizeEndpoint falls back to provider_name when tag is absent", () => {
	const { tag, ...withoutTag } = sampleEndpoint;
	void tag;
	assert.equal(normalizeEndpoint(withoutTag).providerTag, "Anthropic");
});

test("normalizeModel handles a model with no endpoints", () => {
	const model = normalizeModel(sampleModel, []);
	assert.deepEqual(model.endpoints, []);
});
