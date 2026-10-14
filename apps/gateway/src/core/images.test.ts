import { imageUsageToCore } from "./images.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

test("an image endpoint's unsplit output is image output", () => {
	assert.deepEqual(
		imageUsageToCore({
			inputTokens: 20,
			outputTokens: 1120,
			totalTokens: 1140,
		}),
		{
			promptTokens: 20,
			completionTokens: 1120,
			totalTokens: 1140,
			completionImageTokens: 1120,
		},
	);
});

test("an upstream's modality split is kept", () => {
	assert.deepEqual(
		imageUsageToCore({
			inputTokens: 300,
			outputTokens: 1200,
			totalTokens: 1500,
			inputImageTokens: 258,
			outputTextTokens: 80,
		}),
		{
			promptTokens: 300,
			completionTokens: 1200,
			totalTokens: 1500,
			promptImageTokens: 258,
			completionImageTokens: 1120,
		},
	);
	assert.equal(imageUsageToCore(undefined), null);
});
