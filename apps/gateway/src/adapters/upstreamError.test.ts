import { mapUpstreamHttpError } from "./upstreamError.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

const mapping = { label: "Synthetic" };

test("upstream errors: Retry-After and failure disposition survive canonical mapping", () => {
	const error = mapUpstreamHttpError(
		{
			status: 429,
			body: { error: { message: "quota exhausted" } },
			headers: { "retry-after": "2.5" },
		},
		mapping,
	);
	assert.equal(error.failureKind, "throttle");
	assert.equal(error.deploymentHealth, "neutral");
	assert.equal(error.retryAfterMs, 2500);
	assert.equal(error.headers?.["Retry-After"], "2.5");
});

test("upstream errors: unusual 4xx request failures do not become server outages", () => {
	const error = mapUpstreamHttpError(
		{
			status: 413,
			body: { error: { message: "payload too large" } },
		},
		mapping,
	);
	assert.equal(error.class, "bad_request");
	assert.equal(error.failureKind, "request");
	assert.equal(error.retryable, false);
	assert.equal(error.deploymentHealth, "neutral");
});

test("upstream errors: provider-body retry hints are a header fallback", () => {
	const fromBody = mapUpstreamHttpError(
		{ status: 429, body: { retry: 4200 } },
		{
			...mapping,
			retryAfterMs: (_status, body) => (body as { retry?: number }).retry,
		},
	);
	assert.equal(fromBody.retryAfterMs, 4200);

	const headerWins = mapUpstreamHttpError(
		{
			status: 429,
			body: { retry: 4200 },
			headers: { "retry-after": "1" },
		},
		{
			...mapping,
			retryAfterMs: (_status, body) => (body as { retry?: number }).retry,
		},
	);
	assert.equal(headerWins.retryAfterMs, 1000);
});

test("upstream errors: invalid provider configuration is quarantinable", () => {
	const error = mapUpstreamHttpError(
		{
			status: 401,
			body: { error: { message: "invalid key" } },
		},
		mapping,
	);
	assert.equal(error.failureKind, "configuration");
	assert.equal(error.deploymentHealth, "penalize");
});
