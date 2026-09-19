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
	// `auto` is not a rung: it is accepted for every model and never reaches an adapter, so it
	// appears in neither the ladder nor the native mappings.
	assert.deepEqual(flash31?.qualities, ["low", "high"]);
	assert.deepEqual(Object.keys(flash31?.qualityMappings ?? {}), [
		"low",
		"high",
	]);
	assert.equal(flash31?.qualityMappings?.low?.thinkingLevel, "minimal");
	assert.equal(flash31?.qualityMappings?.high?.thinkingLevel, "high");

	for (const model of ["gemini-3-pro-image", "gemini-2.5-flash-image"]) {
		const gen = getCatalogEntry("googleaistudio", model)?.operations[
			"image.generate"
		];
		// No thinking control at all, so no rungs are declared.
		assert.equal(gen?.qualities, undefined, model);
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

test("catalog images: GPT Image 2.5 raises the quality ladder, earlier models stop at high", () => {
	for (const adapterKey of ["openai", "azureopenai"]) {
		for (const model of ["gpt-image-2.5-sunburst", "gpt-image-2.5-flare"]) {
			for (const operation of ["image.generate", "image.edit"] as const) {
				const profile = getCatalogEntry(adapterKey, model)?.operations[
					operation
				];
				assert.deepEqual(
					profile?.qualities,
					["low", "medium", "high", "xhigh", "max"],
					`${adapterKey}/${model} ${operation}`,
				);
			}
		}
	}
	// Azure publishes a far tighter prompt limit for the same models.
	assert.equal(
		getCatalogEntry("openai", "gpt-image-2.5-flare")?.operations[
			"image.generate"
		]?.maxPromptChars,
		32_000,
	);
	assert.equal(
		getCatalogEntry("azureopenai", "gpt-image-2.5-flare")?.operations[
			"image.generate"
		]?.maxPromptChars,
		4000,
	);
	// "Earlier GPT Image models support quality settings up to high."
	assert.deepEqual(
		getCatalogEntry("openai", "gpt-image-2")?.operations["image.generate"]
			?.qualities,
		["low", "medium", "high"],
	);
	assert.equal(
		resolveModelMetadata(
			"openai",
			"gpt-image-2.5-flare",
		).image?.qualities?.includes("max"),
		true,
	);
});
