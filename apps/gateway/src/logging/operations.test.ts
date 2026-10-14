import { failureOwner } from "./operations.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

const attempt = (over: Record<string, unknown>) =>
	({ ok: false, ...over }) as Parameters<typeof failureOwner>[0];

test("failure owner: a deadline the gateway imposed is not the provider's failure", () => {
	// No provider status: the upstream never answered, the gateway stopped waiting.
	assert.equal(
		failureOwner(
			attempt({
				errorClass: "timeout",
				errorCode: "upstream_response_timeout",
			}),
		),
		"gateway_deadline",
	);
	assert.equal(
		failureOwner(
			attempt({ errorClass: "timeout", errorCode: "upstream_idle_timeout" }),
		),
		"gateway_deadline",
	);
});

test("failure owner: a narrowed deadline keeps the precise label, not the general one", () => {
	// The router reports these as health-neutral, which the `gateway` branch also matches; the
	// deadline is the more specific fact and the one an operator needs.
	assert.equal(
		failureOwner(
			attempt({
				errorClass: "timeout",
				errorCode: "upstream_response_timeout",
				deploymentHealth: "neutral",
			}),
		),
		"gateway_deadline",
	);
});

test("failure owner: a timeout the upstream itself reported stays the provider's", () => {
	assert.equal(
		failureOwner(
			attempt({
				errorClass: "timeout",
				errorCode: "upstream_gateway_timeout",
				providerStatus: 504,
			}),
		),
		"provider",
	);
});

test("failure owner: the existing verdicts are unchanged", () => {
	assert.equal(failureOwner(attempt({ ok: true })), null);
	assert.equal(
		failureOwner(attempt({ errorCode: "client_closed_request" })),
		"client",
	);
	assert.equal(
		failureOwner(attempt({ errorCode: "downstream_backpressure" })),
		"client",
	);
	assert.equal(failureOwner(attempt({ failureKind: "gateway" })), "gateway");
	assert.equal(
		failureOwner(attempt({ deploymentHealth: "neutral" })),
		"gateway",
	);
	assert.equal(
		failureOwner(attempt({ failureKind: "configuration" })),
		"deployment_config",
	);
	assert.equal(
		failureOwner(attempt({ errorClass: "auth", providerStatus: 401 })),
		"provider",
	);
});

test("failure owner: a request the upstream rejected is the caller's", () => {
	assert.equal(
		failureOwner(
			attempt({
				errorClass: "bad_request",
				failureKind: "request",
				providerStatus: 400,
				deploymentHealth: "neutral",
			}),
		),
		"client",
	);
	// Rejected by the gateway before any upstream answered: not the caller's alone to fix.
	assert.equal(
		failureOwner(
			attempt({
				errorClass: "bad_request",
				failureKind: "request",
				deploymentHealth: "neutral",
			}),
		),
		"gateway",
	);
});
