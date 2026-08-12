import type { CanonicalImageResponse } from "#core/images.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

import {
	imageGenerationRequestSchema,
	toOpenAIImagesResponse,
	generationToCanonical,
	imageEditFieldsSchema,
	toOpenAIImageEvent,
} from "./images.ts";

test("images generation: parses full contract and normalizes", () => {
	const parsed = imageGenerationRequestSchema.parse({
		model: "image",
		prompt: "un gato",
		size: "1536x864",
		output_format: "webp",
		output_compression: 82,
		stream: true,
		partial_images: 2,
		extra_body: { seed: 42 },
	});
	assert.deepEqual(generationToCanonical(parsed), {
		operation: "generation",
		model: "image",
		prompt: "un gato",
		stream: true,
		outputCompression: 82,
		outputFormat: "webp",
		partialImages: 2,
		responseFormat: "b64_json",
		size: "1536x864",
		extraBody: { seed: 42 },
	});
});

test("images generation: rejects unknowns and invalid combinations", () => {
	assert.equal(
		imageGenerationRequestSchema.safeParse({
			model: "x",
			prompt: "p",
			foo: true,
		}).success,
		false,
	);
	assert.equal(
		imageGenerationRequestSchema.safeParse({
			model: "x",
			prompt: "p",
			partial_images: 1,
		}).success,
		false,
	);
	assert.equal(
		imageGenerationRequestSchema.safeParse({
			model: "x",
			prompt: "p",
			response_format: "url",
		}).success,
		false,
	);
	assert.equal(
		imageEditFieldsSchema.safeParse({
			model: "x",
			prompt: "p",
			response_format: "url",
		}).success,
		false,
	);
	assert.equal(
		imageGenerationRequestSchema.safeParse({
			model: "x",
			prompt: "p",
			output_format: "png",
			output_compression: 90,
		}).success,
		false,
	);
});

test("images edits: extra_body must be an already-parsed object", () => {
	assert.equal(
		imageEditFieldsSchema.safeParse({
			model: "x",
			prompt: "p",
			extra_body: { strength: 0.5 },
		}).success,
		true,
	);
	assert.equal(
		imageEditFieldsSchema.safeParse({
			model: "x",
			prompt: "p",
			extra_body: "{}",
		}).success,
		false,
	);
});

test("images response/event: renders OpenAI shape without inventing usage", () => {
	const response = toOpenAIImagesResponse({
		created: 10,
		data: [{ b64Json: "YWJj" }],
		outputFormat: "png",
	});
	assert.deepEqual(response, {
		created: 10,
		data: [{ b64_json: "YWJj" }],
		output_format: "png",
	});
	const event = toOpenAIImageEvent({
		kind: "partial",
		operation: "generation",
		image: { b64Json: "YWJj" },
		partialImageIndex: 0,
		createdAt: 10,
	});
	assert.equal(event.type, "image_generation.partial_image");
	assert.equal(event.partial_image_index, 0);
	assert.equal("usage" in event, false);
	assert.throws(
		() =>
			toOpenAIImagesResponse({
				created: 10,
				data: [{}],
			} as CanonicalImageResponse),
		/missing b64_json/,
	);
});
