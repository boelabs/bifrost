import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";

import "#adapters/index.ts";

import { redisAvailable, pgAvailable } from "#test-support/infra.ts";
import { GatewayError, type ErrorClass } from "#core/errors.ts";
import { configureFallback } from "#fallbacks/service.ts";
import { capacitySubject } from "#router/circuit.ts";
import { route } from "#router/index.ts";
import { redis } from "#cache/redis.ts";

import {
	type RouterSettingsRow,
	updateRouterSettings,
	getRouterSettings,
} from "#db/repos/router.ts";

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
let originalSettings: RouterSettingsRow | undefined;

before(async () => {
	if (skip) return;
	originalSettings = await getRouterSettings();
	await updateRouterSettings({
		routingStrategy: "least-busy",
		allowedFails: 100,
		cooldownSeconds: 1,
		executionPolicies: {
			...originalSettings!.executionPolicies!,
			chat: {
				...originalSettings!.executionPolicies!.chat,
				json: {
					...originalSettings!.executionPolicies!.chat.json,
					maxAttempts: 6,
					totalMs: 10_000,
				},
			},
		},
		retryAfterSeconds: 0,
	});
});

after(async () => {
	if (originalSettings) {
		await updateRouterSettings({
			routingStrategy: originalSettings.routingStrategy,
			allowedFails: originalSettings.allowedFails,
			cooldownSeconds: originalSettings.cooldownSeconds,
			failureWindowSeconds: originalSettings.failureWindowSeconds,
			maxCooldownSeconds: originalSettings.maxCooldownSeconds,
			halfOpenProbeSeconds: originalSettings.halfOpenProbeSeconds,
			configurationCooldownSeconds:
				originalSettings.configurationCooldownSeconds,
			throttleCooldownSeconds: originalSettings.throttleCooldownSeconds,
			executionPolicies: originalSettings.executionPolicies,
			retryAfterSeconds: originalSettings.retryAfterSeconds,
		}).catch(() => {});
	}
});

function modelName(prefix: string): string {
	return `${prefix}-${randomUUID()}`;
}

