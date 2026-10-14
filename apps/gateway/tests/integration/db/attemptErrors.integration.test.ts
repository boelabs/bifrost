/**
 * Integration (real Postgres + Redis): a failed attempt keeps what the upstream said. The attempt
 * row is opened before the upstream is called, so the final write is an upsert, and it must carry
 * the error and diagnostics too, not only the timings.
 */

import { redisAvailable, pgAvailable } from "#test-support/infra.ts";
import { gatewayOperations, upstreamAttempts } from "#db/schema.ts";
import type { OperationLogInput } from "#logging/logger.ts";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { db } from "#db/client.ts";
import { eq } from "drizzle-orm";
import { test } from "node:test";

import {
	beginUpstreamAttempt,
	flushOperationLogs,
	completeOperation,
	beginOperation,
} from "#logging/operations.ts";

const skip = (await Promise.all([pgAvailable(), redisAvailable()])).every(
	Boolean,
)
	? false
	: "Postgres/Redis unavailable";

test("a failed attempt keeps the provider's answer and where it failed", {
	skip,
}, async () => {
	const operationId = randomUUID();
	const requestId = randomUUID();
	const startedAt = new Date();
	const started = beginOperation({
		id: operationId,
		requestId,
		virtualKeyId: null,
		actor: "master-key",
		callType: "chat",
		publicModel: "attempt-errors",
		startedAt,
	});
	beginUpstreamAttempt({
		operationId,
		ordinal: 1,
		deploymentId: randomUUID(),
		deploymentLabel: "primary",
		adapterKey: "openai",
		transport: "chat_completions",
		upstreamModel: "m",
		startedAt,
		requestId,
	});
	await flushOperationLogs();
	try {
		const input: OperationLogInput = {
			operationId,
			requestId,
			virtualKeyId: null,
			publicModel: "attempt-errors",
			deploymentId: null,
			adapterKey: "openai",
			callType: "chat",
			status: "error",
			httpStatus: 400,
			usage: null,
			cost: null,
			durationMs: 12,
			firstOutputMs: null,
			cacheHit: false,
			retries: 0,
			fallbackUsed: false,
			ip: null,
			userAgent: null,
			startTime: startedAt,
			endTime: new Date(),
			requestBody: { model: "attempt-errors" },
			responseBody: null,
			metadata: {},
			error: {
				class: "bad_request",
				code: "invalid_value",
				http_status: 400,
				message: "OpenAI: Invalid value for 'temperature'",
				phase: "response",
			},
			attempts: [
				{
					deploymentId: randomUUID(),
					label: "primary",
					adapterKey: "openai",
					transport: "chat_completions",
					ms: 12,
					startedAt: startedAt.getTime(),
					endedAt: Date.now(),
					headersMs: 10,
					ok: false,
					errorClass: "bad_request",
					errorCode: "invalid_value",
					errorMessage: "OpenAI: Invalid value for 'temperature'",
					phase: "response",
					failureKind: "request",
					httpStatus: 400,
					providerStatus: 400,
					providerBody: {
						error: {
							message: "Invalid value for 'temperature'",
							type: "invalid_request_error",
							param: "temperature",
							code: "invalid_value",
						},
					},
					diagnostics: { providerRequestId: "req_123" },
				},
			],
		};
		completeOperation(operationId, started, input);
		await flushOperationLogs();

		const [attempt] = await db
			.select()
			.from(upstreamAttempts)
			.where(eq(upstreamAttempts.operationId, operationId));
		assert.ok(attempt);
		assert.equal(attempt.failurePhase, "response");
		assert.equal(attempt.failureOwner, "client");
		const error = attempt.error as Record<string, unknown>;
		assert.equal(error.message, "OpenAI: Invalid value for 'temperature'");
		assert.deepEqual(error.provider, {
			type: "invalid_request_error",
			code: "invalid_value",
			param: "temperature",
			message: "Invalid value for 'temperature'",
		});
		assert.equal(
			(attempt.diagnostics as Record<string, unknown>).providerRequestId,
			"req_123",
		);

		const [operation] = await db
			.select({ error: gatewayOperations.error })
			.from(gatewayOperations)
			.where(eq(gatewayOperations.id, operationId));
		assert.ok(operation);
		assert.equal(
			(operation.error as Record<string, unknown>).message,
			"OpenAI: Invalid value for 'temperature'",
		);
	} finally {
		await db
			.delete(upstreamAttempts)
			.where(eq(upstreamAttempts.operationId, operationId));
		await db
			.delete(gatewayOperations)
			.where(eq(gatewayOperations.id, operationId));
	}
});
