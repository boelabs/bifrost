import { parseEmbeddingsResponse } from "./embeddingsTransport.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

import {
	embeddingsRequestToCanonical,
	toOpenAIEmbeddingsResponse,
	embeddingsRequestSchema,
} from "./embeddings.ts";

test("embeddings request accepts string, batch and tokenized inputs", () => {
	for (const input of ["hello", ["hello", "world"], [1, 2, 3], [[1], [2, 3]]]) {
		const parsed = embeddingsRequestSchema.parse({
			model: "text-embedding-3-small",
			input,
		});
		const canonical = embeddingsRequestToCanonical(parsed);
		assert.equal(canonical.model, "text-embedding-3-small");
		assert.equal(canonical.encodingFormat, "float");
		assert.deepEqual(canonical.input, input);
	}
});

test("embeddings request forwards dimensions, base64, user and extra_body", () => {
	const parsed = embeddingsRequestSchema.parse({
		model: "m",
		input: "hello",
		encoding_format: "base64",
		dimensions: 256,
		user: "u",
		extra_body: { extra: true },
	});
	assert.deepEqual(embeddingsRequestToCanonical(parsed), {
		model: "m",
		input: "hello",
		encodingFormat: "base64",
		dimensions: 256,
		user: "u",
		extraBody: { extra: true },
	});
});

test("embeddings request rejects extra_body collisions", () => {
	const parsed = embeddingsRequestSchema.parse({
		model: "m",
		input: "hello",
		extra_body: { dimensions: 128 },
	});
	assert.throws(
		() => embeddingsRequestToCanonical(parsed),
		/extra_body.dimensions/,
	);
});

test("embeddings transport parses float and base64 responses", () => {
	const parsed = parseEmbeddingsResponse({
		object: "list",
		model: "text-embedding-3-small",
		data: [
			{ object: "embedding", embedding: [0.1, -0.2], index: 0 },
			{ object: "embedding", embedding: "AAAA", index: 1 },
		],
		usage: { prompt_tokens: 4, total_tokens: 4 },
	});
	assert.equal(parsed.model, "text-embedding-3-small");
	assert.deepEqual(parsed.data[0]?.embedding, [0.1, -0.2]);
	assert.equal(parsed.data[1]?.embedding, "AAAA");
	assert.deepEqual(parsed.usage, { promptTokens: 4, totalTokens: 4 });
	assert.deepEqual(toOpenAIEmbeddingsResponse(parsed), {
		object: "list",
		data: [
			{ object: "embedding", embedding: [0.1, -0.2], index: 0 },
			{ object: "embedding", embedding: "AAAA", index: 1 },
		],
		model: "text-embedding-3-small",
		usage: { prompt_tokens: 4, total_tokens: 4 },
	});
});
