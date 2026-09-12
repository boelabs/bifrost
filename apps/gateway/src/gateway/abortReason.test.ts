import { abortGatewayError, isClientAbortSignal } from "./abortReason.ts";
import { describe, test } from "node:test";
import assert from "node:assert/strict";

describe("typed gateway abort reasons", () => {
	test("classifies an explicit client cancellation", () => {
		const controller = new AbortController();
		controller.abort({ owner: "client", type: "cancelled" });

		assert.equal(isClientAbortSignal(controller.signal), true);
		assert.equal(
			abortGatewayError(controller.signal).code,
			"client_closed_request",
		);
	});

	test("keeps downstream backpressure distinct from a client disconnect", () => {
		const controller = new AbortController();
		controller.abort({
			owner: "gateway",
			type: "downstream_backpressure",
			phase: "rendering",
		});

		assert.equal(isClientAbortSignal(controller.signal), false);
		const error = abortGatewayError(controller.signal);
		assert.equal(error.code, "downstream_backpressure");
		assert.equal(error.failureKind, "gateway");
		assert.equal(error.deploymentHealth, "neutral");
		assert.equal(error.routingScope, "request");
		assert.equal(error.retryable, false);
	});

	test("preserves compatibility for untyped request abort signals", () => {
		const controller = new AbortController();
		controller.abort();

		assert.equal(isClientAbortSignal(controller.signal), true);
	});
});
