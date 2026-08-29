import { modelsWildcardHandler, listModelsHandler } from "#endpoints/models.ts";
import { redisAvailable, pgAvailable } from "#test-support/infra.ts";
import { invalidateVirtualKey } from "#auth/virtualKeyCache.ts";
import { makeGatewayTestApp } from "#test-support/app.ts";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { test } from "node:test";

import {
	type CreatedVirtualKey,
	createVirtualKey,
	deleteVirtualKey,
} from "#db/repos/virtualKeys.ts";

import {
	updateDeployment,
	createDeployment,
	deleteDeployment,
} from "#deployments/service.ts";

import "#adapters/index.ts";

const hasInfra = (await pgAvailable()) && (await redisAvailable());
const skip = hasInfra ? false : "Postgres/Redis unavailables";

// Mirrors src/index.ts's actual route wiring: /v1/models is unauthenticated, unlike the rest of /v1/*.
function modelsTestApp() {
	return makeGatewayTestApp((app) => {
		app.get("/v1/models", listModelsHandler);
		app.get("/v1/models/*", modelsWildcardHandler);
	});
}

test("GET /v1/models and /v1/models/{id} are public, but /v1/models/{id}/deployments requires a key", {
	skip,
}, async () => {
	const app = modelsTestApp();
	const publicModel = `models-e2e-${randomUUID()}`;
	let deploymentId: string | undefined;
	let virtualKey: CreatedVirtualKey | undefined;

	try {
		const deployment = await createDeployment({
			publicModel,
			adapterKey: "openai",
			upstreamModel: "gpt-5.5",
			credentials: { apiKey: "test-upstream-key" },
			weight: 7,
			rpmLimit: 42,
		});
		deploymentId = deployment.row.id;
		virtualKey = await createVirtualKey({
			name: `models-e2e-${randomUUID()}`,
		});
		const activeVirtualKey = virtualKey;

		// Public listing: no key needed, no per-deployment operational data.
		const list = await app.request("/v1/models");
		assert.equal(list.status, 200);
		const listBody = (await list.json()) as { data: Array<{ id: string }> };
		assert.ok(listBody.data.some((m) => m.id === publicModel));

		const single = await app.request(`/v1/models/${publicModel}`);
		assert.equal(single.status, 200);
		const singleBody = (await single.json()) as Record<string, unknown>;
		assert.equal(singleBody.id, publicModel);
		assert.equal("weight" in singleBody, false);
		assert.equal("metrics" in singleBody, false);

		// Deployments sub-resource: internal routing/rate-limit/health data - must require a key.
		const deploymentsNoKey = await app.request(
			`/v1/models/${publicModel}/deployments`,
		);
		assert.equal(deploymentsNoKey.status, 401);

		const deploymentsBadKey = await app.request(
			`/v1/models/${publicModel}/deployments`,
			{ headers: { authorization: "Bearer not-a-real-key" } },
		);
		assert.equal(deploymentsBadKey.status, 401);

		const deploymentsWithKey = await app.request(
			`/v1/models/${publicModel}/deployments`,
			{ headers: { authorization: `Bearer ${activeVirtualKey.rawKey}` } },
		);
		assert.equal(deploymentsWithKey.status, 200);
		const deploymentsBody = (await deploymentsWithKey.json()) as {
			data: Array<{
				weight: number;
				status: string;
				retry_after_ms: number | null;
				limits: { rpm: number | null };
			}>;
		};
		assert.equal(deploymentsBody.data.length, 1);
		assert.equal(deploymentsBody.data[0]?.weight, 7);
		assert.equal(deploymentsBody.data[0]?.limits.rpm, 42);
		assert.equal(deploymentsBody.data[0]?.status, "available");
		assert.equal(deploymentsBody.data[0]?.retry_after_ms, null);
	} finally {
		if (virtualKey) {
			await invalidateVirtualKey(virtualKey.row.keyHash);
			await deleteVirtualKey(virtualKey.row.id);
		}
		if (deploymentId) await deleteDeployment(deploymentId);
	}
});

test("rerank model discovery exposes operation, modality, search pricing, and redacted transport", {
	skip,
}, async () => {
	const app = modelsTestApp();
	const publicModel = `rerank-models-e2e-${randomUUID()}`;
	let deploymentId: string | undefined;
	let virtualKey: CreatedVirtualKey | undefined;
	try {
		const deployment = await createDeployment({
			publicModel,
			adapterKey: "openrouter",
			upstreamModel: "cohere/rerank-v3.5",
			credentials: { apiKey: "test-upstream-key" },
			transportOverrides: { rerank: "openrouter_rerank" },
		});
		deploymentId = deployment.row.id;
		virtualKey = await createVirtualKey({
			name: `rerank-models-e2e-${randomUUID()}`,
		});

		const single = await app.request(`/v1/models/${publicModel}`);
		assert.equal(single.status, 200);
		const body = (await single.json()) as {
			architecture: { input_modalities: string[]; output_modalities: string[] };
			pricing: Record<string, string>;
			operations: Array<{ id: string; endpoints: string[] }>;
		};
		assert.deepEqual(body.architecture.input_modalities, ["text"]);
		assert.deepEqual(body.architecture.output_modalities, ["rerank"]);
		assert.equal(body.pricing.search_unit, "0.001");
		assert.deepEqual(body.operations, [
			{ id: "rerank", endpoints: ["/v1/rerank"] },
		]);

		const detail = await app.request(`/v1/models/${publicModel}/deployments`, {
			headers: { authorization: `Bearer ${virtualKey.rawKey}` },
		});
		assert.equal(detail.status, 200);
		const detailBody = (await detail.json()) as {
			data: Array<Record<string, unknown>>;
		};
		assert.equal(detailBody.data[0]?.upstreamModel, undefined);
		assert.equal(detailBody.data[0]?.upstream_model, undefined);
		assert.deepEqual(detailBody.data[0]?.transports, {
			rerank: "openrouter_rerank",
		});
	} finally {
		if (virtualKey) {
			await invalidateVirtualKey(virtualKey.row.keyHash);
			await deleteVirtualKey(virtualKey.row.id);
		}
		if (deploymentId) await deleteDeployment(deploymentId);
	}
});

test("public model cache invalidates after deployment mutations", {
	skip,
}, async () => {
	const app = modelsTestApp();
	const initialModel = `models-cache-${randomUUID()}`;
	const renamedModel = `${initialModel}-renamed`;
	let deploymentId: string | undefined;

	try {
		const deployment = await createDeployment({
			publicModel: initialModel,
			adapterKey: "openai",
			upstreamModel: "gpt-5.5",
			credentials: { apiKey: "test-upstream-key" },
		});
		deploymentId = deployment.row.id;

		assert.equal((await app.request(`/v1/models/${initialModel}`)).status, 200);
		await updateDeployment(deploymentId, { publicModel: renamedModel });
		assert.equal((await app.request(`/v1/models/${initialModel}`)).status, 404);
		assert.equal((await app.request(`/v1/models/${renamedModel}`)).status, 200);

		await deleteDeployment(deploymentId);
		deploymentId = undefined;
		assert.equal((await app.request(`/v1/models/${renamedModel}`)).status, 404);
	} finally {
		if (deploymentId) await deleteDeployment(deploymentId);
	}
});
