import assert from "node:assert/strict";
import { test } from "node:test";

import {
	customRangeIsValid,
	resolveRange,
	rangeSchema,
	rangeLabel,
	safeRange,
} from "./range.ts";

const now = new Date("2026-09-08T15:30:00Z");

test("ranges are anchored to UTC midnight, not rolled back from now", () => {
	assert.deepEqual(resolveRange({ period: "today" }, "7d", now), {
		start: "2026-09-08T00:00:00.000Z",
		end: now.toISOString(),
		bucket: "hour",
	});
	assert.deepEqual(resolveRange({ period: "yesterday" }, "7d", now), {
		start: "2026-09-07T00:00:00.000Z",
		end: "2026-09-08T00:00:00.000Z",
		bucket: "hour",
	});
});

test("multi-day ranges include today and switch to daily buckets", () => {
	const week = resolveRange({ period: "7d" }, "today", now);
	assert.equal(week.start, "2026-09-02T00:00:00.000Z");
	assert.equal(week.end, now.toISOString());
	assert.equal(week.bucket, "day");
	assert.equal(
		resolveRange({ period: "30d" }, "today", now).start,
		"2026-08-10T00:00:00.000Z",
	);
});

test("the fallback applies when the URL carries no period", () => {
	assert.equal(
		resolveRange({}, "7d", now).start,
		resolveRange({ period: "7d" }, "today", now).start,
	);
});

test('"everything" asks for no bounds at all', () => {
	assert.deepEqual(resolveRange({ period: "all" }, "7d", now), {
		bucket: "day",
	});
});

test("custom ranges include the end date and reject impossible ones", () => {
	const custom = (from: string, to: string) =>
		resolveRange({ period: "custom", from, to }, "7d", now);
	assert.equal(
		custom("2026-09-01", "2026-09-02").end,
		"2026-09-03T00:00:00.000Z",
	);
	// An end date of today is clamped to now rather than to tomorrow's midnight.
	assert.equal(custom("2026-09-01", "2026-09-08").end, now.toISOString());
	assert.throws(() => custom("2026-09-03", "2026-09-01"), /increasing/);
	assert.throws(() => custom("2026-07-01", "2026-09-01"), /31 days/);
	assert.throws(() => custom("2026-10-01", "2026-10-03"), /today or earlier/);
	assert.throws(
		() => resolveRange({ period: "custom" }, "7d", now),
		/both dates/,
	);
});

test("safeRange falls back instead of throwing, for pages that must always render", () => {
	assert.deepEqual(
		safeRange(
			{ period: "custom", from: "2026-10-01", to: "2026-10-03" },
			"today",
			now,
		),
		resolveRange({ period: "today" }, "today", now),
	);
});

test("an unknown period in a hand-edited URL reads as unset", () => {
	const schema = rangeSchema(["today", "7d", "all"] as const);
	assert.equal(schema.period.parse("7d"), "7d");
	assert.equal(schema.period.parse("1h"), undefined);
	assert.equal(schema.period.parse(undefined), undefined);
	assert.equal(schema.from.parse("not-a-date"), undefined);
});

test("the label names the custom dates rather than the word custom", () => {
	assert.equal(rangeLabel({}, "7d"), "Last 7 days");
	assert.equal(
		rangeLabel(
			{ period: "custom", from: "2026-09-01", to: "2026-09-02" },
			"7d",
		),
		"2026-09-01 to 2026-09-02 UTC",
	);
});

test("custom validity is the same rule the control disables its button with", () => {
	assert.equal(customRangeIsValid("2026-09-01", "2026-09-02", now), true);
	assert.equal(customRangeIsValid("2026-09-02", "2026-09-01", now), false);
	assert.equal(customRangeIsValid("2026-09-01", undefined, now), false);
	assert.equal(customRangeIsValid("2026-09-01", "2026-12-01", now), false);
});
