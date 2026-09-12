/**
 * Integration (real Postgres) for key repos: model_deployments (CRUD + encryption) and
 * response_states (store/get + expired-row GC, backing the cron). Runs with
 * `bun run test:integration`. Creates rows with unique names and deletes them at the end.
 */

import { gatewayOperations, upstreamAttempts } from "#db/schema.ts";
import { operationSummary } from "#db/repos/operations.ts";
import { pgAvailable } from "#test-support/infra.ts";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { db } from "#db/client.ts";
import { eq } from "drizzle-orm";
import { test } from "node:test";

import {
	findResponseItemByIdForScope,
	deleteExpiredResponseStates,
	deleteResponseStateForScope,
	getResponseStateForScope,
	storeResponseState,
} from "#db/repos/responseStates.ts";

import {
	listDeploymentsByPublicModel,
	getDeploymentCredentials,
	getDeploymentById,
	createDeployment,
	deleteDeployment,
} from "#db/repos/deployments.ts";

const skip = (await pgAvailable()) ? false : "Postgres unavailable";

test("deployments: create encrypts inline credentials, get/list, and delete", {
	skip,
}, async () => {
	const publicModel = `itest-${randomUUID()}`;
	const row = await createDeployment({
		publicModel: publicModel,
		adapterKey: "openai",
		upstreamModel: "gpt-5.5",
		credentials: { apiKey: "sk-secret-itest" },
		transportOverrides: { "image.generate": "images", "image.edit": "images" },
	});
	try {
		// The credential is stored ENCRYPTED in the deployment, never in plaintext.
		const env = row.credentials as unknown as Record<string, unknown>;
		assert.equal(env.apiKey, undefined, "there must be no plaintext apiKey");
		assert.ok(env.ct && env.iv && env.tag, "must include encrypted ciphertext");

		const fetched = await getDeploymentById(row.id);
		assert.equal(fetched?.publicModel, publicModel);
		assert.deepEqual(fetched?.transportOverrides, {
			"image.generate": "images",
			"image.edit": "images",
		});

		const byPublicModel = await listDeploymentsByPublicModel(publicModel);
		assert.equal(byPublicModel.length, 1);
		assert.equal(byPublicModel[0]!.id, row.id);

		// Decryption round-trip.
		const creds = await getDeploymentCredentials(row.id);
		assert.equal(creds?.apiKey, "sk-secret-itest");
	} finally {
		await deleteDeployment(row.id);
	}
	assert.equal(await getDeploymentById(row.id), undefined);
});

test("response_states: store/get and expired-row GC (cron base)", {
	skip,
}, async () => {
	const id = `resp_itest_${randomUUID()}`;
	const vkId = null;
	await storeResponseState({
		id,
		virtualKeyId: vkId,
		publicModel: "itest",
		deploymentId: null,
		adapterKey: "openai",
		previousResponseId: null,
		requestInput: [{ role: "user", content: "hello" }],
		output: [{ type: "message" }],
		response: { id, object: "response" },
	});
	try {
		const got = await getResponseStateForScope(id, vkId);
		assert.equal(got?.id, id);

		// GC with a far-future "now" -> the row is considered expired and gets deleted.
		const deleted = await deleteExpiredResponseStates(
			new Date(Date.now() + 10 ** 12),
		);
		assert.ok(
			deleted >= 1,
			"deleteExpiredResponseStates must delete at least the test row",
		);
		assert.equal(await getResponseStateForScope(id, vkId), undefined);
	} finally {
		await deleteResponseStateForScope(id, vkId);
	}
});

test("response_states: store=false rows are invisible to item lookup", {
	skip,
}, async () => {
	const id = `resp_internal_itest_${randomUUID()}`;
	const itemId = `fc_itest_${randomUUID()}`;
	const vkId = null;
	await storeResponseState({
		id,
		virtualKeyId: vkId,
		publicModel: "itest",
		deploymentId: null,
		adapterKey: "googleaistudio",
		previousResponseId: null,
		store: false,
		requestInput: [],
		output: [
			{
				type: "function_call",
				id: itemId,
				call_id: "call_1",
			},
		],
		response: { id, object: "response", store: false },
	});
	try {
		assert.equal(await getResponseStateForScope(id, vkId), undefined);
		assert.equal(await findResponseItemByIdForScope(itemId, vkId), undefined);
	} finally {
		await deleteExpiredResponseStates(new Date(Date.now() + 10 ** 12));
	}
});

test("observability summary counts operations with protocol failures", {
	skip,
}, async () => {
	const operationId = randomUUID();
	const startedAt = new Date();
	await db.insert(gatewayOperations).values({
		id: operationId,
		requestId: randomUUID(),
		publicModel: "itest-protocol-summary",
		callType: "responses",
		lifecycleState: "finished",
		outcome: "error",
		degraded: true,
		startedAt,
		endedAt: startedAt,
	});
	await db.insert(upstreamAttempts).values({
		operationId,
		ordinal: 1,
		adapterKey: "googleaistudio",
		outcome: "error",
		failureOwner: "provider",
		failureKind: "protocol",
		failurePhase: "streaming",
		startedAt,
		endedAt: startedAt,
	});
	try {
		const summary = await operationSummary(
			new Date(startedAt.getTime() - 1_000),
		);
		assert.ok(Number(summary.totals.protocolErrors) >= 1);
	} finally {
		await db
			.delete(upstreamAttempts)
			.where(eq(upstreamAttempts.operationId, operationId));
		await db
			.delete(gatewayOperations)
			.where(eq(gatewayOperations.id, operationId));
	}
});
