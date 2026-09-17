import type { DetailedMetrics } from "./api";
import assert from "node:assert/strict";
import { test } from "node:test";

import {
	reportedTokens,
	metricsSearch,
	metricsWindow,
	metricSeries,
} from "./metrics-data";

const now = new Date("2026-09-08T15:30:00Z");
test("metrics today starts at UTC midnight rather than a rolling 24-hour window", () => {
	assert.deepEqual(metricsWindow(metricsSearch.parse({}), now), {
		start: "2026-09-08T00:00:00.000Z",
		end: now.toISOString(),
		bucket: "hour",
	});
	assert.deepEqual(
		metricsWindow(metricsSearch.parse({ period: "yesterday" }), now),
		{
			start: "2026-09-07T00:00:00.000Z",
			end: "2026-09-08T00:00:00.000Z",
			bucket: "hour",
		},
	);
});
test("metrics longer windows include today and use daily buckets", () => {
	assert.equal(
		metricsWindow(metricsSearch.parse({ period: "7d" }), now).start,
		"2026-09-02T00:00:00.000Z",
	);
	assert.equal(
		metricsWindow(metricsSearch.parse({ period: "30d" }), now).bucket,
		"day",
	);
});
test("custom ranges include the end date and reject invalid or excessive windows", () => {
	const custom = (from: string, to: string) =>
		metricsWindow(metricsSearch.parse({ period: "custom", from, to }), now);
	assert.equal(
		custom("2026-09-01", "2026-09-02").end,
		"2026-09-03T00:00:00.000Z",
	);
	assert.equal(custom("2026-09-01", "2026-09-08").end, now.toISOString());
	assert.throws(() => custom("2026-09-03", "2026-09-01"));
	assert.throws(() => custom("2026-09-03", "2026-09-02"));
	assert.throws(() => custom("2026-07-01", "2026-09-01"));
	assert.throws(() => custom("2026-10-01", "2026-10-03"));
	assert.throws(() =>
		metricsWindow(metricsSearch.parse({ period: "custom" }), now),
	);
});
test("metrics distinguishes missing token usage from reported zero", () => {
	assert.equal(reportedTokens({ totalTokens: 0, usageReported: 0 }), "—");
	assert.equal(reportedTokens({ totalTokens: 0, usageReported: 1 }), "0");
});
test("charts fill inactive intervals and preserve missing usage and latency", () => {
	const data = {
		start: "2026-09-08T00:00:00Z",
		end: "2026-09-08T03:20:00Z",
		bucket: "hour",
		series: [
			{
				key: "2026-09-08T00:00:00Z",
				requests: 3,
				usageReported: 0,
				totalTokens: 0,
				p95DurationMs: null,
			},
			{
				key: "2026-09-08T02:00:00Z",
				requests: 1,
				usageReported: 1,
				totalTokens: 40,
				p95DurationMs: 500,
			},
		],
	} as DetailedMetrics;
	assert.deepEqual(
		metricSeries(data, "series", "requests").map((row) => row.value),
		[3, 0, 1, 0],
	);
	assert.deepEqual(
		metricSeries(data, "series", "totalTokens").map((row) => row.value),
		[null, 0, 40, 0],
	);
	assert.deepEqual(
		metricSeries(data, "series", "p95DurationMs").map((row) => row.value),
		[null, null, 500, null],
	);
});

test("cache charts preserve absent legacy fields and distinguish zero from idle buckets", () => {
	const data = {
		start: "2026-09-08T00:00:00Z",
		end: "2026-09-08T03:00:00Z",
		bucket: "hour",
		attemptSeries: [
			{ key: "2026-09-08T00:00:00Z", cacheReadTokens: 0 },
			{ key: "2026-09-08T01:00:00Z" },
		],
	} as DetailedMetrics;
	assert.deepEqual(
		metricSeries(data, "attemptSeries", "cacheReadTokens").map(
			(row) => row.value,
		),
		[0, null, 0],
	);
	assert.deepEqual(
		metricSeries(data, "attemptSeries", "uncachedInputTokens").map(
			(row) => row.value,
		),
		[null, null, 0],
	);
});
