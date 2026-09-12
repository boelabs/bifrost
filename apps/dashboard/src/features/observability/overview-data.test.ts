import { buildHourlyUsage, getOverviewMetrics } from "./overview-data.ts";
import type { Summary, UsageRow } from "./api.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

function usage(
	key: string | null,
	overrides: Partial<UsageRow> = {},
): UsageRow {
	return {
		key,
		requests: 0,
		promptTokens: 0,
		completionTokens: 0,
		reasoningTokens: 0,
		totalTokens: 0,
		searchUnits: 0,
		consumerCostCents: 0,
		upstreamCostCents: 0,
		...overrides,
	};
}

function summary(overrides: Partial<Summary> = {}): Summary {
	return { totals: {}, groups: {}, persistence: {}, alerts: {}, ...overrides };
}

test("overview preserves recorded token totals and separates usage from summary counts", () => {
	const metrics = getOverviewMetrics(
		summary({ totals: { requests: "13", retried: "2", degraded: 3 } }),
		[
			usage("model-a", {
				requests: 7,
				promptTokens: 600,
				completionTokens: 400,
				reasoningTokens: 300,
				totalTokens: 1000,
				consumerCostCents: 2.5,
				upstreamCostCents: 1.25,
			}),
			usage("model-b", {
				requests: 5,
				promptTokens: 200,
				completionTokens: 100,
				reasoningTokens: 50,
				totalTokens: 300,
				searchUnits: 4,
				consumerCostCents: 0.75,
				upstreamCostCents: 0.5,
			}),
		],
	);
	assert.equal(metrics.requests, 12);
	assert.equal(metrics.summaryRequests, 13);
	assert.equal(metrics.promptTokens, 800);
	assert.equal(metrics.completionTokens, 500);
	assert.equal(metrics.reasoningTokens, 350);
	assert.equal(metrics.totalTokens, 1300);
	assert.equal(metrics.searchUnits, 4);
	assert.equal(metrics.consumerCostCents, 3.25);
	assert.equal(metrics.upstreamCostCents, 1.75);
	assert.equal(metrics.retryRate, 2 / 13);
	assert.equal(metrics.degradedRate, 3 / 13);
});

test("overview computes success among finished outcomes and keeps live activity separate", () => {
	const metrics = getOverviewMetrics(
		summary({
			active: 15,
			totals: { requests: 20, degraded: 2 },
			outcomes: [
				{ outcome: "success", requests: "8" },
				{ outcome: "error", requests: 2 },
				{ outcome: "incomplete", requests: 1 },
				{ outcome: "blocked", requests: 1 },
				{ outcome: "cancelled", requests: 1 },
				{ outcome: "abandoned", requests: 1 },
				{ outcome: "unknown", requests: 1 },
				{ outcome: null, requests: 5 },
			],
		}),
		[usage(null, { requests: 20 })],
	);
	assert.equal(metrics.finishedRequests, 15);
	assert.equal(metrics.successRate, 8 / 15);
	assert.equal(metrics.errorRate, 2 / 15);
	assert.equal(metrics.outcomes.inProgress, 5);
	assert.equal(metrics.activeRequests, 15);
	assert.equal(metrics.outcomes.cancelled, 1);
	assert.equal(metrics.outcomes.incomplete, 1);
	assert.equal(metrics.degraded, 2);
});

test("overview uses only the aggregate first-output percentile and preserves zero latency", () => {
	const latencySummary = {
		outcomes: [{ outcome: "success", requests: 3, p95DurationMs: 90_000 }],
	};
	assert.equal(
		getOverviewMetrics(
			summary({ ...latencySummary, totals: { p95FirstOutputMs: "1234.5" } }),
			[],
		).p95FirstOutputMs,
		1234.5,
	);
	assert.equal(
		getOverviewMetrics(
			summary({ ...latencySummary, totals: { p95FirstOutputMs: 0 } }),
			[],
		).p95FirstOutputMs,
		0,
	);
	assert.equal(
		getOverviewMetrics(summary(latencySummary), []).p95FirstOutputMs,
		null,
	);
});

