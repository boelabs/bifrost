import { gatewayOperations, upstreamAttempts } from "#db/schema.ts";
import { detailedMetrics } from "#admin/metricsSchema.ts";
import { makeGatewayTestApp } from "#test-support/app.ts";
import { pgAvailable } from "#test-support/infra.ts";
import { before, after, test } from "node:test";
import { adminApp } from "#admin/index.ts";
import assert from "node:assert/strict";
import { inArray } from "drizzle-orm";
import { env } from "#config/env.ts";
import { db } from "#db/client.ts";

const skip = (await pgAvailable()) ? false : "Postgres unavailable";
const app = makeGatewayTestApp((gateway) => gateway.route("/admin", adminApp));
const auth = { authorization: `Bearer ${env.MASTER_KEY}` };
const model = `it-metrics-${crypto.randomUUID()}`;
const ids = Array.from({ length: 5 }, () => crypto.randomUUID());
const deploymentA = crypto.randomUUID();
const deploymentB = crypto.randomUUID();
const start = "2035-01-01T00:00:00.000Z";
const end = "2035-01-02T00:00:00.000Z";

before(async () => {
	if (skip) {
		return;
	}
	await db.insert(gatewayOperations).values(
		ids.map((id, index) => ({
			id,
			requestId: id,
			publicModel: model,
			callType: "chat",
			startedAt: new Date(index === 4 ? end : start),
			lifecycleState: "finished" as const,
			outcome: index === 2 ? ("error" as const) : ("success" as const),
			terminalVerified: index !== 2,
			cacheHit: index === 1,
			degraded: index === 0,
			totalTokens: index === 0 ? 100 : index === 1 ? 50 : null,
			promptTokens: [80, 40, 30, null, null][index] ?? null,
			cacheReadTokens: index === 0 ? 60 : index === 1 ? 0 : null,
			cacheWriteTokens: index === 0 ? 10 : null,
			consumerCostCents: index === 0 ? "3" : "0",
			durationMs: index === 0 ? 1000 : null,
		})),
	);
	await db.insert(upstreamAttempts).values([
		{
			operationId: ids[0]!,
			ordinal: 1,
			deploymentId: deploymentA,
			deploymentLabel: "Retry route",
			adapterKey: "openai",
			outcome: "error",
			failureKind: "timeout",
			failurePhase: "first_progress",
			totalTokens: 1_500_000_000,
			startedAt: new Date(start),
			endedAt: new Date(start),
		},
		{
			operationId: ids[0]!,
			ordinal: 2,
			deploymentId: deploymentA,
			deploymentLabel: "Renamed route",
			adapterKey: "openai",
			outcome: "error",
			failureKind: "timeout",
			failurePhase: "first_progress",
			totalTokens: 1_500_000_000,
			startedAt: new Date(start),
			endedAt: new Date(start),
		},
		{
			operationId: ids[0]!,
			ordinal: 3,
			deploymentId: deploymentB,
			deploymentLabel: "Fallback route",
			adapterKey: "anthropic",
			outcome: "success",
			totalTokens: 100,
			promptTokens: 80,
			cacheReadTokens: 60,
			cacheWriteTokens: 10,
			startedAt: new Date(start),
			endedAt: new Date(start),
		},
		{
			operationId: ids[2]!,
			ordinal: 1,
			deploymentId: deploymentB,
			deploymentLabel: "Fallback route",
			adapterKey: "anthropic",
			outcome: "error",
			failureKind: "upstream",
			providerStatus: 429,
			startedAt: new Date(start),
			endedAt: new Date(start),
		},
	]);
});

after(async () => {
	if (skip) {
		return;
	}
	await db
		.delete(upstreamAttempts)
		.where(inArray(upstreamAttempts.operationId, ids));
	await db.delete(gatewayOperations).where(inArray(gatewayOperations.id, ids));
});

async function query(extra: Record<string, string> = {}) {
	const response = await app.request(
		`/admin/observability/metrics?${new URLSearchParams({ start, end, publicModel: model, ...extra })}`,
		{ headers: auth },
	);
	assert.equal(response.status, 200);
	const body = (await response.json()) as { data: unknown };
	return detailedMetrics.parse(body.data);
}

test("metrics: requests are counted once while retries keep their own tokens and failures", {
	skip,
}, async () => {
	const data = await query();
	assert.equal(data.requests.requests, 4);
	assert.equal(data.requests.totalTokens, 150);
	assert.equal(data.requests.errors, 1);
	assert.equal(data.requests.cacheHits, 1);
	assert.equal(data.requests.usageReported, 2);
	assert.equal(data.requests.consumerCostCents, 3);
	assert.equal(data.attempts.attempts, 4);
	assert.equal(data.attempts.errors, 3);
	assert.equal(data.attempts.totalTokens, 3_000_000_100);
	assert.equal(data.deployments.length, 2);
	assert.equal(
		data.failures.reduce((sum, row) => sum + row.count, 0),
		3,
	);
	assert.equal(data.series[0]?.requests, 4);
	assert.equal(data.attemptSeries[0]?.totalTokens, data.attempts.totalTokens);
});

