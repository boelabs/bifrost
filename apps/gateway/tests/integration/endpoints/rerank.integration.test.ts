import { listDeploymentCandidates } from "#gateway/deploymentCandidates.ts";
import { makeOpenRouterContractTestApp } from "#test-support/app.ts";
import { redisAvailable, pgAvailable } from "#test-support/infra.ts";
import { invalidateVirtualKey } from "#auth/virtualKeyCache.ts";
import { deleteDeployment } from "#db/repos/deployments.ts";
import { createDeployment } from "#deployments/service.ts";
import { withStubbedFetch } from "#test-support/fetch.ts";
import { rerankHandler } from "#endpoints/rerank.ts";
import { eventually } from "#test-support/wait.ts";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { test } from "node:test";

import {
	type CreatedVirtualKey,
	getVirtualKeyById,
	createVirtualKey,
	deleteVirtualKey,
} from "#db/repos/virtualKeys.ts";

import {
	listOperationsPage,
	getOperationDetail,
} from "#db/repos/operations.ts";

import "#adapters/index.ts";

const hasInfra = (await pgAvailable()) && (await redisAvailable());
const skip = hasInfra ? false : "Postgres/Redis unavailable";

async function waitForOperation(
	requestId: string,
	ready?: (
		operation: NonNullable<Awaited<ReturnType<typeof getOperationDetail>>>,
	) => boolean,
) {
	return eventually(
		async () => {
			const page = await listOperationsPage({
				limit: 1,
				offset: 0,
				requestId,
			});
			const operation = page.rows[0];
			const detail = operation ? await getOperationDetail(operation.id) : null;
			return detail && (!ready || ready(detail)) ? detail : null;
		},
		{ description: `gateway_operation ${requestId}` },
	);
}

