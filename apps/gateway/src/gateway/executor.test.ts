import type { AdapterContext } from "#adapters/types.ts";
import { beforeFirstOutput } from "./executor.ts";
import { GatewayError } from "#core/errors.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

const policy = {
	idleMs: null,
	reasoningOnlyMs: null,
	preCommitMs: 1000,
	totalMs: 1000,
	maxAttempts: 2,
};

function context(over: Record<string, unknown>): AdapterContext {
	return {
		upstreamModel: "m",
		credentials: {},
		transport: "responses",
		requestId: "r",
		attemptStartedAt: Date.now(),
		...over,
	} as AdapterContext;
}

const never = () =>
	new Promise<never>(() => {
		/* intentionally empty */
	});

test("a first-output deadline the operator set is the deployment's to miss", async () => {
	const ctx = context({
		executionPolicy: { ...policy, firstOutputMs: 5 },
	});
	await assert.rejects(beforeFirstOutput(never(), ctx), (error: unknown) => {
		assert.equal(GatewayError.is(error), true);
		assert.equal((error as GatewayError).code, "upstream_first_output_timeout");
		assert.equal((error as GatewayError).deploymentHealth, "penalize");
		return true;
	});
});

test("a first-output deadline the router narrowed is not", async () => {
	const ctx = context({
		executionPolicy: { ...policy, firstOutputMs: 5, firstOutputNarrowed: true },
	});
	await assert.rejects(beforeFirstOutput(never(), ctx), (error: unknown) => {
		assert.equal((error as GatewayError).code, "upstream_first_output_timeout");
		assert.equal((error as GatewayError).deploymentHealth, "neutral");
		return true;
	});
});

test("an already-exhausted narrowed deadline is neutral too", async () => {
	// The pre-flight branch raises before any promise is raced; it must agree with the timer.
	const ctx = context({
		attemptStartedAt: Date.now() - 1000,
		executionPolicy: { ...policy, firstOutputMs: 5, firstOutputNarrowed: true },
	});
	await assert.rejects(beforeFirstOutput(never(), ctx), (error: unknown) => {
		assert.equal((error as GatewayError).deploymentHealth, "neutral");
		return true;
	});
});
