import { assertEmbeddingsRequestSupported } from "./embeddingsRequestValidation.ts";
import type { ResolvedModelMetadata } from "#catalog/types.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

const meta: ResolvedModelMetadata = {
	capabilities: {
		tools: false,
		vision: false,
		reasoning: false,
		structuredOutputs: false,
	},
	operations: {
		"embedding.create": {
			dimensions: 1536,
			supportsDimensions: true,
			minDimensions: 1,
			maxDimensions: 1536,
			encodingFormats: ["float", "base64"],
			maxInputs: 2,
			supportsTokenInput: true,
		},
	},
};

test("embeddings validation accepts supported dimensions, base64 and batch", () => {
	assert.doesNotThrow(() =>
		assertEmbeddingsRequestSupported(
			{
				model: "emb",
				input: ["a", "b"],
				encodingFormat: "base64",
				dimensions: 256,
			},
			meta,
		),
	);
});

test("embeddings validation rejects unsupported dimensions and oversized batch", () => {
	assert.throws(
		() =>
			assertEmbeddingsRequestSupported(
				{
					model: "emb",
					input: "a",
					encodingFormat: "float",
					dimensions: 2048,
				},
				meta,
			),
		/1 and 1536/,
	);
	assert.throws(
		() =>
			assertEmbeddingsRequestSupported(
				{
					model: "emb",
					input: ["a", "b", "c"],
					encodingFormat: "float",
				},
				meta,
			),
		/at most 2 inputs/,
	);
});

test("embeddings validation rejects dimensions on ada-style profiles", () => {
	assert.throws(
		() =>
			assertEmbeddingsRequestSupported(
				{
					model: "emb",
					input: "a",
					encodingFormat: "float",
					dimensions: 256,
				},
				{
					...meta,
					operations: {
						"embedding.create": {
							dimensions: 1536,
							supportsDimensions: false,
							encodingFormats: ["float"],
						},
					},
				},
			),
		/does not support dimensions/,
	);
});
