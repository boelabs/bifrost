import assert from "node:assert/strict";
import { test } from "node:test";

import {
	callTypeForOperation,
	operationForCallType,
	OPERATIONS,
} from "./registry.ts";

test("registry separates public operations from internal CallTypes", () => {
	assert.deepEqual(
		OPERATIONS.map((operation) => operation.id),
		[
			"text.generate",
			"image.generate",
			"image.edit",
			"video.generate",
			"audio.transcribe",
			"embedding.create",
			"rerank",
		],
	);
	assert.equal(callTypeForOperation("image.generate"), "images.generations");
	assert.equal(callTypeForOperation("video.generate"), "videos.generations");
	assert.equal(callTypeForOperation("embedding.create"), "embeddings");
	assert.equal(callTypeForOperation("rerank"), "rerank");
	assert.equal(operationForCallType("chat")?.id, "text.generate");
	assert.equal(
		operationForCallType("embeddings")?.publicEndpoints[0],
		"/v1/embeddings",
	);
	assert.equal(
		operationForCallType("rerank")?.publicEndpoints[0],
		"/v1/rerank",
	);
});
