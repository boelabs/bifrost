import assert from "node:assert/strict";
import { test } from "node:test";

import {
	type VercelEndpoint,
	normalizeEndpoint,
	type VercelModel,
	normalizeModel,
} from "./vercel.ts";

// Fixture taken verbatim from Vercel AI Gateway's REST API docs sample response.
const sampleModel: VercelModel = {
	id: "google/gemini-3.1-pro-preview",
	name: "Gemini 3.1 Pro Preview",
	context_window: 1_000_000,
	max_tokens: 64_000,
	type: "language",
	tags: ["file-input", "tool-use", "reasoning", "vision"],
	modalities: {
		input: ["text", "image", "pdf"],
		output: ["text"],
	},
	supported_parameters: ["max_tokens", "tools", "reasoning"],
	reasoning_options: [
		{ type: "toggle" },
		{
			type: "effort",
			values: ["none", "low", "medium", "high", "xhigh", "max"],
		},
	],
	pricing: {
		input: "0.000002",
		output: "0.000012",
		input_cache_read: "0.0000002",
		input_cache_write: "0.000002",
	},
};

const sampleEndpoint: VercelEndpoint = {
	name: "google | google/gemini-3.1-pro-preview",
	context_length: 1_000_000,
	pricing: {
		prompt: "0.000002",
		completion: "0.000012",
		input_cache_read: "0.0000002",
		input_cache_write: "0.000002",
	},
	provider_name: "google",
	max_completion_tokens: 64_000,
	supported_parameters: ["max_tokens", "temperature", "tools", "reasoning"],
	status: 0,
};

test("normalizeModel: model-level pricing uses input/output field names, converted to cents/M", () => {
	const model = normalizeModel(sampleModel, {
		architecture: {
			input_modalities: ["text", "image"],
			output_modalities: ["text"],
		},
		endpoints: [sampleEndpoint],
	});
	assert.equal(model.id, "google/gemini-3.1-pro-preview");
	assert.deepEqual(model.inputModalities, ["text", "image", "pdf"]);
	assert.deepEqual(model.outputModalities, ["text"]);
	assert.deepEqual(model.supportedParameters, [
		"max_tokens",
		"tools",
		"reasoning",
	]);
	assert.equal(model.contextWindow, 1_000_000);
	assert.equal(model.maxTokens, 64_000);
	assert.deepEqual(model.reasoningOptions, [
		{ type: "toggle" },
		{
			type: "effort",
			values: ["none", "low", "medium", "high", "xhigh", "max"],
		},
	]);
	assert.deepEqual(model.pricing, {
		inputCentsPerMTokens: 200,
		outputCentsPerMTokens: 1200,
		cacheReadCentsPerMTokens: 20,
		cacheWriteCentsPerMTokens: 200,
	});
	assert.equal(model.endpoints.length, 1);
});

test("normalizeEndpoint: endpoint-level pricing uses prompt/completion field names", () => {
	const endpoint = normalizeEndpoint(sampleEndpoint);
	assert.equal(endpoint.providerTag, "google");
	assert.equal(endpoint.active, true);
	assert.equal(endpoint.contextLength, 1_000_000);
	assert.deepEqual(endpoint.supportedParameters, [
		"max_tokens",
		"temperature",
		"tools",
		"reasoning",
	]);
});

test("normalizeEndpoint: a non-zero status is inactive", () => {
	assert.equal(
		normalizeEndpoint({ ...sampleEndpoint, status: 1 }).active,
		false,
	);
});

test("normalizeModel: missing architecture/endpoints degrades gracefully to empty arrays", () => {
	const {
		modalities: _modalities,
		supported_parameters: _supportedParameters,
		...legacyModel
	} = sampleModel;
	const model = normalizeModel(legacyModel, undefined);
	assert.deepEqual(model.inputModalities, []);
	assert.deepEqual(model.outputModalities, []);
	assert.deepEqual(model.endpoints, []);
});
