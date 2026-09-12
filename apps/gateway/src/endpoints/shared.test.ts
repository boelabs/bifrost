import { resolveClientIp } from "./shared.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

test("client IP ignores forwarded headers when no proxy is trusted", () => {
	assert.equal(
		resolveClientIp("203.0.113.10", "198.51.100.2", 0),
		"203.0.113.10",
	);
});

test("client IP walks the configured trusted proxy hops from the right", () => {
	assert.equal(
		resolveClientIp("203.0.113.10", "192.0.2.1, 198.51.100.2", 2),
		"192.0.2.1",
	);
});

test("client IP rejects a malformed forwarded chain", () => {
	assert.equal(
		resolveClientIp("203.0.113.10", "attacker, 198.51.100.2", 1),
		"203.0.113.10",
	);
});
