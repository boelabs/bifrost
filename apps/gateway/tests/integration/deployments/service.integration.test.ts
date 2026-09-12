import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { test } from "node:test";

import "#adapters/index.ts";

import { createDeployment, previewDeployment } from "#deployments/service.ts";
import { redisAvailable, pgAvailable } from "#test-support/infra.ts";
import { resolveTransport } from "#router/transport.ts";
import type { CatalogEntry } from "#catalog/types.ts";

import {
	decryptDeploymentCredentials,
	listDeploymentCandidates,
} from "#gateway/deploymentCandidates.ts";

import {
	getDeploymentCredentials,
	deleteDeployment,
} from "#db/repos/deployments.ts";

const skip = (await Promise.all([pgAvailable(), redisAvailable()])).every(
	Boolean,
)
	? false
	: "Postgres/Redis unavailables";

test("deployments: custom OpenAI-compatible aggregator with inline catalogEntry resolves explicit transport", {
	skip,
}, async () => {
	const publicModel = `nano-banana-${randomUUID()}`;
	const upstreamModel = "google/gemini-3.1-flash-image-preview";
	const adapterKey = "openaicompatible";
	const transportOverrides = {
		"image.generate": "chat_completions",
		"image.edit": "chat_completions",
	};
	// OpenAI-compatible has no catalog -> custom -> catalogEntry required.
	const catalogEntry: CatalogEntry = {
		operations: {
			"image.generate": {
				maxN: 1,
				outputFormats: ["webp"],
				responseFormats: ["b64_json"],
				sizes: { "1024x1024": {} },
			},
			"image.edit": {
				maxN: 1,
				outputFormats: ["webp"],
				responseFormats: ["b64_json"],
				sizes: { "1024x1024": {} },
			},
		},
	};
	let deploymentId: string | undefined;
	try {
		const preview = await previewDeployment({
			publicModel,
			adapterKey,
			upstreamModel,
			transportOverrides,
			catalogEntry,
		});
		assert.equal(preview.source, "custom");
		assert.equal(
			preview.transportOverrides["image.generate"],
			"chat_completions",
		);
		assert.equal(preview.transportOverrides["image.edit"], "chat_completions");

		const created = await createDeployment({
			publicModel,
			adapterKey,
			upstreamModel,
			transportOverrides,
			catalogEntry,
			credentials: {
				apiKey: "test-key",
				baseUrl: "https://api.aggregator.example/v1",
			},
		});
		deploymentId = created.row.id;
		assert.equal(created.row.upstreamModel, upstreamModel);
		assert.equal(created.row.adapterKey, adapterKey);

		const candidates = await listDeploymentCandidates(
			publicModel,
			"images.generations",
		);
		assert.equal(candidates.length, 1);
		const candidate = candidates[0];
		assert.ok(candidate);
		assert.equal(candidate.upstreamModel, upstreamModel);
		assert.equal(
			resolveTransport(candidate, "images.generations"),
			"chat_completions",
		);
		assert.equal(
			decryptDeploymentCredentials(candidate).baseUrl,
			"https://api.aggregator.example/v1",
		);
		assert.equal(
			(await getDeploymentCredentials(created.row.id))?.apiKey,
			"test-key",
		);
	} finally {
		if (deploymentId) await deleteDeployment(deploymentId);
	}
});