async function deployment(
	publicModel: string,
	failureDomain?: string,
): Promise<DeploymentRow> {
	return createDeployment({
		publicModel,
		adapterKey: "openaicompatible",
		upstreamModel: `text-${randomUUID()}`,
		credentials: { apiKey: "test", baseUrl: "https://example.test/v1" },
		...(failureDomain !== undefined ? { failureDomain } : {}),
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

async function cleanupState(deployments: DeploymentRow[]): Promise<void> {
	const bucket = Math.floor(Date.now() / 60_000);
	const keys = deployments.flatMap((item) => [
		`rt:v2:inflight:${item.id}`,
		`rt:v2:inflight-leases:${item.id}`,
		`rt:fails:${item.id}`,
		`rt:failures:${item.id}`,
		`rt:successes:${item.id}`,
		`rt:cooldown:${item.id}`,
		`rt:cooldown:cause:${item.id}`,
		`rt:rpm:${item.id}:${bucket}`,
		`rt:tpm:${item.id}:${bucket}`,
		...["cooldown", "cause", "failures", "history", "probe"].flatMap(
			(suffix) => [
				`rt:circuit:deployment:${item.id}:${suffix}`,
				`rt:circuit:capacity:${capacitySubject(item.id, item.failureDomain).id}:${suffix}`,
			],
		),
	]);
	if (keys.length > 0) await redis.del(...keys);
}

async function cleanupDeployments(deployments: DeploymentRow[]): Promise<void> {
	await cleanupState(deployments);
	await Promise.all(deployments.map((item) => deleteDeployment(item.id)));
}

function fail(errorClass: ErrorClass): never {
	throw new GatewayError({
		class: errorClass,
		message: `synthetic ${errorClass}`,
	});
}

test("router: pool and request budgets bound retries across fallbacks", {
	skip,
}, async () => {
	const primaryModel = modelName("retry-primary");
	const firstFallbackModel = modelName("retry-fallback-1");
	const finalFallbackModel = modelName("retry-fallback-2");
	const deployments = [
		await deployment(primaryModel),
		await deployment(primaryModel),
		await deployment(firstFallbackModel),
		await deployment(finalFallbackModel),
	];
	const counts = new Map<string, number>();
	try {
		await configureFallback({
			primaryModel,
			fallbackModels: [firstFallbackModel, finalFallbackModel],
		});
		const result = await route(
			primaryModel,
			"chat",
			{ clientSignal: new AbortController().signal, requestId: randomUUID() },
			async (candidate) => {
				counts.set(candidate.row.id, (counts.get(candidate.row.id) ?? 0) + 1);
				if (candidate.row.publicModel === finalFallbackModel)
					return candidate.row.id;
				return fail("server");
			},
		);
		assert.equal(counts.get(deployments[0]!.id), 1);
		assert.equal(counts.get(deployments[1]!.id), 1);
		assert.equal(counts.get(deployments[2]!.id), 1);
		assert.equal(counts.get(deployments[3]!.id), 1);
		assert.equal(result.attempts, 4);
		assert.equal(result.fallbackUsed, true);
		const logicalFailureCounts = await redis.mget(
			...deployments
				.slice(0, 3)
				.map((item) => `rt:circuit:deployment:${item.id}:failures`),
		);
		assert.deepEqual(logicalFailureCounts, ["1", "1", "1"]);
		await result.finish(null);
	} finally {
		await cleanupDeployments(deployments);
	}
});

test("router: a large failing pool cannot amplify one request beyond its pool budget", {
	skip,
}, async () => {
	const publicModel = modelName("retry-primary");
	const deployments = await Promise.all(
		Array.from({ length: 12 }, () => deployment(publicModel)),
	);
	const attempted = new Set<string>();
	let calls = 0;
	try {
		await assert.rejects(() =>
			route(
				publicModel,
				"chat",
				{
					clientSignal: new AbortController().signal,
					requestId: randomUUID(),
				},
				async (candidate) => {
					calls += 1;
					attempted.add(candidate.row.id);
					return fail("server");
				},
			),
		);
		assert.equal(calls, 6);
		assert.equal(attempted.size, 6);
	} finally {
		await cleanupDeployments(deployments);
	}
});

test("router: provider throttling blocks one shared quota domain without lowering health", {
	skip,
}, async () => {
	const publicModel = modelName("retry-primary");
	const failureDomain = `shared-quota-${randomUUID()}`;
	const deployments = [
		await deployment(publicModel, failureDomain),
		await deployment(publicModel, failureDomain),
	];
	let calls = 0;
	try {
		await assert.rejects(
			() =>
				route(
					publicModel,
					"chat",
					{
						clientSignal: new AbortController().signal,
						requestId: randomUUID(),
					},
					async () => {
						calls += 1;
						throw new GatewayError({
							class: "rate_limit",
							message: "synthetic shared quota",
							retryAfterMs: 2000,
							headers: { "Retry-After": "2" },
						});
					},
				),
			(error: unknown) => {
				const failure = error as GatewayError;
				return (
					failure.class === "rate_limit" &&
					failure.retryAfterMs === 2000 &&
					failure.headers?.["Retry-After"] === "2"
				);
			},
		);
		assert.equal(calls, 1);
		const healthFailures = await redis.mget(
			...deployments.map((item) => `rt:failures:${item.id}`),
		);
		assert.deepEqual(healthFailures, [null, null]);
	} finally {
		await cleanupDeployments(deployments);
	}
});

test("router: request-scoped failures stop before retries and fallbacks", {
	skip,
}, async () => {
	const primaryModel = modelName("request-error-primary");
	const fallbackModel = modelName("request-error-fallback");
	const deployments = [
		await deployment(primaryModel),
		await deployment(primaryModel),
		await deployment(fallbackModel),
	];
	let attempts = 0;
	try {
		await configureFallback({
			primaryModel,
			fallbackModels: [fallbackModel],
		});
		await assert.rejects(
			() =>
				route(
					primaryModel,
					"chat",
					{
						clientSignal: new AbortController().signal,
						requestId: randomUUID(),
					},
					async () => {
						attempts += 1;
						throw new GatewayError({
							class: "bad_request",
							message: "synthetic request failure",
							routingScope: "request",
						});
					},
				),
			(error: unknown) => {
				const failure = error as GatewayError;
				return (
					failure.class === "bad_request" && failure.attempts?.length === 1
				);
			},
		);
		assert.equal(attempts, 1);
	} finally {
		await cleanupDeployments(deployments);
	}
});

test("router: candidate input incompatibilities do not affect deployment health", {
	skip,
}, async () => {
	const publicModel = modelName("neutral-input-error");
	const deployed = await deployment(publicModel);
	try {
		await assert.rejects(
			() =>
				route(
					publicModel,
					"chat",
					{
						clientSignal: new AbortController().signal,
						requestId: randomUUID(),
					},
					async () => {
						throw new GatewayError({
							class: "bad_request",
							message: "synthetic candidate input incompatibility",
							deploymentHealth: "neutral",
						});
					},
				),
			(error: unknown) => {
				const failure = error as GatewayError;
				return (
					failure.class === "bad_request" && failure.attempts?.length === 1
				);
			},
		);
		const [inflight, circuitFailures, healthFailures, cooldown] =
			await redis.mget(
				`rt:v2:inflight:${deployed.id}`,
				`rt:circuit:deployment:${deployed.id}:failures`,
				`rt:failures:${deployed.id}`,
				`rt:circuit:deployment:${deployed.id}:cooldown`,
			);
		assert.ok(inflight === null || inflight === "0");
		assert.equal(circuitFailures, null);
		assert.equal(healthFailures, null);
		assert.equal(cooldown, null);
	} finally {
		await cleanupDeployments([deployed]);
	}
});

test("router: context_window exhausts all primaries once and selects its reason", {
	skip,
}, async () => {
	const primaryModel = modelName("reason-primary");
	const generalModel = modelName("reason-general");
	const contextModel = modelName("reason-context");
	const deployments = [
		await deployment(primaryModel),
		await deployment(primaryModel),
		await deployment(generalModel),
		await deployment(contextModel),
	];
	const counts = new Map<string, number>();
	try {
		await configureFallback({
			primaryModel,
			fallbackModels: [generalModel],
			reason: "general",
		});
		await configureFallback({
			primaryModel,
			fallbackModels: [contextModel],
			reason: "context_window",
		});
		const result = await route(
			primaryModel,
			"chat",
			{ clientSignal: new AbortController().signal, requestId: randomUUID() },
			async (candidate) => {
				counts.set(candidate.row.id, (counts.get(candidate.row.id) ?? 0) + 1);
				if (candidate.row.publicModel === contextModel) return candidate.row.id;
				if (candidate.row.publicModel === generalModel) return fail("server");
				return fail("context_window");
			},
		);
		assert.equal(counts.get(deployments[0]!.id), 1);
		assert.equal(counts.get(deployments[1]!.id), 1);
		assert.equal(counts.get(deployments[2]!.id), undefined);
		assert.equal(counts.get(deployments[3]!.id), 1);
		assert.equal(result.attempts, 3);
		await result.finish(null);
	} finally {
		await cleanupDeployments(deployments);
	}
});

test("router: mixed primary causes use the general chain", {
	skip,
}, async () => {
	const primaryModel = modelName("mixed-primary");
	const generalModel = modelName("mixed-general");
	const contextModel = modelName("mixed-context");
	const deployments = [
		await deployment(primaryModel),
		await deployment(primaryModel),
		await deployment(generalModel),
		await deployment(contextModel),
	];
	const [contextDeployment, serverDeployment] = deployments;
	const counts = new Map<string, number>();
	try {
		await configureFallback({
			primaryModel,
			fallbackModels: [generalModel],
			reason: "general",
		});
		await configureFallback({
			primaryModel,
			fallbackModels: [contextModel],
			reason: "context_window",
		});
		const result = await route(
			primaryModel,
			"chat",
			{ clientSignal: new AbortController().signal, requestId: randomUUID() },
			async (candidate) => {
				counts.set(candidate.row.id, (counts.get(candidate.row.id) ?? 0) + 1);
				if (candidate.row.publicModel === generalModel) return candidate.row.id;
				if (candidate.row.id === contextDeployment!.id)
					return fail("context_window");
				if (candidate.row.id === serverDeployment!.id) return fail("server");
				return fail("server");
			},
		);
		assert.equal(counts.get(contextDeployment!.id), 1);
		assert.equal(counts.get(serverDeployment!.id), 1);
		assert.equal(counts.get(deployments[2]!.id), 1);
		assert.equal(counts.get(deployments[3]!.id), undefined);
		assert.equal(result.attempts, 3);
		await result.finish(null);
	} finally {
		await cleanupDeployments(deployments);
	}
});

test("router: attempt log carries the deployment label, omitting it when unset", {
	skip,
}, async () => {
	const labeledModel = modelName("labeled");
	const plainModel = modelName("plain");
	const labeled = await createDeployment({
		publicModel: labeledModel,
		adapterKey: "openaicompatible",
		upstreamModel: `text-${randomUUID()}`,
		credentials: { apiKey: "test", baseUrl: "https://example.test/v1" },
		label: "primary - billing key",
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
	const plain = await deployment(plainModel);
	try {
		const route1 = await route(
			labeledModel,
			"chat",
			{ clientSignal: new AbortController().signal, requestId: randomUUID() },
			async (candidate) => candidate.row.id,
		);
		assert.equal(route1.attemptLog[0]?.label, "primary - billing key");
		await route1.finish(null);

		const route2 = await route(
			plainModel,
			"chat",
			{ clientSignal: new AbortController().signal, requestId: randomUUID() },
			async (candidate) => candidate.row.id,
		);
		assert.equal(route2.attemptLog[0]?.label, undefined);
		await route2.finish(null);
	} finally {
		await cleanupDeployments([labeled, plain]);
	}
});
