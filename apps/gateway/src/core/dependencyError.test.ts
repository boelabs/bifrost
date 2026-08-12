import { GatewayError } from "./errors.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

import {
	DEPENDENCY_RETRY_AFTER_SECONDS,
	dependencyUnavailable,
	isDependencyError,
} from "./dependencyError.ts";

test("isDependencyError: recognizes connection-level codes", () => {
	for (const code of ["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND"]) {
		assert.equal(
			isDependencyError(Object.assign(new Error("x"), { code })),
			true,
		);
	}
});

test("isDependencyError: recognizes ioredis max-retries and postgres messages", () => {
	assert.equal(
		isDependencyError(
			Object.assign(new Error("Reached the max retries per request limit"), {
				name: "MaxRetriesPerRequestError",
			}),
		),
		true,
	);
	assert.equal(isDependencyError(new Error("Connection is closed.")), true);
	assert.equal(isDependencyError(new Error("Connection terminated")), true);
	assert.equal(
		isDependencyError(
			Object.assign(new Error("x"), { code: "CONNECTION_ENDED" }),
		),
		true,
	);
});

test("isDependencyError: ignores ordinary application errors", () => {
	assert.equal(isDependencyError(new Error("invalid model")), false);
	assert.equal(
		isDependencyError(
			new GatewayError({ class: "bad_request", message: "nope" }),
		),
		false,
	);
	assert.equal(isDependencyError(null), false);
	assert.equal(isDependencyError("ECONNREFUSED"), false); // a bare string is not an error object
});

test("dependencyUnavailable: 503 with Retry-After and safe public message", () => {
	const err = dependencyUnavailable(new Error("ECONNREFUSED 127.0.0.1:6379"));
	assert.equal(err.httpStatus, 503);
	assert.equal(
		err.headers?.["retry-after"],
		String(DEPENDENCY_RETRY_AFTER_SECONDS),
	);
	assert.equal(err.retryable, true);
	// the raw cause stays internal; the client sees the generic server message
	assert.match(err.message, /ECONNREFUSED/);
	assert.doesNotMatch(err.publicMessage, /ECONNREFUSED/);
});
