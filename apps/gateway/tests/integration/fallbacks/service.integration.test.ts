import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { test } from "node:test";

import "#adapters/index.ts";

import { updateDeployment } from "#deployments/service.ts";
import { configureFallback } from "#fallbacks/service.ts";
import { getFallbackPolicy } from "#db/repos/router.ts";
import { pgAvailable } from "#test-support/infra.ts";
import { GatewayError } from "#core/errors.ts";

import {
	type DeploymentRow,
	createDeployment,
	deleteDeployment,
} from "#db/repos/deployments.ts";

const skip = (await pgAvailable()) ? false : "Postgres unavailable";

function modelName(prefix: string): string {
	return `${prefix}-${randomUUID()}`;
}

async function textDeployment(publicModel: string): Promise<DeploymentRow> {
	return createDeployment({
		publicModel,
		adapterKey: "openaicompatible",
		upstreamModel: `text-${randomUUID()}`,
		credentials: { apiKey: "test", baseUrl: "https://example.test/v1" },
		catalogEntry: {
			operations: {
				"text.generate": {
					capabilities: {
						tools: true,
						vision: false,
						reasoning: false,
						structuredOutputs: true,
					},
				},
			},
		},
	});
}

async function imageDeployment(publicModel: string): Promise<DeploymentRow> {
	return createDeployment({
		publicModel,
		adapterKey: "openaicompatible",
		upstreamModel: `image-${randomUUID()}`,
		credentials: { apiKey: "test", baseUrl: "https://example.test/v1" },
		catalogEntry: {
			operations: {
				"image.generate": {
					maxN: 1,
					outputFormats: ["png"],
					responseFormats: ["b64_json"],
					sizes: { "1024x1024": {} },
				},
			},
		},
	});
}

test("fallback config: requires existing public models, no duplicates, and a shared operation", {
	skip,
}, async () => {
	const primaryModel = modelName("fallback-primary");
	const textModel = modelName("fallback-text");
	const imageModel = modelName("fallback-image");
	const primary = await textDeployment(primaryModel);
	const text = await textDeployment(textModel);
	const image = await imageDeployment(imageModel);
	try {
		await assert.rejects(
			configureFallback({
				primaryModel: modelName("missing"),
				fallbackModels: [textModel],
			}),
			(error) => GatewayError.is(error) && error.param === "primaryModel",
		);
		await assert.rejects(
			configureFallback({
				primaryModel,
				fallbackModels: [modelName("missing")],
			}),
			(error) => GatewayError.is(error) && error.param === "fallbackModels.0",
		);
		await assert.rejects(
			configureFallback({
				primaryModel,
				fallbackModels: [textModel, textModel],
			}),
			(error) => GatewayError.is(error) && error.param === "fallbackModels",
		);
		await assert.rejects(
			configureFallback({ primaryModel, fallbackModels: [imageModel] }),
			(error) => GatewayError.is(error) && error.param === "fallbackModels.0",
		);

		const configured = await configureFallback({
			primaryModel,
			fallbackModels: [textModel],
			reason: "context_window",
		});
		assert.equal(configured.reason, "context_window");
		assert.deepEqual(configured.fallbackModels, [textModel]);
	} finally {
		await Promise.all([
			deleteDeployment(primary.id),
			deleteDeployment(text.id),
			deleteDeployment(image.id),
		]);
	}
});

test("fallback lifecycle: preserves partial pools, prunes targets, and deletes orphan primaries", {
	skip,
}, async () => {
	const primaryModel = modelName("lifecycle-primary");
	const targetModel = modelName("lifecycle-target");
	const secondaryModel = modelName("lifecycle-secondary");
	const primary = await textDeployment(primaryModel);
	const targetA = await textDeployment(targetModel);
	const targetB = await textDeployment(targetModel);
	const secondary = await textDeployment(secondaryModel);
	try {
		await configureFallback({
			primaryModel,
			fallbackModels: [targetModel, secondaryModel],
		});

		await deleteDeployment(targetA.id);
		assert.deepEqual(
			(await getFallbackPolicy(primaryModel, "general"))?.fallbackModels,
			[targetModel, secondaryModel],
		);

		await deleteDeployment(targetB.id);
		assert.deepEqual(
			(await getFallbackPolicy(primaryModel, "general"))?.fallbackModels,
			[secondaryModel],
		);

		await deleteDeployment(secondary.id);
		assert.equal(await getFallbackPolicy(primaryModel, "general"), undefined);

		const replacement = await textDeployment(targetModel);
		try {
			await configureFallback({ primaryModel, fallbackModels: [targetModel] });
			await assert.rejects(
				updateDeployment(primary.id, { publicModel: modelName("renamed") }),
				(error) => GatewayError.is(error) && error.param === "publicModel",
			);

			await deleteDeployment(primary.id);
			assert.equal(await getFallbackPolicy(primaryModel, "general"), undefined);
		} finally {
			await deleteDeployment(replacement.id);
		}
	} finally {
		await Promise.all([
			deleteDeployment(primary.id),
			deleteDeployment(targetA.id),
			deleteDeployment(targetB.id),
			deleteDeployment(secondary.id),
		]);
	}
});
