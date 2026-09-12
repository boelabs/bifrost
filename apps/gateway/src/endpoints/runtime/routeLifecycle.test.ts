import { RouteLifecycle } from "./routeLifecycle.ts";
import type { RouteResult } from "#router/index.ts";
import { GatewayError } from "#core/errors.ts";
import type { Usage } from "#core/usage.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

function route(finish: RouteResult<unknown>["finish"]): RouteResult<unknown> {
	return { finish } as RouteResult<unknown>;
}

test("route lifecycle settles its route exactly once", async () => {
	const calls: Array<{ error: GatewayError | null | undefined }> = [];
	const lifecycle = new RouteLifecycle<unknown>();
	lifecycle.attach(
		route(async (_usage, _finishedAt, error) => {
			calls.push({ error });
		}),
	);
	const failure = new GatewayError({
		class: "server",
		message: "render failed",
	});
	await lifecycle.finish(null, failure);
	await lifecycle.finish(null);
	assert.deepEqual(calls, [{ error: failure }]);
});

test("route lifecycle is a no-op before a route is attached", async () => {
	await new RouteLifecycle<unknown>().finish(null);
});

test("route lifecycle retains usage across gateway post-processing failures", async () => {
	const calls: Array<Usage | null> = [];
	const lifecycle = new RouteLifecycle<unknown>();
	lifecycle.attach(
		route(async (usage) => {
			calls.push(usage);
		}),
	);
	const usage = { promptTokens: 2, completionTokens: 3, totalTokens: 5 };
	lifecycle.rememberUsage(usage);
	await lifecycle.finish(
		null,
		new GatewayError({
			class: "server",
			message: "render failed",
			failureKind: "gateway",
		}),
	);
	assert.deepEqual(calls, [usage]);
});