test("overview leaves unavailable rates empty and rejects malformed projection values", () => {
	for (const value of [
		undefined,
		null,
		"",
		"invalid",
		-1,
		Infinity,
		NaN,
		false,
	]) {
		const metrics = getOverviewMetrics(
			summary({
				totals: { requests: value, p95FirstOutputMs: value },
				outcomes: [null, [], {}, { outcome: "success", requests: value }],
			}),
			[],
		);
		assert.equal(metrics.p95FirstOutputMs, null);
		assert.equal(metrics.finishedRequests, 0);
		assert.equal(metrics.successRate, null);
		assert.equal(metrics.errorRate, null);
		assert.equal(metrics.retryRate, null);
		assert.equal(metrics.summaryRequests, 0);
	}
});

test("hourly usage sorts cost-ordered rows, fills UTC gaps and preserves partial edge values", () => {
	const start = "2026-09-07T13:30:00Z";
	const end = "2026-09-08T13:30:00Z";
	const rows = [
		usage("2026-09-08T13:00:00Z", {
			requests: 6,
			consumerCostCents: 10,
		}),
		usage("2026-09-07 13:00:00+00", {
			requests: 2,
			promptTokens: 100,
			completionTokens: 50,
			reasoningTokens: 20,
			totalTokens: 150,
			consumerCostCents: 0.5,
		}),
	];
	const buckets = buildHourlyUsage(rows, start, end);
	assert.equal(buckets.length, 25);
	assert.equal(buckets[0]?.timestamp, Date.parse("2026-09-07T13:00:00Z"));
	assert.equal(buckets[0]?.intervalStart, Date.parse(start));
	assert.equal(buckets[0]?.intervalEnd, Date.parse("2026-09-07T14:00:00Z"));
	assert.equal(buckets.at(-1)?.intervalEnd, Date.parse(end));
	assert.equal(
		buckets.at(-1)?.intervalStart,
		Date.parse("2026-09-08T13:00:00Z"),
	);
	assert.equal(buckets[0]?.requests, 2);
	assert.equal(buckets[0]?.totalTokens, 150);
	assert.equal(buckets[0]?.reasoningTokens, 20);
	assert.equal(buckets[1]?.requests, 0);
	assert.equal(buckets[1]?.consumerCostCents, 0);
	assert.equal(buckets.at(-1)?.requests, 6);
	assert.equal(
		buckets.reduce((sum, bucket) => sum + bucket.requests, 0),
		8,
	);
	assert.equal(rows[0]?.requests, 6);
});

test("hourly usage merges equivalent UTC keys and ignores invalid or out-of-range rows", () => {
	const buckets = buildHourlyUsage(
		[
			usage("2026-09-08 00:00:00+00", { requests: 2, totalTokens: 50 }),
			usage("2026-09-07T20:00:00-04:00", { requests: 3, totalTokens: 75 }),
			usage("2026-09-07T23:00:00Z", { requests: 10 }),
			usage("2026-09-08T02:00:00Z", { requests: 10 }),
			usage("invalid", { requests: 10 }),
			usage(null, { requests: 10 }),
		],
		new Date("2026-09-08T00:00:00Z"),
		Date.parse("2026-09-08T02:00:00Z"),
	);
	assert.equal(buckets.length, 2);
	assert.equal(buckets[0]?.key, "2026-09-08T00:00:00.000Z");
	assert.equal(buckets[0]?.requests, 5);
	assert.equal(buckets[0]?.totalTokens, 125);
	assert.equal(buckets[1]?.requests, 0);
});

test("hourly usage keeps a full empty window and excludes zero-width end buckets", () => {
	const start = Date.parse("2026-09-07T00:00:00Z");
	const end = Date.parse("2026-09-08T00:00:00Z");
	const buckets = buildHourlyUsage([], start, end);
	assert.equal(buckets.length, 24);
	assert.equal(buckets.at(-1)?.intervalEnd, end);
	assert.equal(
		buckets.every((bucket) => bucket.requests === 0),
		true,
	);
	assert.deepEqual(buildHourlyUsage([], end, start), []);
	assert.deepEqual(buildHourlyUsage([], start, start), []);
	assert.deepEqual(buildHourlyUsage([], "invalid", end), []);
	assert.deepEqual(buildHourlyUsage([], start, Infinity), []);
});
