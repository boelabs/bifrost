import { buildRoutingError } from "./routingError.ts";
import type { CooldownCause } from "./state.ts";
import { GatewayError } from "#core/errors.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

function causes(...entries: [string, string][]): Map<string, CooldownCause> {
	return new Map(
		entries.map(([id, cls]) => [
			`deployment:${id}`,
			{ class: cls, message: `Upstream ${cls} failure` },
		]),
	);
}

function base() {
	return {
		publicModel: "blink-0826",
		callType: "videos.generations" as const,
		attempts: 0,
		triedFallback: false,
		retryAfterMs: undefined,
		lastError: undefined,
		cooldownCauses: new Map<string, CooldownCause>(),
	};
}

test("a pool held down by misconfiguration is unavailable, without inviting a retry", () => {
	for (const cls of ["auth", "permission", "not_found"]) {
		const error = buildRoutingError({
			...base(),
			reason: "cooldown",
			retryAfterMs: 4000,
			cooldownCauses: causes(["a", cls], ["b", cls]),
		});
		// Never the caller's credentials or a missing resource on their side.
		assert.equal(error.httpStatus, 503, cls);
		assert.equal(error.code, "model_unavailable", cls);
		assert.equal(error.headers?.["Retry-After"], undefined, cls);
	}
});

test("the cooldown causes reach the logs and never the caller", () => {
	const error = buildRoutingError({
		...base(),
		attempts: 1,
		reason: "cooldown",
		cooldownCauses: causes(["a", "auth"]),
		lastError: new GatewayError({
			class: "not_found",
			message: "models/gemini-omni-1.1-flash is not found",
		}),
	});
	assert.deepEqual(error.provider?.body, {
		cooldown_causes: {
			"deployment:a": { class: "auth", message: "Upstream auth failure" },
		},
	});
	assert.match(error.message, /reason=cooldown/);
	assert.match(error.message, /gemini-omni-1\.1-flash is not found/);
	assert.doesNotMatch(error.publicMessage, /gemini-omni|cooldown|deployment/);
});

test("a transient cooldown is an overload worth retrying", () => {
	const error = buildRoutingError({
		...base(),
		reason: "cooldown",
		cooldownCauses: causes(["a", "not_found"], ["b", "server"]),
		retryAfterMs: 4000,
	});
	assert.equal(error.httpStatus, 503);
	assert.equal(error.code, "model_overloaded");
	assert.equal(error.headers?.["Retry-After"], "4");
});

test("rate limiting stays a rate limit, with the provider's own delay", () => {
	const error = buildRoutingError({
		...base(),
		reason: "rate_limited",
		retryAfterMs: 2500,
	});
	assert.equal(error.class, "rate_limit");
	assert.equal(error.httpStatus, 429);
	assert.equal(error.code, "rate_limit_exceeded");
	assert.equal(error.headers?.["Retry-After"], "3");
});

test("whatever ended the request, the caller hears the last upstream answer", () => {
	for (const reason of ["exhausted", "attempt_limit", "deadline"] as const) {
		const error = buildRoutingError({
			...base(),
			attempts: 3,
			reason,
			lastError: new GatewayError({
				class: "server",
				message: "OpenAI: upstream error (HTTP 500)",
				status: 500,
				provider: { status: 500, body: { error: { message: "boom" } } },
			}),
		});
		assert.equal(error.httpStatus, 500, reason);
		assert.equal(
			error.publicMessage,
			"The service is temporarily unavailable. Please try again later.",
			reason,
		);
		assert.doesNotMatch(error.publicMessage, /attempt|budget|deadline/);
		assert.match(error.message, new RegExp(`reason=${reason}`));
		assert.deepEqual(error.provider?.status, 500);
	}
});

test("a request rejected upstream keeps its sanitized public detail", () => {
	const error = buildRoutingError({
		...base(),
		attempts: 1,
		reason: "exhausted",
		lastError: new GatewayError({
			class: "context_window",
			message: "too long",
			publicMessage: "This model's maximum context length is 8192 tokens.",
			param: "messages",
		}),
	});
	assert.equal(error.httpStatus, 400);
	assert.equal(error.code, "context_length_exceeded");
	assert.equal(error.param, "messages");
	assert.match(error.publicMessage, /maximum context length/);
});

test("no upstream reached at all reads as an unavailable model", () => {
	const error = buildRoutingError({ ...base(), reason: "no_candidates" });
	assert.equal(error.httpStatus, 503);
	assert.equal(error.code, "model_unavailable");
});
