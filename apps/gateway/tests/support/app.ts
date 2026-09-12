import type { ContentfulStatusCode } from "hono/utils/http-status";
import { requestContextMiddleware } from "#http/requestContext.ts";
import { authMiddleware } from "#auth/middleware.ts";
import { GatewayError } from "#core/errors.ts";
import type { AppEnv } from "#auth/types.ts";
import { Hono } from "hono";

function installOpenAIErrorHandler(app: Hono<AppEnv>): void {
	app.onError((err, c) => {
		if (GatewayError.is(err)) {
			for (const [name, value] of Object.entries(err.headers ?? {})) {
				c.header(name, value);
			}
			return c.json(err.toOpenAI(), err.httpStatus as ContentfulStatusCode);
		}
		return c.json(
			{
				error: {
					message: "Internal server error",
					type: "server_error",
					param: null,
					code: null,
				},
			},
			500,
		);
	});
}

/** Base mini-app for integration tests: request-id + OpenAI-compatible error. */
export function makeGatewayTestApp(
	mountRoutes: (app: Hono<AppEnv>) => void,
): Hono<AppEnv> {
	const app = new Hono<AppEnv>();
	app.use("*", requestContextMiddleware());
	installOpenAIErrorHandler(app);
	mountRoutes(app);
	return app;
}

/**
 * Mini-app for `/v1/*` endpoint integration tests.
 *
 * Replicates the common pieces of the real server that matter for the public contract:
 * request-id, OpenAI-compatible error, and auth. The test mounts only the routes it wants to
 * exercise, avoiding the real server or background jobs.
 */
export function makeOpenAIContractTestApp(
	mountRoutes: (app: Hono<AppEnv>) => void,
): Hono<AppEnv> {
	return makeGatewayTestApp((app) => {
		app.use("/v1/*", authMiddleware());
		mountRoutes(app);
	});
}

/** Mini-app for the OpenRouter-shaped `/v1/rerank` error contract. */
export function makeOpenRouterContractTestApp(
	mountRoutes: (app: Hono<AppEnv>) => void,
): Hono<AppEnv> {
	const app = new Hono<AppEnv>();
	app.use("*", requestContextMiddleware());
	app.onError((err, c) =>
		GatewayError.is(err)
			? c.json(err.toOpenRouter(), err.httpStatus as ContentfulStatusCode)
			: c.json({ error: { code: 500, message: "Internal server error" } }, 500),
	);
	app.use("/v1/*", authMiddleware());
	mountRoutes(app);
	return app;
}
