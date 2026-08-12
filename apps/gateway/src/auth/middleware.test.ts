import type { ContentfulStatusCode } from "hono/utils/http-status";
import { authMiddleware, getAuth } from "./middleware.ts";
import { GatewayError } from "#core/errors.ts";
import type { AppEnv } from "./types.ts";
import assert from "node:assert/strict";
import { env } from "#config/env.ts";
import { test } from "node:test";
import { Hono } from "hono";

function app(): Hono<AppEnv> {
	const instance = new Hono<AppEnv>();
	instance.onError((error, c) => {
		if (GatewayError.is(error))
			return c.text(
				error.code ?? error.class,
				error.httpStatus as ContentfulStatusCode,
			);
		throw error;
	});
	instance.use("*", authMiddleware());
	instance.get("/", (c) => c.json({ type: getAuth(c).type }));
	return instance;
}

test("authentication ignores API keys in the query string", async () => {
	const response = await app().request(
		`http://gateway.test/?api_key=${encodeURIComponent(env.MASTER_KEY)}`,
	);
	assert.equal(response.status, 401);
	assert.equal(await response.text(), "auth");
});

test("authentication accepts header credentials", async () => {
	const response = await app().request("http://gateway.test/", {
		headers: { "x-api-key": env.MASTER_KEY },
	});
	assert.equal(response.status, 200);
	assert.deepEqual(await response.json(), { type: "master" });
});
