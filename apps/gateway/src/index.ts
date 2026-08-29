import { type WebSocketServerLike, serve } from "@hono/node-server";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { GatewayError } from "./core/errors.ts";
import { pingRedis } from "./cache/redis.ts";
import { Hono, type Context } from "hono";
import { pingDb } from "./db/client.ts";
import { log } from "./logging/log.ts";
import { env } from "./config/env.ts";
import { WebSocketServer } from "ws";

import {
	DEPENDENCY_RETRY_AFTER_SECONDS,
	dependencyUnavailable,
	isDependencyError,
} from "./core/dependencyError.ts";

import "./adapters/index.ts"; // registers the adapters (side-effect)

import { messagesCountTokensHandler } from "./endpoints/messagesCountTokens.ts";
import { startResponseStateGcJob } from "./db/repos/responseStates.ts";
import { requestContextMiddleware } from "./http/requestContext.ts";
import { usesAnthropicErrorDialect } from "./http/errorDialect.ts";
import { installGracefulShutdown } from "./runtime/shutdown.ts";
import { embeddingsHandler } from "./endpoints/embeddings.ts";
import { chatCompletionsHandler } from "./endpoints/chat.ts";
import { transcriptionsHandler } from "./endpoints/audio.ts";
import { messagesHandler } from "./endpoints/messages.ts";
import { getRequestId } from "./http/requestContext.ts";
import { rerankHandler } from "./endpoints/rerank.ts";
import { authMiddleware } from "./auth/middleware.ts";
import { startTelemetry } from "./telemetry/index.ts";
import { startVideoJobs } from "./videos/jobs.ts";
import type { AppEnv } from "./auth/types.ts";
import { adminApp } from "./admin/index.ts";

import {
	listResponseInputItemsHandler,
	responsesWebSocketHandler,
	closeResponsesWebSockets,
	retrieveResponseHandler,
	compactResponseHandler,
	deleteResponseHandler,
	responsesHandler,
} from "./endpoints/responses.ts";

import {
	videoRetrieveHandler,
	videoContentHandler,
	videoDeleteHandler,
	videoCreateHandler,
	videoListHandler,
} from "./endpoints/videos.ts";

import {
	startExtensionReloadJob,
	initializeExtensions,
	extensionStatus,
} from "./extensions/runtime.ts";

import {
	operationPersistenceStatus,
	startOperationMaintenance,
} from "./logging/operations.ts";

import {
	imageGenerationsHandler,
	imageEditsHandler,
} from "./endpoints/images.ts";

import {
	modelsWildcardHandler,
	listModelsHandler,
} from "./endpoints/models.ts";

startTelemetry();
try {
	await initializeExtensions();
} catch (err) {
	// Never let an extension problem brick the gateway: misconfigured artifacts/instances are already
	// disabled in-runtime (and surfaced via readiness), so the only way here is a transient failure such
	// as the database being unreachable at boot. Log and continue — the reload job retries on its
	// interval and /health/ready stays degraded until it succeeds.
	log.error(
		"extensions",
		"initial extension load failed; continuing, will retry on the reload interval",
		{ err },
	);
}

const app = new Hono<AppEnv>();
const stopOperationMaintenance = startOperationMaintenance();
const stopResponseStateGc = startResponseStateGcJob();
const stopExtensionReload = startExtensionReloadJob();
const stopVideoJobs = startVideoJobs();

app.use("*", requestContextMiddleware());
app.use("*", async (c, next) => {
	const startedAt = Date.now();
	try {
		await next();
	} finally {
		log.info("http", "request completed", {
			requestId: getRequestId(c),
			operationId: c.get("operationId"),
			method: c.req.method,
			path: c.req.path,
			status: c.res.status,
			durationMs: Date.now() - startedAt,
		});
	}
});

