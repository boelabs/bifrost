import { isManagementPath, publicizeManagementError } from "./errors.ts";
import { GatewayError } from "#core/errors.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

test("management paths are exactly /admin and /auth", () => {
	for (const path of [
		"/admin",
		"/admin/keys",
		"/auth/session",
		"/auth/config",
	]) {
		assert.equal(isManagementPath(path), true, path);
	}
	for (const path of [
		"/v1/chat/completions",
		"/v1/models",
		"/health/ready",
		"/dashboard/anything",
	]) {
		assert.equal(isManagementPath(path), false, path);
	}
});

test("a configuration error is published with its real reason", () => {
	const raw = new GatewayError({
		class: "bad_request",
		message: 'Adapter "nosuch" is not registered',
		param: "adapterKey",
	});
	assert.equal(raw.publicMessage, "The request is invalid.");

	const shown = publicizeManagementError(raw);
	assert.equal(shown.publicMessage, 'Adapter "nosuch" is not registered');
	assert.equal(shown.class, "bad_request");
	assert.equal(shown.param, "adapterKey");
	assert.equal(shown.httpStatus, raw.httpStatus);
});

test("classes that can carry internal detail keep the generic message", () => {
	for (const cls of ["server", "timeout", "rate_limit"] as const) {
		const raw = new GatewayError({
			class: cls,
			message: "upstream said something we should not repeat",
		});
		const shown = publicizeManagementError(raw);
		assert.equal(shown.publicMessage, raw.publicMessage);
		assert.notEqual(shown.publicMessage, raw.message);
	}
});

test("an explicit public message is left exactly as the thrower wrote it", () => {
	const raw = new GatewayError({
		class: "permission",
		message: "internal detail",
		publicMessage: "internal detail",
	});
	assert.equal(publicizeManagementError(raw), raw);
});
