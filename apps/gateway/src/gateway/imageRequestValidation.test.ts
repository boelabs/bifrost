import { assertImageRequestSupported } from "./imageRequestValidation.ts";
import type { ResolvedModelMetadata } from "#catalog/types.ts";
import type { CanonicalImageRequest } from "#core/images.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

const baseReq: CanonicalImageRequest = {
	operation: "generation",
	model: "image",
	prompt: "p",
	stream: false,
	responseFormat: "b64_json",
};
const meta: ResolvedModelMetadata = {
	capabilities: {
		tools: false,
		vision: true,
		reasoning: false,
		structuredOutputs: false,
	},
	supportedCallTypes: ["images.generations"],
	image: {
		maxPromptChars: 100,
		maxN: 1,
		outputFormats: ["png", "webp"],
		qualities: ["medium"],
		responseFormats: ["b64_json"],
		sizes: { "1024x1024": {} },
	},
};

test("image profile: accepts exact parameters", () => {
	assert.doesNotThrow(() =>
		assertImageRequestSupported(
			{ ...baseReq, size: "1024x1024", outputFormat: "webp" },
			meta,
		),
	);
});

test("image profile: rejects approximations and unsupported parameters", () => {
	assert.throws(
		() => assertImageRequestSupported({ ...baseReq, size: "1024x1536" }, meta),
		/does not support size/,
	);
	assert.throws(
		() =>
			assertImageRequestSupported(
				{ ...baseReq, background: "transparent" },
				meta,
			),
		/transparent/,
	);
	assert.throws(
		() =>
			assertImageRequestSupported(
				{ ...baseReq, partialImages: 1, stream: true },
				meta,
			),
		/partial/,
	);
	assert.throws(
		() =>
			assertImageRequestSupported(
				{ ...baseReq, n: 2, stream: true },
				{
					...meta,
					image: { ...meta.image, maxN: 10 },
				},
			),
		/requires n=1/,
	);
	assert.throws(
		() =>
			assertImageRequestSupported(baseReq, {
				...meta,
				image: { ...meta.image, responseFormats: [] },
			}),
		/does not support response_format=b64_json/,
	);
});

test("image profile: validates arbitrary divisible size, ratio, and pixels", () => {
	const arbitrary: ResolvedModelMetadata = {
		...meta,
		image: {
			...meta.image!,
			arbitrarySize: {
				divisibleBy: 16,
				minAspectRatio: 1 / 3,
				maxAspectRatio: 3,
				maxWidth: 3840,
				maxHeight: 3840,
				maxPixels: 3840 * 2160,
			},
		},
	};
	assert.doesNotThrow(() =>
		assertImageRequestSupported({ ...baseReq, size: "1536x864" }, arbitrary),
	);
	assert.throws(
		() =>
			assertImageRequestSupported({ ...baseReq, size: "3840x3840" }, arbitrary),
		/does not support/,
	);
	assert.throws(
		() =>
			assertImageRequestSupported({ ...baseReq, size: "1000x1000" }, arbitrary),
		/does not support/,
	);
});

test("image profile: missing allow-list means unsupported, not permissive", () => {
	const strict: ResolvedModelMetadata = {
		...meta,
		image: { maxN: 1 },
	};
	assert.throws(
		() =>
			assertImageRequestSupported({ ...baseReq, outputFormat: "png" }, strict),
		/does not support output_format/,
	);
	assert.throws(
		() => assertImageRequestSupported({ ...baseReq, quality: "high" }, strict),
		/does not support quality/,
	);
	// A model that declares rungs still rejects one it does not name, but only under `error`.
	const withRungs: ResolvedModelMetadata = {
		...meta,
		image: { ...meta.image, qualities: ["low", "medium"] },
	};
	assert.throws(
		() =>
			assertImageRequestSupported({ ...baseReq, quality: "max" }, withRungs),
		/does not support quality/,
	);
	// `auto` expresses no choice, so it is accepted for every model - like `size: "auto"`.
	assertImageRequestSupported({ ...baseReq, quality: "auto" }, withRungs);
	// Under any strategy but `error` a rung is reconciled per candidate, never rejected here.
	for (const strategy of ["drop", "allow"] as const) {
		assertImageRequestSupported(
			{ ...baseReq, quality: "max" },
			withRungs,
			strategy,
		);
	}
});
