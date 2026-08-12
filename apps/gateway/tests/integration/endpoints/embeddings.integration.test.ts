import { redisAvailable, pgAvailable } from "#test-support/infra.ts";
import { makeOpenAIContractTestApp } from "#test-support/app.ts";
import { buildCacheKey, cachePayload } from "#cache/cacheKey.ts";
import { invalidateVirtualKey } from "#auth/virtualKeyCache.ts";
import { embeddingsHandler } from "#endpoints/embeddings.ts";
import { deleteDeployment } from "#db/repos/deployments.ts";
import { createDeployment } from "#deployments/service.ts";
import { withStubbedFetch } from "#test-support/fetch.ts";
import { eventually } from "#test-support/wait.ts";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { test } from "node:test";

import {
	embeddingsRequestToCanonical,
	type OpenAIEmbeddingsRequest,
} from "#contracts/openai/embeddings.ts";

import {
	type CreatedVirtualKey,
	createVirtualKey,
	deleteVirtualKey,
} from "#db/repos/virtualKeys.ts";

import {
	invalidateResponseCache,
	responseCacheEpoch,
	cacheGet,
} from "#cache/responseCache.ts";

import {
	listOperationsPage,
	getOperationDetail,
} from "#db/repos/operations.ts";

import "#adapters/index.ts";

const hasInfra = (await pgAvailable()) && (await redisAvailable());
const skip = hasInfra ? false : "Postgres/Redis unavailables";

async function waitForOperation(requestId: string) {
	return eventually(
		async () => {
			const page = await listOperationsPage({
				limit: 1,
				offset: 0,
				requestId,
			});
			const operation = page.rows[0];
			const detail = operation ? await getOperationDetail(operation.id) : null;
			return detail?.lifecycleState === "finished" ? detail : null;
		},
		{ description: `gateway_operation ${requestId}` },
	);
}

async function waitForCacheEntry(key: string) {
	return eventually(() => cacheGet(key), {
		description: `response cache ${key}`,
	});
}

