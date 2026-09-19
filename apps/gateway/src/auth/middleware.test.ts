import type { ContentfulStatusCode } from "hono/utils/http-status";
import { GatewayError } from "#core/errors.ts";
import type { AppEnv } from "./types.ts";
import assert from "node:assert/strict";
import { env } from "#config/env.ts";
import { test } from "node:test";
import { Hono } from "hono";

import {
	requirePermission,
	requireOperator,
	authMiddleware,
	getAuth,
} from "./middleware.ts";

function app(): Hono<AppEnv> {
	const instance = new Hono<AppEnv>();
	instance.onError((error, c) => {
		if (GatewayError.is(error)) {
			return c.text(
				error.code ?? error.class,
				error.httpStatus as ContentfulStatusCode,
			);
		}
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

test("a virtual key never satisfies an operator-only route", async () => {
	const instance = new Hono<AppEnv>();
	instance.onError((error, c) => {
		if (GatewayError.is(error)) {
			return c.text(
				error.code ?? error.class,
				error.httpStatus as ContentfulStatusCode,
			);
		}
		throw error;
	});
	instance.use("*", async (c, next) => {
		c.set("auth", {
			type: "virtual",
			key: {
				id: "00000000-0000-0000-0000-000000000000",
				name: "test",
				allowedModels: [],
				enabled: true,
				expiresAt: null,
				maxBudgetCents: null,
				budgetReset: null,
				budgetResetAt: null,
				spendCents: 0,
				tpm: null,
				rpm: null,
			},
		});
		return next();
	});
	instance.use("*", requireOperator());
	instance.get("/", (c) => c.text("reached"));

	const response = await instance.request("http://gateway.test/");
	assert.equal(response.status, 403);
});

test("permissions follow the session role, and the master key satisfies all of them", async () => {
	function withRole(
		role: "owner" | "admin" | "viewer",
		permission: Parameters<typeof requirePermission>[0],
	) {
		const instance = new Hono<AppEnv>();
		instance.onError((error, c) => {
			if (GatewayError.is(error)) {
				return c.text(
					error.code ?? error.class,
					error.httpStatus as ContentfulStatusCode,
				);
			}
			throw error;
		});
		instance.use("*", async (c, next) => {
			c.set("auth", {
				type: "session",
				session: { sessionId: "s", userId: "u", role, isRoot: false },
			});
			return next();
		});
		instance.use("*", requirePermission(permission));
		instance.get("/", (c) => c.text("reached"));
		return instance;
	}

	assert.equal(
		(
			await withRole("viewer", "deployments:read").request(
				"http://gateway.test/",
			)
		).status,
		200,
	);
	assert.equal(
		(
			await withRole("viewer", "deployments:write").request(
				"http://gateway.test/",
			)
		).status,
		403,
	);
	assert.equal(
		(
			await withRole("admin", "extensions:manage").request(
				"http://gateway.test/",
			)
		).status,
		403,
	);
	assert.equal(
		(
			await withRole("owner", "extensions:manage").request(
				"http://gateway.test/",
			)
		).status,
		200,
	);

	const masterApp = new Hono<AppEnv>();
	masterApp.use("*", authMiddleware(), requirePermission("users:manage"));
	masterApp.get("/", (c) => c.text("reached"));
	const response = await masterApp.request("http://gateway.test/", {
		headers: { "x-api-key": env.MASTER_KEY },
	});
	assert.equal(response.status, 200);
});
