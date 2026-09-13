import { inputsFrom } from "./EmbeddingWorkspace";
import assert from "node:assert/strict";
import type { FetchLike } from "./api";
import { test } from "node:test";

import {
	cosineSimilarity,
	decodeEmbedding,
	embeddingsBody,
	runEmbeddings,
	vectorsFrom,
} from "./embeddings";

test("one text is sent as a string and a batch as an array", () => {
	assert.deepEqual(embeddingsBody("m", ["only"], {}), {
		model: "m",
		input: "only",
	});
	assert.deepEqual(embeddingsBody("m", ["one", "two"], {}), {
		model: "m",
		input: ["one", "two"],
	});
	assert.deepEqual(
		embeddingsBody("m", ["only"], {
			dimensions: 256,
			encodingFormat: "base64",
		}),
		{ model: "m", input: "only", dimensions: 256, encoding_format: "base64" },
	);
});

test("base64 vectors decode to the same numbers a float response would carry", () => {
	const vector = [1, -0.5, 0.25];
	const bytes = new Uint8Array(new Float32Array(vector).buffer);
	const base64 = btoa(String.fromCharCode(...bytes));
	assert.deepEqual(decodeEmbedding(base64), vector);
	assert.deepEqual(decodeEmbedding(vector), vector);
});

test("vectors are ordered by the index the gateway reported, not by arrival", () => {
	assert.deepEqual(
		vectorsFrom({
			data: [
				{ index: 1, embedding: [2] },
				{ index: 0, embedding: [1] },
			],
		}),
		[[1], [2]],
	);
	// An answer without indices keeps its own order.
	assert.deepEqual(
		vectorsFrom({ data: [{ embedding: [1] }, { embedding: [2] }] }),
		[[1], [2]],
	);
});

test("similarity is 1 for a vector against itself and undefined when it cannot be computed", () => {
	assert.equal(cosineSimilarity([1, 2, 3], [1, 2, 3])?.toFixed(6), "1.000000");
	assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
	assert.equal(cosineSimilarity([1, 0], [-1, 0]), -1);
	assert.equal(cosineSimilarity([1, 2], [1]), undefined);
	assert.equal(cosineSimilarity([0, 0], [1, 1]), undefined);
	assert.equal(cosineSimilarity([], []), undefined);
});

test("a line is an input, and blank lines are not", () => {
	assert.deepEqual(inputsFrom("  first \n\n second\n   \nthird"), [
		"first",
		"second",
		"third",
	]);
	assert.deepEqual(inputsFrom("   \n  "), []);
});

test("the request goes to the relay, and a failure keeps the gateway's message", async () => {
	let url: string | undefined;
	const ok: FetchLike = async (input) => {
		url = String(input);
		return new Response(JSON.stringify({ data: [{ embedding: [1, 2] }] }), {
			headers: { "content-type": "application/json" },
		});
	};
	const response = await runEmbeddings(
		{ model: "m", inputs: ["x"], settings: {} },
		{ fetch: ok, csrf: () => undefined },
	);
	assert.equal(url, "/api/v1/embeddings");
	assert.deepEqual(vectorsFrom(response), [[1, 2]]);

	const failing: FetchLike = async () =>
		new Response(
			JSON.stringify({ error: { message: "dimensions is not supported" } }),
			{ status: 400, headers: { "content-type": "application/json" } },
		);
	await assert.rejects(
		runEmbeddings(
			{ model: "m", inputs: ["x"], settings: {} },
			{ fetch: failing, csrf: () => undefined },
		),
		/dimensions is not supported/,
	);
});
