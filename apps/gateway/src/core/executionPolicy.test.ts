import assert from "node:assert/strict";
import { test } from "node:test";

import {
	DEFAULT_EXECUTION_POLICIES,
	resolveExecutionPolicy,
	adaptiveFirstOutputMs,
} from "./executionPolicy.ts";

const base = DEFAULT_EXECUTION_POLICIES.chat.stream;

test("execution policy: no override leaves the global policy untouched", () => {
	assert.equal(resolveExecutionPolicy(base, null, "chat"), base);
	assert.equal(resolveExecutionPolicy(base, {}, "chat"), base);
});

test("execution policy: an override may only tighten each bound", () => {
	const tightened = resolveExecutionPolicy(
		base,
		{ chat: { firstOutputMs: 8_000, totalMs: 60_000 } },
		"chat",
	);
	assert.equal(tightened.firstOutputMs, 8_000);
	assert.equal(tightened.totalMs, 60_000);

	// Widening is ignored: a deployment must not hold a request past the operator's own ceiling.
	const widened = resolveExecutionPolicy(
		base,
		{ chat: { firstOutputMs: base.firstOutputMs * 10 } },
		"chat",
	);
	assert.equal(widened.firstOutputMs, base.firstOutputMs);
});

test("execution policy: a bound the global policy leaves open can be closed", () => {
	const json = DEFAULT_EXECUTION_POLICIES.chat.json;
	assert.equal(json.idleMs, null);
	const resolved = resolveExecutionPolicy(
		json,
		{ all: { idleMs: 15_000 } },
		"chat",
	);
	assert.equal(resolved.idleMs, 15_000);
});

test("execution policy: the specific call type wins over the blanket entry", () => {
	const resolved = resolveExecutionPolicy(
		base,
		{ all: { firstOutputMs: 5_000 }, chat: { firstOutputMs: 9_000 } },
		"chat",
	);
	assert.equal(resolved.firstOutputMs, 9_000);
	// A different call type still falls back to the blanket entry.
	const other = resolveExecutionPolicy(
		DEFAULT_EXECUTION_POLICIES.embeddings.json,
		{ all: { firstOutputMs: 5_000 }, chat: { firstOutputMs: 9_000 } },
		"embeddings",
	);
	assert.equal(other.firstOutputMs, 5_000);
});

test("execution policy: the retry budget is never delegated to a deployment", () => {
	const resolved = resolveExecutionPolicy(
		base,
		{ chat: { firstOutputMs: 1_000 } },
		"chat",
	);
	assert.equal(resolved.maxAttempts, base.maxAttempts);
});

const adaptive = { enabled: true, multiplier: 4, floorMs: 5_000 };

test("adaptive deadline: a fast deployment gets a fraction of the pool's budget", () => {
	// 1.2s typical first output under a 180s pool budget: fail over in ~5s, not three minutes.
	assert.equal(adaptiveFirstOutputMs(180_000, 1_200, adaptive), 5_000);
	assert.equal(adaptiveFirstOutputMs(180_000, 9_000, adaptive), 36_000);
});

test("adaptive deadline: never widens the configured deadline", () => {
	assert.equal(adaptiveFirstOutputMs(8_000, 60_000, adaptive), 8_000);
});

test("adaptive deadline: never drops below the floor", () => {
	assert.equal(adaptiveFirstOutputMs(180_000, 10, adaptive), 5_000);
});

test("adaptive deadline: no measurement keeps the configured deadline", () => {
	assert.equal(adaptiveFirstOutputMs(180_000, null, adaptive), 180_000);
	assert.equal(adaptiveFirstOutputMs(180_000, 0, adaptive), 180_000);
	assert.equal(adaptiveFirstOutputMs(180_000, Number.NaN, adaptive), 180_000);
});

test("adaptive deadline: disabled is a passthrough", () => {
	assert.equal(
		adaptiveFirstOutputMs(180_000, 1_200, { ...adaptive, enabled: false }),
		180_000,
	);
});
