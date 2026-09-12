import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { test } from "node:test";

import "#adapters/index.ts";

import { assertImageRequestSupported } from "#gateway/imageRequestValidation.ts";
import { redisAvailable, pgAvailable } from "#test-support/infra.ts";
import type { CanonicalImageRequest } from "#core/images.ts";
import { deleteFallbackPolicy } from "#db/repos/router.ts";
import { configureFallback } from "#fallbacks/service.ts";
import { route } from "#router/index.ts";

import {
	type DeploymentRow,
	createDeployment,
	deleteDeployment,
} from "#db/repos/deployments.ts";

const skip = (await Promise.all([pgAvailable(), redisAvailable()])).every(
	Boolean,
)
	? false
	: "Postgres/Redis unavailables";

const request: CanonicalImageRequest = {
	operation: "generation",
	model: "unused",
	prompt: "draw",
	outputFormat: "webp",
	stream: false,
};

/** Custom openaicompatible deployment with credentials and inline CatalogEntry. */
async function deployment(
	publicModel: string,
	outputFormat: "png" | "webp",
): Promise<DeploymentRow> {
	return createDeployment({
		publicModel: publicModel,
		adapterKey: "openaicompatible",
		upstreamModel: `provider-${randomUUID()}`,
		credentials: { apiKey: "test", baseUrl: "https://example.test/v1" },
		transportOverrides: { "image.generate": "images" },
		catalogEntry: {
			operations: {
				"image.generate": {
					maxN: 1,
					outputFormats: [outputFormat],
					responseFormats: ["b64_json"],
					sizes: { "1024x1024": {} },
				},
			},
		},
	});
}

async function routeImage(publicModel: string) {
	return route(
		publicModel,
		"images.generations",
		{
			clientSignal: new AbortController().signal,
			requestId: randomUUID(),
			candidateEligibility: (candidate) =>
				assertImageRequestSupported(request, candidate.meta),
		},
		async (candidate) => candidate.row.id,
	);
}

test("routing images: excludes incompatible profiles before balancing", {
	skip,
}, async () => {
	const publicModel = `images-mixed-${randomUUID()}`;
	const incompatible = await deployment(publicModel, "png");
	const compatible = await deployment(publicModel, "webp");
	try {
		const result = await routeImage(publicModel);
		assert.equal(result.value, compatible.id);
		assert.equal(result.attempts, 1);
		await result.finish(null);
	} finally {
		await Promise.all([
			deleteDeployment(incompatible.id),
			deleteDeployment(compatible.id),
		]);
	}
});

test("routing images: preserves canonical parameters when falling back", {
	skip,
}, async () => {
	const primaryModel = `images-primary-${randomUUID()}`;
	const fallbackModel = `images-fallback-${randomUUID()}`;
	const primary = await deployment(primaryModel, "png");
	const fallback = await deployment(fallbackModel, "webp");
	await configureFallback({ primaryModel, fallbackModels: [fallbackModel] });
	try {
		const result = await routeImage(primaryModel);
		assert.equal(result.value, fallback.id);
		assert.equal(result.fallbackUsed, true);
		assert.equal(result.attempts, 1);
		await result.finish(null);
	} finally {
		await deleteFallbackPolicy(primaryModel, "general");
		await Promise.all([
			deleteDeployment(primary.id),
			deleteDeployment(fallback.id),
		]);
	}
});
