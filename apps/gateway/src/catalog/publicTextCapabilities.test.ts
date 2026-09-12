import { publicTextCapabilities } from "./publicTextCapabilities.ts";
import { resolveModelMetadata } from "./index.ts";
import type { CatalogEntry } from "./types.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

function resolve(entry: CatalogEntry) {
	return resolveModelMetadata("custom", "private-upstream", entry);
}

test("public text metadata uses effective custom profiles without upstream translation fields", () => {
	const meta = resolve({
		operations: {
			"text.generate": {
				capabilities: { reasoning: true, vision: false },
				contracts: ["responses", "messages"],
				modalities: { input: ["text", "pdf"] },
				maxOutputTokens: 512,
				parameters: {
					temperature: {
						min: 0.2,
						max: 0.8,
						upstreamField: "private",
						notes: "private",
					},
				},
				reasoning: {
					kind: "openai_effort",
					levels: ["high", "none"],
					upstreamEffortMap: { high: "private" },
				},
			},
		},
	});
	const result = publicTextCapabilities([meta]);
	assert.ok(result);
	assert.deepEqual(result.contracts, ["responses", "messages"]);
	assert.deepEqual(result.input_modalities, ["pdf", "text"]);
	assert.deepEqual(result.reasoning_efforts, ["none", "high"]);
	assert.equal(result.max_output_tokens, 512);
	assert.deepEqual(result.parameter_constraints.temperature, {
		min: 0.2,
		max: 0.8,
	});
	assert.equal(JSON.stringify(result).includes("private"), false);
});

test("normal routing intersects mixed pool constraints, contracts, reasoning, and modalities", () => {
	const first = resolve({
		operations: {
			"text.generate": {
				capabilities: { reasoning: true },
				maxOutputTokens: 8192,
				modalities: { input: ["text", "image", "pdf"] },
				parameters: {
					temperature: { min: 0, max: 2 },
					top_p: { min: 0.8, max: 1 },
					seed: { values: [1, 2] },
				},
				reasoning: { kind: "openai_effort", levels: ["none", "low", "high"] },
			},
		},
	});
	const second = resolve({
		operations: {
			"text.generate": {
				capabilities: { reasoning: true, vision: false },
				contracts: ["chat.completions", "responses"],
				maxOutputTokens: 1024,
				parameters: {
					temperature: { min: 0.2, max: 1 },
					top_p: { max: 0.5 },
					seed: { values: [2, 3] },
					stop: false,
				},
				reasoning: {
					kind: "anthropic_budget",
					levels: ["low", "medium", "high"],
				},
			},
		},
	});
	const result = publicTextCapabilities([first, second]);
	assert.ok(result);
	assert.deepEqual(result.contracts, ["chat.completions", "responses"]);
	assert.deepEqual(result.input_modalities, ["text"]);
	assert.deepEqual(result.reasoning_efforts, ["low", "high"]);
	assert.equal(result.max_output_tokens, 1024);
	assert.deepEqual(result.parameter_constraints.temperature, {
		min: 0.2,
		max: 1,
	});
	assert.deepEqual(result.parameter_constraints.seed, { values: [2] });
	assert.equal(result.supported_parameters.includes("top_p"), false);
	assert.equal(result.supported_parameters.includes("stop"), false);
	assert.equal(result.parameter_constraints.top_p, undefined);
});

test("effective reasoning disabled suppresses stale reasoning spec and non-text operations are excluded", () => {
	const text = resolve({
		operations: {
			"text.generate": {
				capabilities: { reasoning: false, vision: false },
				reasoning: { kind: "fixed", levels: ["high"] },
			},
		},
	});
	assert.deepEqual(publicTextCapabilities([text])?.reasoning_efforts, []);
	assert.deepEqual(publicTextCapabilities([text])?.contracts, [
		"chat.completions",
		"responses",
		"messages",
	]);
	assert.equal(publicTextCapabilities([]), undefined);
	const image = resolve({ operations: { "image.generate": {} } });
	assert.equal(publicTextCapabilities([image]), undefined);
	assert.deepEqual(
		publicTextCapabilities([text, image]),
		publicTextCapabilities([text]),
	);
});

test("built-in catalog remains the effective source over an inline entry", () => {
	const meta = resolveModelMetadata("openai", "gpt-5.5", {
		operations: {
			"text.generate": {
				maxOutputTokens: 1,
				capabilities: { reasoning: false },
			},
		},
	});
	const result = publicTextCapabilities([meta]);
	assert.ok(result);
	assert.notEqual(result.max_output_tokens, 1);
	assert.deepEqual(result.reasoning_efforts, meta.reasoning?.levels);
});

test("disjoint enums and non-reasoning members cannot advertise optional pool controls", () => {
	const first = resolve({
		operations: {
			"text.generate": {
				capabilities: { reasoning: true },
				parameters: { temperature: { values: [0.2, 0.5] } },
				reasoning: { kind: "fixed", levels: ["high"] },
			},
		},
	});
	const second = resolve({
		operations: {
			"text.generate": {
				capabilities: { reasoning: false },
				parameters: { temperature: { values: [1] } },
			},
		},
	});
	const result = publicTextCapabilities([first, second]);
	assert.ok(result);
	assert.equal(result.supported_parameters.includes("temperature"), false);
	assert.equal(result.parameter_constraints.temperature, undefined);
	assert.deepEqual(result.reasoning_efforts, []);
});
