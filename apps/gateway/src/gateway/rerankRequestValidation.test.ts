import { openrouterAdapter } from "#adapters/openrouter/index.ts";
import type { ResolvedModelMetadata } from "#catalog/types.ts";
import type { CanonicalRerankRequest } from "#core/rerank.ts";
import { vercelAdapter } from "#adapters/vercel/index.ts";
import { GatewayError } from "#core/errors.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

import {
	assertRerankProviderSupported,
	assertRerankRequestSupported,
} from "./rerankRequestValidation.ts";

function meta(
	overrides: Partial<NonNullable<ResolvedModelMetadata["rerank"]>> = {},
): ResolvedModelMetadata {
	const rerank = {
		documentModalities: ["text" as const],
		maxDocuments: 3,
		maxQueryBytes: 10,
		maxDocumentBytes: 8,
		maxTotalDocumentBytes: 12,
		...overrides,
	};
	return {
		capabilities: {
			tools: false,
			vision: false,
			reasoning: false,
			structuredOutputs: false,
		},
		rerank,
		operations: { rerank },
	};
}

const request: CanonicalRerankRequest = {
	model: "m",
	query: "query",
	documents: [
		{ type: "text", text: "one" },
		{ type: "text", text: "two" },
	],
};

function unsupported(error: unknown): boolean {
	return GatewayError.is(error) && error.class === "bad_request";
}

test("rerank request validation accepts a text request within per-model limits", () => {
	assert.doesNotThrow(() => assertRerankRequestSupported(request, meta()));
});

test("rerank request validation requires a rerank profile and text modality", () => {
	const noProfile = meta();
	delete noProfile.rerank;
	delete noProfile.operations?.rerank;
	assert.throws(
		() => assertRerankRequestSupported(request, noProfile),
		unsupported,
	);
	assert.throws(
		() =>
			assertRerankRequestSupported(
				request,
				meta({ documentModalities: ["image"] }),
			),
		unsupported,
	);
});

test("rerank request validation enforces document, query, and byte limits", () => {
	const cases: CanonicalRerankRequest[] = [
		{ ...request, documents: [...request.documents, ...request.documents] },
		{ ...request, query: "query too long" },
		{ ...request, documents: [{ type: "text", text: "document too long" }] },
		{
			...request,
			documents: [
				{ type: "text", text: "1234567" },
				{ type: "text", text: "7654321" },
			],
		},
	];
	for (const value of cases)
		assert.throws(
			() => assertRerankRequestSupported(value, meta()),
			unsupported,
		);
});

test("rerank request validation keeps image documents disabled even for prepared profiles", () => {
	assert.throws(
		() =>
			assertRerankRequestSupported(
				{
					...request,
					documents: [{ type: "image_url", url: "https://x.test/i.png" }],
				},
				meta({ documentModalities: ["text", "image"] }),
			),
		unsupported,
	);
});

test("provider preferences admit OpenRouter and exclude Vercel without affecting ordinary requests", () => {
	assert.doesNotThrow(() =>
		assertRerankProviderSupported(request, vercelAdapter),
	);
	const routed = { ...request, provider: { only: ["cohere"] } };
	assert.doesNotThrow(() =>
		assertRerankProviderSupported(routed, openrouterAdapter),
	);
	assert.throws(
		() => assertRerankProviderSupported(routed, vercelAdapter),
		unsupported,
	);
});