test("metrics: deployment filter preserves request totals and isolates the selected attempts", {
	skip,
}, async () => {
	const data = await query({ deploymentId: deploymentA });
	assert.equal(data.requests.requests, 1);
	assert.equal(data.requests.errors, 0);
	assert.equal(data.requests.totalTokens, 100);
	assert.equal(data.attempts.totalTokens, 3_000_000_000);
	assert.equal(data.attempts.errors, 2);
	assert.equal(data.deployments.length, 1);
	assert.equal(data.deployments[0]?.key, deploymentA);
	assert.equal(data.failures[0]?.count, 2);
});

test("metrics: empty and operation-filtered ranges keep nullable latency and zero counts", {
	skip,
}, async () => {
	const data = await query({ operation: "embedding.create", bucket: "day" });
	assert.equal(data.requests.requests, 0);
	assert.equal(data.requests.p95DurationMs, null);
	assert.equal(data.attempts.usageReported, 0);
	assert.equal(data.attempts.promptTokens, null);
	assert.equal(data.attempts.searchUnits, null);
	assert.deepEqual(data.series, []);
	const text = await query({ operation: "text.generate", bucket: "day" });
	assert.equal(text.series[0]?.key, start.replace(".000", ""));
});

test("metrics: requires authentication and rejects invalid queries", async () => {
	const unauthorized = await app.request("/admin/observability/metrics");
	assert.equal(unauthorized.status, 401);
	const invalid = await app.request(
		"/admin/observability/metrics?start=bad&end=bad",
		{ headers: auth },
	);
	assert.equal(invalid.status, 400);
});

async function summary(query: Record<string, string>) {
	const response = await app.request(
		`/admin/observability/summary?${new URLSearchParams(query)}`,
		{ headers: auth },
	);
	return response;
}

test("summary: an explicit range replaces the trailing window, end excluded", {
	skip,
}, async () => {
	const response = await summary({ start, end });
	assert.equal(response.status, 200);
	const { data } = (await response.json()) as {
		data: { totals: { requests: number }; since: string; until: string };
	};
	// Four of the five seeded operations start inside [start, end); the fifth starts exactly at the
	// end, which a half-open window must leave to the next range rather than counting twice.
	assert.equal(Number(data.totals.requests), 4);
	assert.equal(new Date(data.until).toISOString(), end);
});

test("summary: rejects a backwards or oversized range, and still takes a window shortcut", {
	skip,
}, async () => {
	assert.equal((await summary({ start: end, end: start })).status, 400);
	assert.equal(
		(
			await summary({
				start: "2035-01-01T00:00:00Z",
				end: "2035-06-01T00:00:00Z",
			})
		).status,
		400,
	);
	assert.equal((await summary({ start: "not-a-date" })).status, 400);
	assert.equal((await summary({ window: "5m" })).status, 200);
	assert.equal((await summary({ window: "3d" })).status, 400);
});

test("cache metrics preserve reported zeroes, partial coverage and request/attempt separation", {
	skip,
}, async () => {
	const data = await query();
	for (const row of [data.requests, data.series[0]!, data.models[0]!]) {
		assert.equal(row.cacheReadTokens, 60);
		assert.equal(row.cacheWriteTokens, 10);
		assert.equal(row.uncachedInputTokens, 60);
		assert.equal(row.cacheUnreportedInputTokens, 30);
		assert.equal(row.cacheReadReported, 2);
		assert.equal(row.cacheWriteReported, 1);
	}
	assert.equal(data.attempts.uncachedInputTokens, 20);
	assert.equal(data.attempts.cacheReadReported, 1);
	const missing = await query({ deploymentId: deploymentA });
	assert.equal(missing.attempts.cacheReadTokens, null);
	assert.equal(missing.attempts.uncachedInputTokens, null);
	assert.equal(missing.attempts.cacheReadReported, 0);
	for (const groupBy of ["none", "public_model", "actor", "hour", "day"]) {
		const response = await app.request(
			`/admin/usage?${new URLSearchParams({ start, end: "2035-01-01T23:59:59.999Z", publicModel: model, groupBy })}`,
			{ headers: auth },
		);
		assert.equal(response.status, 200);
		const body = (await response.json()) as { data: Record<string, unknown>[] };
		assert.equal(body.data.length, 1);
		assert.equal(body.data[0]?.cacheReadTokens, 60);
		assert.equal(body.data[0]?.uncachedInputTokens, 60);
		assert.equal(body.data[0]?.cacheUnreportedInputTokens, 30);
		assert.equal(body.data[0]?.cacheReadReported, 2);
	}
});
