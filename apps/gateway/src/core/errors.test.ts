import { GatewayError } from "./errors.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

test("classifies status/type/retryable by class", () => {
	const rl = new GatewayError({ class: "rate_limit", message: "slow down" });
	assert.equal(rl.httpStatus, 429);
	assert.equal(rl.openaiType, "rate_limit_error");
	assert.equal(rl.retryable, true);

	const ctx = new GatewayError({
		class: "context_window",
		message: "too long",
	});
	assert.equal(ctx.code, "context_length_exceeded");
	assert.equal(ctx.retryable, false);

	const auth = new GatewayError({ class: "auth", message: "bad key" });
	assert.equal(auth.httpStatus, 401);
	assert.equal(auth.retryable, false);
});

test("toOpenAI: public message is ALWAYS generic; type/code/param are exposed", () => {
	const err = new GatewayError({
		class: "bad_request",
		message: "messages: required", // internal (logs)
		param: "messages",
		code: "invalid",
	});
	assert.deepEqual(err.toOpenAI(), {
		error: {
			message: "The request is invalid.",
			type: "invalid_request_error",
			param: "messages",
			code: "invalid",
		},
	});
	assert.equal(err.message, "messages: required"); // internal detail preserved
});

test("any error: internal detail for logs, generic public message by class", () => {
	const err = new GatewayError({
		class: "server",
		message: "This model is currently experiencing high demand...",
		status: 503,
	});
	assert.equal(
		err.message,
		"This model is currently experiencing high demand...",
	);
	assert.equal(
		err.toOpenAI().error.message,
		"The service is temporarily unavailable. Please try again later.",
	);
	assert.equal(err.httpStatus, 503);
});

test("publicMessage override exposes a specific message when desired", () => {
	const err = new GatewayError({
		class: "bad_request",
		message: "interno",
		publicMessage: "The 'model' field is required.",
	});
	assert.equal(err.toOpenAI().error.message, "The 'model' field is required.");
});

test("toOpenRouter exposes only numeric HTTP code and safe public message", () => {
	const error = new GatewayError({
		class: "server",
		message: "upstream secret response",
	});
	assert.deepEqual(error.toOpenRouter(), {
		error: {
			code: 502,
			message:
				"The service is temporarily unavailable. Please try again later.",
		},
	});
});

test("allows status override and recognizes instances", () => {
	const err = new GatewayError({
		class: "server",
		message: "boom",
		status: 503,
	});
	assert.equal(err.httpStatus, 503);
	assert.equal(GatewayError.is(err), true);
	assert.equal(GatewayError.is(new Error("x")), false);
});

test("health-neutral and request-scoped dispositions stay internal to logs", () => {
	const err = new GatewayError({
		class: "bad_request",
		message: "candidate cannot consume this image source",
		deploymentHealth: "neutral",
		routingScope: "request",
	});
	assert.equal(err.deploymentHealth, "neutral");
	assert.equal(err.routingScope, "request");
	assert.deepEqual(err.toLog(), {
		class: "bad_request",
		code: null,
		http_status: 400,
		message: "candidate cannot consume this image source",
		routing_scope: "request",
		deployment_health: "neutral",
		failure_kind: "request",
	});
	assert.equal("deployment_health" in err.toOpenAI().error, false);
});

test("provider request rejections do not count as deployment failures", () => {
	for (const cls of [
		"bad_request",
		"context_window",
		"content_policy",
	] as const) {
		const err = new GatewayError({
			class: cls,
			message: "provider rejected this input",
			provider: { status: 400, body: {} },
		});
		assert.equal(err.deploymentHealth, "neutral");
	}

	for (const cls of ["auth", "server"] as const) {
		const err = new GatewayError({
			class: cls,
			message: "deployment failure",
			provider: { status: 500, body: {} },
		});
		assert.equal(err.deploymentHealth, "penalize");
	}

	const throttled = new GatewayError({
		class: "rate_limit",
		message: "shared quota exhausted",
		provider: { status: 429, body: {} },
	});
	assert.equal(throttled.failureKind, "throttle");
	assert.equal(throttled.deploymentHealth, "neutral");
});
