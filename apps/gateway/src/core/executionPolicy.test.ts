import assert from "node:assert/strict";
import { test } from "node:test";

import {
	normalizeExecutionPolicies,
	DEFAULT_EXECUTION_POLICIES,
	storableExecutionPolicies,
	resolveExecutionPolicy,
} from "./executionPolicy.ts";

const base = DEFAULT_EXECUTION_POLICIES.chat.stream;

test("defaults are as patient as the providers' own SDKs", () => {
	for (const mode of ["json", "stream"] as const) {
		assert.ok(DEFAULT_EXECUTION_POLICIES.chat[mode].responseMs >= 600_000);
	}
	assert.ok((DEFAULT_EXECUTION_POLICIES.chat.stream.idleMs ?? 0) >= 600_000);
});

test("execution policy: no override leaves the global policy untouched", () => {
	assert.equal(resolveExecutionPolicy(base, null, "chat"), base);
	assert.equal(resolveExecutionPolicy(base, {}, "chat"), base);
});

test("execution policy: an override may only tighten each bound", () => {
	const tightened = resolveExecutionPolicy(
		base,
		{ chat: { responseMs: 8000, totalMs: 60_000 } },
		"chat",
	);
	assert.equal(tightened.responseMs, 8000);
	assert.equal(tightened.totalMs, 60_000);

	const widened = resolveExecutionPolicy(
		base,
		{ chat: { responseMs: base.responseMs * 10 } },
		"chat",
	);
	assert.equal(widened.responseMs, base.responseMs);
});

test("execution policy: a bound the global policy leaves open can be closed", () => {
	const { json } = DEFAULT_EXECUTION_POLICIES.chat;
	assert.equal(json.idleMs, null);
	const resolved = resolveExecutionPolicy(
		json,
		{ all: { idleMs: 15_000 } },
		"chat",
	);
	assert.equal(resolved.idleMs, 15_000);
});

test("execution policy: the specific call type wins over the blanket entry", () => {
	const overrides = {
		all: { responseMs: 5000 },
		chat: { responseMs: 9000 },
	};
	assert.equal(
		resolveExecutionPolicy(base, overrides, "chat").responseMs,
		9000,
	);
	assert.equal(
		resolveExecutionPolicy(
			DEFAULT_EXECUTION_POLICIES.embeddings.json,
			overrides,
			"embeddings",
		).responseMs,
		5000,
	);
});

test("execution policy: an override saved as firstOutputMs still tightens the response", () => {
	const legacy = { chat: { firstOutputMs: 7000 } } as never;
	assert.equal(resolveExecutionPolicy(base, legacy, "chat").responseMs, 7000);
});

test("execution policy: the retry budget is never delegated to a deployment", () => {
	const resolved = resolveExecutionPolicy(
		base,
		{ chat: { responseMs: 1000 } },
		"chat",
	);
	assert.equal(resolved.maxAttempts, base.maxAttempts);
});

test("stored policies in the retired shape fall back to the defaults", () => {
	const retired = {
		chat: {
			json: {
				firstOutputMs: 300_000,
				idleMs: null,
				reasoningOnlyMs: null,
				preCommitMs: 300_000,
				totalMs: 600_000,
				maxAttempts: 6,
			},
		},
	};
	const normalized = normalizeExecutionPolicies(retired);
	assert.deepEqual(normalized.chat.json, DEFAULT_EXECUTION_POLICIES.chat.json);
	assert.deepEqual(normalized.rerank, DEFAULT_EXECUTION_POLICIES.rerank);
	assert.deepEqual(
		normalizeExecutionPolicies(null),
		DEFAULT_EXECUTION_POLICIES,
	);
});

test("the stored form round-trips and stays readable by the previous release", () => {
	const stored = storableExecutionPolicies(DEFAULT_EXECUTION_POLICIES);
	assert.deepEqual(
		normalizeExecutionPolicies(stored),
		DEFAULT_EXECUTION_POLICIES,
	);
	const chat = stored.chat?.stream as Record<string, number | null>;
	// The previous release requires firstOutputMs <= preCommitMs <= totalMs.
	assert.ok((chat.firstOutputMs ?? 0) <= (chat.preCommitMs ?? 0));
	assert.ok((chat.preCommitMs ?? 0) <= (chat.totalMs ?? 0));
	assert.equal(chat.reasoningOnlyMs, null);
});
