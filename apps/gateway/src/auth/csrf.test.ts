import { GatewayError } from "#core/errors.ts";
import { assertCsrfToken } from "./csrf.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

function rejects(
	method: string,
	cookie: string | undefined,
	header: string | undefined,
): void {
	assert.throws(
		() => assertCsrfToken(method, cookie, header),
		(error: unknown) =>
			GatewayError.is(error) && error.code === "csrf_token_invalid",
	);
}

test("CSRF is not required for methods that cannot change state", () => {
	for (const method of ["GET", "HEAD", "OPTIONS", "get", "options"]) {
		assertCsrfToken(method, undefined, undefined);
	}
});

test("CSRF accepts a matching cookie and header pair", () => {
	assertCsrfToken("POST", "token-value", "token-value");
	assertCsrfToken("DELETE", "token-value", "token-value");
});

test("CSRF rejects a mutating request with no token at all", () => {
	rejects("POST", undefined, undefined);
	rejects("PATCH", undefined, undefined);
	rejects("DELETE", undefined, undefined);
});

test("CSRF rejects a half-submitted token", () => {
	rejects("POST", "token-value", undefined);
	rejects("POST", undefined, "token-value");
});

test("CSRF rejects a mismatched pair, including a prefix of the real token", () => {
	rejects("POST", "token-value", "other-value");
	rejects("POST", "token-value", "token-valu");
	rejects("POST", "token-value", "");
});
