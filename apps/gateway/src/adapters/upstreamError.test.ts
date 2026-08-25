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
	assert.equal(error.publicMessage, "payload too large");
});

test("upstream errors: actionable request detail survives the public mapping", () => {
	const error = mapUpstreamHttpError(
		{
			status: 400,
			body: {
				error: {
					message:
						"'required' must be an array containing every key in properties",
					param: "text.format.schema",
					code: "invalid_json_schema",
				},
			},
		},
		mapping,
	);
	assert.deepEqual(error.toOpenAI(), {
		error: {
			message: "'required' must be an array containing every key in properties",
			type: "invalid_request_error",
			param: "text.format.schema",
			code: "invalid_json_schema",
		},
	});
});

test("upstream errors: public request detail redacts deployment secrets and is bounded", () => {
	const secret = "sk-sensitive-provider-key";
	const upstreamModel = "private-upstream-model";
	const error = mapUpstreamHttpError(
		{
			status: 422,
			body: {
				error: {
					message: `Model ${upstreamModel} rejected credential ${secret}: ${"x".repeat(5_000)}`,
					param: `request.${upstreamModel}`,
					code: "invalid_request",
				},
			},
		},
		mapping,
		{ upstreamModel, credentials: { apiKey: secret } },
	);
	assert.doesNotMatch(
		error.publicMessage,
		/private-upstream-model|sk-sensitive/,
	);
	assert.doesNotMatch(error.param ?? "", /private-upstream-model/);
	assert.ok(error.publicMessage.length <= 4_096);
	assert.match(error.publicMessage, /\[redacted\]/);
});

test("upstream errors: short sensitive values redact as tokens without corrupting prose", () => {
	const error = mapUpstreamHttpError(
		{
			status: 400,
			body: { error: { message: "Model g rejected key k: missing argument" } },
		},
		mapping,
		{ upstreamModel: "g", credentials: { apiKey: "k" } },
	);
	assert.equal(
		error.publicMessage,
		"Model [redacted] rejected key [redacted]: missing argument",
	);
});

test("upstream errors: operational 4xx and 5xx messages remain generic", () => {
	const auth = mapUpstreamHttpError(
		{
			status: 401,
			body: {
				error: {
					message: "credential sk-private was rejected",
					code: "invalid_api_key",
				},
			},
		},
		mapping,
	);
	assert.equal(auth.publicMessage, "Authentication failed.");
	assert.equal(auth.code, "invalid_api_key");

	const server = mapUpstreamHttpError(
		{
			status: 500,
			body: {
				error: {
					message: "private stack detail",
					param: "internal.host",
					code: "database_failed",
				},
			},
		},
		mapping,
	);
	assert.equal(
		server.publicMessage,
		"The service is temporarily unavailable. Please try again later.",
	);
	assert.equal(server.param, null);
	assert.equal(server.code, null);
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
