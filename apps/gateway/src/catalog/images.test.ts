import { resolveModelMetadata, getCatalogEntry } from "./index.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

test("catalog images: GPT Image and Nano Banana declare operations/profiles", () => {
	const gpt = getCatalogEntry("openai", "gpt-image-2-2026-04-21")?.operations;
	assert.ok(gpt?.["image.generate"]);
	assert.ok(gpt?.["image.edit"]);
	assert.equal(gpt?.["image.generate"]?.arbitrarySize?.divisibleBy, 16);

	for (const model of [
		"gemini-3.1-flash-image",
		"gemini-3-pro-image",
		"gemini-2.5-flash-image",
	]) {
		const ops = getCatalogEntry("googleaistudio", model)?.operations;
		assert.ok(ops?.["image.generate"], model);
		assert.equal(ops?.["image.generate"]?.maxN, 1);
	}

	const flash31 = getCatalogEntry("googleaistudio", "gemini-3.1-flash-image")
		?.operations["image.generate"];
	assert.deepEqual(flash31?.qualities, ["auto", "low", "high"]);
	assert.equal(flash31?.qualityMappings?.auto?.thinkingLevel, "minimal");
	assert.equal(flash31?.qualityMappings?.low?.thinkingLevel, "minimal");
	assert.equal(flash31?.qualityMappings?.high?.thinkingLevel, "high");

	for (const model of ["gemini-3-pro-image", "gemini-2.5-flash-image"]) {
		const gen = getCatalogEntry("googleaistudio", model)?.operations[
			"image.generate"
		];
		assert.deepEqual(gen?.qualities, ["auto"], model);
		assert.equal(gen?.qualityMappings, undefined, model);
	}
});

test("catalog images: native auto is declared where supported; the default size leads elsewhere", () => {
	assert.deepEqual(
		getCatalogEntry("openai", "gpt-image-2-2026-04-21")?.operations[
			"image.generate"
		]?.autoSize,
		{},
	);
	assert.deepEqual(
		getCatalogEntry("googleaistudio", "gemini-3.1-flash-image")?.operations[
			"image.edit"
		]?.autoSize,
		{},
	);
	for (const model of ["dall-e-3", "dall-e-2"]) {
		const gen = getCatalogEntry("openai", model)?.operations["image.generate"];
		assert.equal(gen?.autoSize, undefined, model);
		assert.equal(Object.keys(gen?.sizes ?? {})[0], "1024x1024", model);
	}
});

test("catalog images: known models default to chat; custom declares image via catalogEntry", () => {
	assert.deepEqual(
		resolveModelMetadata("openai", "gpt-5.4").supportedCallTypes,
		["chat"],
	);
	assert.deepEqual(
		resolveModelMetadata("openaicompatible", "custom-chat").supportedCallTypes,
		["chat"],
	);
	assert.deepEqual(
		resolveModelMetadata("openaicompatible", "custom-image", {
			operations: {
				"image.generate": {
					maxN: 1,
					outputFormats: ["png"],
					responseFormats: ["b64_json"],
					sizes: { "1024x1024": {} },
				},
			},
		}).supportedCallTypes,
		["images.generations"],
	);
});

test("catalog images: gpt-image-1.5 resolves supportedCallTypes/image from the catalog", () => {
	const meta = resolveModelMetadata("openai", "gpt-image-1.5");
	assert.ok(meta.supportedCallTypes?.includes("images.edits"));
	assert.equal(meta.image?.supportsInputFidelity, true);
});
