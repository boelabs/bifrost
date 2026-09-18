import assert from "node:assert/strict";
import { test } from "node:test";

import { failureOwner } from "./operations.ts";

const attempt = (over: Record<string, unknown>) =>
	({ ok: false, ...over }) as Parameters<typeof failureOwner>[0];

test("failure owner: a deadline the gateway imposed is not the provider's failure", () => {
	// No provider status: the upstream never answered, the gateway stopped waiting.
	assert.equal(
		failureOwner(
			attempt({
				errorClass: "timeout",
				errorCode: "upstream_first_output_timeout",
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