test("POST /v1/rerank routes OpenRouter preferences, falls back across adapters, accounts, and logs safely", {
	skip,
}, async () => {
	const app = makeOpenRouterContractTestApp((testApp) => {
		testApp.post("/v1/rerank", rerankHandler);
	});
	const publicModel = `rerank-e2e-${randomUUID()}`;
	const deploymentIds: string[] = [];
	let virtualKey: CreatedVirtualKey | undefined;
	let deniedKey: CreatedVirtualKey | undefined;
	const payload = {
		model: publicModel,
		query: "private query about France",
		documents: ["private Paris document", { text: "private Berlin document" }],
	};

	try {
		for (const deployment of [
			{
				adapterKey: "openrouter",
				upstreamModel: "cohere/rerank-v3.5",
				credentials: { apiKey: "openrouter-test-key" },
			},
			{
				adapterKey: "vercel",
				upstreamModel: "cohere/rerank-v3.5",
				credentials: { apiKey: "vercel-test-key" },
			},
		] as const) {
			const created = await createDeployment({ publicModel, ...deployment });
			deploymentIds.push(created.row.id);
		}
		const candidates = await listDeploymentCandidates(publicModel, "rerank");
		assert.deepEqual(
			candidates.map((candidate) => candidate.adapter.key).sort(),
			["openrouter", "vercel"],
		);
		virtualKey = await createVirtualKey({
			name: `rerank-e2e-${randomUUID()}`,
			allowedModels: [publicModel],
			maxBudgetCents: 10,
			rpm: 20,
			tpm: 10_000,
		});
		deniedKey = await createVirtualKey({
			name: `rerank-denied-${randomUUID()}`,
			allowedModels: ["another-model"],
		});

		const denied = await app.request("/v1/rerank", {
			method: "POST",
			headers: {
				authorization: `Bearer ${deniedKey.rawKey}`,
				"content-type": "application/json",
			},
			body: JSON.stringify(payload),
		});
		assert.equal(denied.status, 403);
		assert.deepEqual(await denied.json(), {
			error: {
				code: 403,
				message: "You do not have access to this resource.",
			},
		});

		let openRouterCalls = 0;
		let vercelCalls = 0;
		const providerRequestId = randomUUID();
		await withStubbedFetch(
			async (input, init) => {
				const url = String(input);
				assert.equal(init?.method, "POST");
				const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
				if (url.includes("openrouter.ai")) {
					openRouterCalls += 1;
					assert.deepEqual(body.provider, {
						only: ["cohere"],
						allow_fallbacks: false,
					});
					assert.equal(
						new Headers(init?.headers).get("authorization"),
						"Bearer openrouter-test-key",
					);
				} else {
					vercelCalls += 1;
				}
				return new Response(
					JSON.stringify({
						id: "gen-rerank-e2e",
						provider: "Cohere",
						results: [
							{
								index: 1,
								relevance_score: 0.9,
								document: { text: "untrusted" },
							},
							{
								index: 0,
								relevance_score: 0.1,
								document: { text: "untrusted" },
							},
						],
						usage: { total_tokens: 0, search_units: 1, cost: 0.001 },
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			},
			async () => {
				const response = await app.request("/v1/rerank", {
					method: "POST",
					headers: {
						authorization: `Bearer ${virtualKey!.rawKey}`,
						"content-type": "application/json",
						"x-request-id": providerRequestId,
						"x-unified-cache": "true",
					},
					body: JSON.stringify({
						...payload,
						provider: { only: ["cohere"], allow_fallbacks: false },
					}),
				});
				const responseBody = await response.json();
				const failureDetail =
					response.status === 200
						? null
						: await waitForOperation(providerRequestId);
				assert.equal(
					response.status,
					200,
					JSON.stringify({ responseBody, failureDetail }),
				);
				assert.deepEqual(responseBody, {
					id: "gen-rerank-e2e",
					model: publicModel,
					provider: "Cohere",
					results: [
						{
							index: 1,
							relevance_score: 0.9,
							document: { text: "private Berlin document" },
						},
						{
							index: 0,
							relevance_score: 0.1,
							document: { text: "private Paris document" },
						},
					],
					usage: { total_tokens: 0, search_units: 1, cost: 0.001 },
				});
			},
		);
		assert.equal(openRouterCalls, 1);
		assert.equal(vercelCalls, 0, "provider preferences must exclude Vercel");

		const operation = await waitForOperation(
			providerRequestId,
			(detail) => detail.attempts[0]?.searchUnits === 1,
		);
		assert.equal(operation.callType, "rerank");
		assert.equal(operation.searchUnits, 1);
		assert.equal(operation.totalTokens, 0);
		assert.equal(Number(operation.consumerCostCents), 0.1);
		assert.equal(Number(operation.upstreamCostCents), 0.1);
		assert.equal(operation.attempts[0]?.searchUnits, 1);
		const billedKey = await eventually(
			async () => {
				const key = await getVirtualKeyById(virtualKey!.row.id);
				return key && Number(key.spendCents) >= 0.1 ? key : null;
			},
			{ description: "rerank virtual-key spend" },
		);
		assert.equal(Number(billedKey.spendCents), 0.1);
		const persisted = JSON.stringify({
			request: operation.requestSummary,
			response: operation.responseSummary,
		});
		assert.doesNotMatch(
			persisted,
			/private query|private Paris|private Berlin/,
		);

		let firstAttempt = true;
		const fallbackUrls: string[] = [];
		await withStubbedFetch(
			async (input) => {
				fallbackUrls.push(String(input));
				if (firstAttempt) {
					firstAttempt = false;
					return new Response(
						JSON.stringify({ error: { message: "temporary" } }),
						{ status: 503, headers: { "content-type": "application/json" } },
					);
				}
				return new Response(
					JSON.stringify({
						results: [
							{ index: 0, relevance_score: 0.8 },
							{ index: 1, relevance_score: 0.2 },
						],
						meta: { billed_units: { search_units: 1 } },
						usage: { total_tokens: 0 },
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			},
			async () => {
				const response = await app.request("/v1/rerank", {
					method: "POST",
					headers: {
						authorization: `Bearer ${virtualKey!.rawKey}`,
						"content-type": "application/json",
					},
					body: JSON.stringify(payload),
				});
				assert.equal(response.status, 200);
			},
		);
		assert.equal(fallbackUrls.length, 2);
		assert.notEqual(
			new URL(fallbackUrls[0]!).host,
			new URL(fallbackUrls[1]!).host,
		);
	} finally {
		for (const key of [virtualKey, deniedKey]) {
			if (!key) continue;
			await invalidateVirtualKey(key.row.keyHash);
			await deleteVirtualKey(key.row.id);
		}
		for (const deploymentId of deploymentIds)
			await deleteDeployment(deploymentId);
	}
});
