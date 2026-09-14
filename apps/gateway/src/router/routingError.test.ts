import { buildRoutingError } from "./routingError.ts";
import type { CooldownCause } from "./state.ts";
import { GatewayError } from "#core/errors.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

function causes(
	...entries: Array<[string, string]>
): Map<string, CooldownCause> {
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

test("a pool held down by misconfiguration says so, instead of inviting a retry", () => {
	const error = buildRoutingError({
		...base(),
		reason: "cooldown",
		cooldownCauses: causes(["a", "not_found"]),
	});
	assert.equal(error.class, "not_found");
	assert.equal(error.httpStatus, 404);
	assert.equal(error.code, "deployments_misconfigured");
	assert.match(error.publicMessage, /every one of them is misconfigured/);
	// Retrying is the one thing that cannot help, so nothing may suggest it.
	assert.doesNotMatch(error.publicMessage, /retry|try again/i);
	assert.equal(error.headers?.["Retry-After"], undefined);
});

test("every configuration class counts, and the causes still reach the logs", () => {
	for (const cls of ["auth", "permission", "not_found"]) {
		const error = buildRoutingError({
			...base(),
			reason: "cooldown",
			cooldownCauses: causes(["a", cls], ["b", cls]),
		});
		assert.equal(error.class, cls, cls);
		assert.equal(error.code, "deployments_misconfigured", cls);
	}
	const error = buildRoutingError({
		...base(),
		reason: "cooldown",
		cooldownCauses: causes(["a", "auth"]),
	});
	assert.deepEqual(error.provider?.body, {
		cooldown_causes: {
			"deployment:a": { class: "auth", message: "Upstream auth failure" },
		},
	});
});

test("one transient cause in the mix is still worth waiting for", () => {
	const error = buildRoutingError({
		...base(),
		reason: "cooldown",
		cooldownCauses: causes(["a", "not_found"], ["b", "server"]),
		retryAfterMs: 4000,
	});
	assert.equal(error.class, "server");
	assert.equal(error.httpStatus, 503);
	assert.equal(error.code, "deployments_in_cooldown");
	assert.equal(error.headers?.["Retry-After"], "4");
});

test("a cooldown with no recorded cause stays a plain retry", () => {
	const error = buildRoutingError({ ...base(), reason: "cooldown" });
	assert.equal(error.code, "deployments_in_cooldown");
	assert.equal(error.httpStatus, 503);
});

test("the internal message keeps the detail an operator needs", () => {
	const error = buildRoutingError({
		...base(),
		attempts: 1,
		reason: "cooldown",
		cooldownCauses: causes(["a", "not_found"]),
		lastError: new GatewayError({
			class: "not_found",
			message: "models/gemini-omni-1.1-flash is not found",
		}),
	});
	assert.match(error.message, /blink-0826/);
	assert.match(error.message, /reason=cooldown/);
	assert.match(error.message, /gemini-omni-1\.1-flash is not found/);
	// And never in what the caller is shown.
	assert.doesNotMatch(error.publicMessage, /gemini-omni/);
});

test("rate limiting stays a rate limit, with the provider's own delay", () => {
	const error = buildRoutingError({
		...base(),
		reason: "rate_limited",
		retryAfterMs: 2500,
	});
	assert.equal(error.class, "rate_limit");
	assert.equal(error.code, "rate_limit_exceeded");
	assert.equal(error.headers?.["Retry-After"], "3");
});

test("an exhausted pool reports the last error's own class and status", () => {
	const error = buildRoutingError({
		...base(),
		attempts: 3,
		reason: "exhausted",
		lastError: new GatewayError({
			class: "context_window",
			message: "too long",
		}),
	});
	assert.equal(error.class, "context_window");
	assert.equal(error.code, "no_deployments_available");
	assert.match(error.publicMessage, /context window exceeded/);
	assert.match(error.publicMessage, /3 attempts/);
});
