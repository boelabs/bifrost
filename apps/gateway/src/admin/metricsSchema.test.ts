import { metricsQuery } from "./metricsSchema.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

const range = { start: "2026-09-08T00:00:00Z", end: "2026-09-09T00:00:00Z" };
test("metrics validates dates, interval, deployment IDs and operation vocabulary", () => {
	assert.equal(metricsQuery.parse(range).bucket, "hour");
	for (const patch of [
		{ start: "invalid" },
		{ end: range.start },
		{ end: "2026-09-07T00:00:00Z" },
		{ end: "2026-11-09T00:00:00Z" },
		{ deploymentId: "invalid" },
		{ operation: "chat" },
		{ bucket: "minute" },
	])
		assert.equal(metricsQuery.safeParse({ ...range, ...patch }).success, false);
	assert.equal(
		metricsQuery.safeParse({
			...range,
			operation: "text.generate",
			bucket: "day",
		}).success,
		true,
	);
});