test("POST /v1/embeddings routes, caches, and logs without storing vectors", {
	skip,
}, async () => {
	const app = makeOpenAIContractTestApp((testApp) => {
		testApp.post("/v1/embeddings", embeddingsHandler);
	});
	const publicModel = `embed-e2e-${randomUUID()}`;
	const payload: OpenAIEmbeddingsRequest = {
		model: publicModel,
		input: "red fox",
		encoding_format: "float",
		dimensions: 3,
	};
	let deploymentId: string | undefined;
	let virtualKey: CreatedVirtualKey | undefined;

	let fetchCalls = 0;
	let upstreamBody: Record<string, unknown> | undefined;

	try {
		const deployment = await createDeployment({
			publicModel,
			adapterKey: "openai",
			upstreamModel: "text-embedding-3-small",
			credentials: { apiKey: "test-upstream-key" },
		});
		deploymentId = deployment.row.id;
		virtualKey = await createVirtualKey({
			name: `embeddings-e2e-${randomUUID()}`,
			allowedModels: [publicModel],
		});
		const activeVirtualKey = virtualKey;

		await withStubbedFetch(
			async (input, init) => {
				fetchCalls += 1;
				assert.equal(String(input), "https://api.openai.com/v1/embeddings");
				const headers = new Headers(init?.headers);
				assert.equal(headers.get("authorization"), "Bearer test-upstream-key");
				upstreamBody = JSON.parse(String(init?.body)) as Record<
					string,
					unknown
				>;
				return new Response(
					JSON.stringify({
						object: "list",
						model: "text-embedding-3-small",
						data: [
							{
								object: "embedding",
								embedding: [0.1, 0.2, 0.3],
								index: 0,
							},
						],
						usage: { prompt_tokens: 7, total_tokens: 7 },
					}),
					{
						status: 200,
						headers: { "content-type": "application/json" },
					},
				);
			},
			async () => {
				const firstRequestId = randomUUID();
				const first = await app.request("/v1/embeddings", {
					method: "POST",
					headers: {
						authorization: `Bearer ${activeVirtualKey.rawKey}`,
						"content-type": "application/json",
						"x-unified-cache": "true",
						"x-unified-cache-ttl": "60",
						"x-request-id": firstRequestId,
					},
					body: JSON.stringify(payload),
				});
				assert.equal(first.status, 200);
				const firstBody = await first.json();
				assert.deepEqual(firstBody, {
					object: "list",
					data: [{ object: "embedding", embedding: [0.1, 0.2, 0.3], index: 0 }],
					model: "text-embedding-3-small",
					usage: { prompt_tokens: 7, total_tokens: 7 },
				});
				assert.deepEqual(upstreamBody, {
					model: "text-embedding-3-small",
					input: "red fox",
					encoding_format: "float",
					dimensions: 3,
				});

				const cacheKey = buildCacheKey("embeddings", activeVirtualKey.row.id, {
					epoch: await responseCacheEpoch(),
					payload: cachePayload(
						embeddingsRequestToCanonical(payload) as unknown as Record<
							string,
							unknown
						>,
					),
				});
				await waitForCacheEntry(cacheKey);

				const secondRequestId = randomUUID();
				const second = await app.request("/v1/embeddings", {
					method: "POST",
					headers: {
						authorization: `Bearer ${activeVirtualKey.rawKey}`,
						"content-type": "application/json",
						"x-unified-cache": "true",
						"x-unified-cache-ttl": "60",
						"x-request-id": secondRequestId,
					},
					body: JSON.stringify(payload),
				});
				assert.equal(second.status, 200);
				assert.deepEqual(await second.json(), firstBody);
				assert.equal(fetchCalls, 1, "the second response must come from cache");

				const firstLog = await waitForOperation(firstRequestId);
				assert.equal(firstLog.callType, "embeddings");
				assert.equal(firstLog.publicModel, publicModel);
				assert.equal(firstLog.outcome, "success");
				assert.equal(firstLog.terminalVerified, true);
				assert.equal(firstLog.cacheHit, false);
				assert.equal(firstLog.promptTokens, 7);
				assert.equal(firstLog.completionTokens, 0);
				assert.equal(firstLog.totalTokens, 7);
				assert.equal(firstLog.attempts.length, 1);
				assert.equal(firstLog.attempts[0]!.deploymentId, deploymentId);
				assert.equal(firstLog.attempts[0]!.adapterKey, "openai");
				assert.equal(firstLog.attempts[0]!.outcome, "success");
				assert.equal(firstLog.attempts[0]!.terminalVerified, true);
				const firstSummary = firstLog.responseSummary as Record<
					string,
					unknown
				>;
				assert.deepEqual(firstSummary.fields, [
					"count",
					"dimensions",
					"encoding",
					"model",
					"object",
					"usage",
				]);
				assert.equal(JSON.stringify(firstSummary).includes("0.1"), false);

				const secondLog = await waitForOperation(secondRequestId);
				assert.equal(secondLog.callType, "embeddings");
				assert.equal(secondLog.publicModel, publicModel);
				assert.equal(secondLog.outcome, "success");
				assert.equal(secondLog.terminalVerified, true);
				assert.equal(secondLog.cacheHit, true);
				assert.equal(secondLog.promptTokens, 7);
				assert.equal(secondLog.completionTokens, 0);
				assert.equal(secondLog.totalTokens, 7);
				assert.equal(secondLog.attempts.length, 0);
				const secondSummary = secondLog.responseSummary as Record<
					string,
					unknown
				>;
				assert.deepEqual(secondSummary.fields, firstSummary.fields);
			},
		);
	} finally {
		if (virtualKey) {
			await invalidateResponseCache({
				callType: "embeddings",
				namespace: virtualKey.row.id,
			});
			await invalidateVirtualKey(virtualKey.row.keyHash);
			await deleteVirtualKey(virtualKey.row.id);
		}
		if (deploymentId) await deleteDeployment(deploymentId);
	}
});