// Global error handler: translates GatewayError to the shape of each public contract.
// /v1/messages/* -> Anthropic shape; everything else -> OpenAI shape.
app.onError((err, c) => {
	const isAnthropic = usesAnthropicErrorDialect(c.req.path);
	const isOpenRouterRerank = c.req.path === "/v1/rerank";
	// A reachable-dependency failure (Postgres/Redis down) becomes a 503 + Retry-After so clients back
	// off and retry, instead of the opaque 500 a raw driver error would otherwise produce.
	const gatewayError = GatewayError.is(err)
		? err
		: isDependencyError(err)
			? dependencyUnavailable(err)
			: null;
	if (gatewayError) {
		if (!GatewayError.is(err))
			log.error("http", "dependency unavailable", { err });
		for (const [name, value] of Object.entries(gatewayError.headers ?? {})) {
			c.header(name, value);
		}
		const body = isAnthropic
			? gatewayError.toAnthropic()
			: isOpenRouterRerank
				? gatewayError.toOpenRouter()
				: gatewayError.toOpenAI();
		return c.json(body, gatewayError.httpStatus as ContentfulStatusCode);
	}
	log.error("http", "unhandled error", { err });
	if (isAnthropic) {
		return c.json(
			{
				type: "error",
				error: { type: "api_error", message: "Internal server error" },
			},
			500,
		);
	}
	if (isOpenRouterRerank) {
		return c.json(
			{ error: { code: 500, message: "Internal server error" } },
			500,
		);
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

/**
 * LIVENESS. "Is this process responsive?" — answered WITHOUT touching Postgres or Redis. Wire this to
 * an orchestrator's liveness probe. It must not depend on external services: if it did, a dependency
 * blip would make the orchestrator kill every replica at once (a restart that cannot fix the
 * dependency), turning a transient outage into a self-inflicted one.
 */
app.get("/health/live", (c) =>
	c.json({
		status: "ok",
		service: "Bifrost",
		uptimeSeconds: Math.round(process.uptime()),
		time: new Date().toISOString(),
	}),
);

/**
 * READINESS. "Should this instance receive traffic right now?" — checks Postgres, Redis and the
 * extension runtime. Returns 503 + Retry-After when a dependency is down so the load balancer pulls
 * the instance out (WITHOUT restarting it); it rejoins automatically once dependencies recover. Wire
 * this to the readiness probe.
 */
async function readiness(c: Context) {
	const [database, cache] = await Promise.all([pingDb(), pingRedis()]);
	const extensions = extensionStatus();
	const observability = operationPersistenceStatus();
	const ok = database && cache && extensions.healthy && observability.healthy;
	if (!ok) c.header("retry-after", String(DEPENDENCY_RETRY_AFTER_SECONDS));
	return c.json(
		{
			status: ok ? "ok" : "degraded",
			service: "Bifrost",
			dependencies: { database, cache },
			observability,
			extensions: {
				status: extensions.status,
				healthy: extensions.healthy,
				definitions: extensions.definitions.length,
				instances: {
					total: extensions.instances.length,
					active: extensions.instances.filter(
						(instance) => instance.status === "active",
					).length,
					disabled: extensions.instances.filter(
						(instance) => instance.status !== "active",
					).length,
				},
			},
			time: new Date().toISOString(),
		},
		ok ? 200 : 503,
	);
}

app.get("/health/ready", readiness);

// Public model discovery. Intentionally unauthenticated, like public provider model catalogs.
app.get("/v1/models", listModelsHandler);
app.get("/v1/models/*", modelsWildcardHandler);

// Admin (CRUD of models and keys) - requires the master key (middleware inside adminApp).
app.route("/admin", adminApp);

// Public API - requires a master or virtual key.
app.use("/v1/*", authMiddleware());
app.post("/v1/chat/completions", chatCompletionsHandler);
app.post("/v1/responses", responsesHandler);
app.get("/v1/responses", responsesWebSocketHandler);
app.post("/v1/responses/compact", compactResponseHandler);
app.get("/v1/responses/:id", retrieveResponseHandler);
app.delete("/v1/responses/:id", deleteResponseHandler);
app.get("/v1/responses/:id/input_items", listResponseInputItemsHandler);
app.post("/v1/messages", messagesHandler);
app.post("/v1/messages/count_tokens", messagesCountTokensHandler);
app.post("/v1/images/generations", imageGenerationsHandler);
app.post("/v1/images/edits", imageEditsHandler);
app.post("/v1/videos", videoCreateHandler);
app.get("/v1/videos", videoListHandler);
app.get("/v1/videos/:id/content", videoContentHandler);
app.get("/v1/videos/:id", videoRetrieveHandler);
app.delete("/v1/videos/:id", videoDeleteHandler);
app.post("/v1/audio/transcriptions", transcriptionsHandler);
app.post("/v1/embeddings", embeddingsHandler);
app.post("/v1/rerank", rerankHandler);

const webSocketServer = new WebSocketServer({
	noServer: true,
	maxPayload: 16 * 1024 * 1024,
	perMessageDeflate: false,
});
const server = serve(
	{
		fetch: app.fetch,
		port: env.PORT,
		websocket: { server: webSocketServer as WebSocketServerLike },
	},
	(info) => {
		log.info("server", "listening", { port: info.port, env: env.NODE_ENV });
	},
);

installGracefulShutdown({
	server,
	stopJobs: [
		closeResponsesWebSockets,
		stopOperationMaintenance,
		stopResponseStateGc,
		stopExtensionReload,
		stopVideoJobs,
	],
});
