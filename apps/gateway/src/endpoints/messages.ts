import { messagesRequestSchema } from "#contracts/anthropic/messages.ts";
import { candidateMetadata } from "#gateway/candidateMetadata.ts";
import { hasContentInputs } from "#files/requestContentInputs.ts";
import type { CanonicalChatRequest } from "#core/canonical.ts";
import { OperationLogDraft } from "./runtime/operationLog.ts";
import type { EffectiveSettings } from "#router/settings.ts";
import { RouteLifecycle } from "./runtime/routeLifecycle.ts";
import { getEffectiveSettings } from "#router/settings.ts";
import type { ChatExecResult } from "#gateway/executor.ts";
import { reasoningLogInfo } from "#core/reasoning.ts";
import { tapFirstToken } from "#gateway/ttft.ts";
import { GatewayError } from "#core/errors.ts";
import type { AppEnv } from "#auth/types.ts";
import type { Usage } from "#core/usage.ts";
import { streamSSE } from "hono/streaming";
import type { Context } from "hono";

import {
	applyCanonicalResponseExtensions,
	applyCanonicalRequestExtensions,
	applyStreamEventExtensions,
	PUBLIC_JSON_BODY_MAX_BYTES,
	assertFinalModelAllowed,
	notifyExtensionError,
	openResponseCache,
	computeUsageCost,
	toGatewayError,
	readJsonBody,
	parseBody,
	preflight,
} from "./runtime/pipeline.ts";

import {
	finishDownstreamWriteObservation,
	markDownstreamSemanticWritten,
	markDownstreamTerminalWritten,
	newDownstreamWriteObservation,
	markDownstreamClientAborted,
	awaitWithSSEHeartbeats,
	withSSEHeartbeats,
	writeSSEHeartbeat,
	writeSSE,
} from "./runtime/sse.ts";

import {
	canonicalChunksToMessagesEvents,
	canonicalToMessagesResponse,
	messagesRequestToCanonical,
	type MessagesRenderOptions,
} from "#contracts/anthropic/messagesRender.ts";

import {
	contentInputResolutionLogMetadata,
	parameterPolicyLogMetadata,
	routeChat,
} from "./runtime/parameterPolicy.ts";

import {
	routingMetadataRequested,
	publicRoutingMetadata,
	attachRoutingMetadata,
} from "./runtime/routingMetadata.ts";

function streamMessages(
	c: Context<AppEnv>,
	canonical: CanonicalChatRequest,
	settings: EffectiveSettings,
	log: OperationLogDraft,
): Response {
	return streamSSE(c, async (stream) => {
		const downstream = newDownstreamWriteObservation(log.operationId);
		stream.onAbort(() => {
			markDownstreamClientAborted(downstream);
			log.abortClient();
		});
		let routed: Awaited<ReturnType<typeof routeChat>> | null = null;
		let usage: Usage | null = null;
		let firstTokenAt: number | null = null;
		let lastChunkAt: number | null = null;
		let streamError: GatewayError | null = null;
		let metadata: Record<string, unknown> = { downstream };
		try {
			await writeSSEHeartbeat(stream, downstream);
			const routePromise = routeChat(c, canonical, log.requestId, settings, {
				signal: log.clientSignal,
				operationId: log.operationId,
			});
			routed = await awaitWithSSEHeartbeats(routePromise, () =>
				writeSSEHeartbeat(stream, downstream),
			);
			const { routing, parameterPolicy, contentInputResolution } = routed;
			log.applyRouting(routing);
			if (routing.value.kind !== "stream")
				throw new GatewayError({
					class: "server",
					message: "Streaming Messages unexpectedly returned JSON",
				});
			const upstreamStartedAt = routing.upstreamStartedAt;
			const meta = routing.candidate.meta;
			const renderOpts: MessagesRenderOptions = {
				publicModel: routing.candidate.row.publicModel,
			};
			metadata = {
				...candidateMetadata(routing.candidate),
				streamLifecycle: routing.value.observation,
				downstream,
			};
			const reasoning = reasoningLogInfo(
				canonical.reasoning,
				meta.capabilities.reasoning ? meta.reasoning : undefined,
			);
			if (reasoning) metadata.reasoning = reasoning;
			const parameterMetadata = parameterPolicyLogMetadata(
				parameterPolicy,
				settings.unsupportedParameterStrategy,
			);
			if (parameterMetadata) metadata.parameterPolicy = parameterMetadata;
			const contentInputMetadata = contentInputResolutionLogMetadata(
				contentInputResolution,
			);
			if (contentInputMetadata) metadata.contentInputs = contentInputMetadata;
			const routingMetadata = routingMetadataRequested(c)
				? publicRoutingMetadata(routing, settings)
				: null;
			const tapped = tapFirstToken(
				routing.value.chunks,
				(at) => {
					firstTokenAt = at;
				},
				(at) => {
					lastChunkAt = at;
				},
			);
			async function* transformedChunks() {
				for await (const chunk of tapped) {
					log.progress();
					const transformed = await applyStreamEventExtensions(
						c,
						"chat",
						canonical.model,
						chunk,
					);
					if (transformed.usage) usage = transformed.usage;
					yield transformed;
				}
			}
			const events = canonicalChunksToMessagesEvents(
				transformedChunks(),
				renderOpts,
			);
			for await (const ev of withSSEHeartbeats(events, () =>
				writeSSEHeartbeat(stream, downstream),
			)) {
				await writeSSE(stream, { event: ev.event!, data: ev.data }, downstream);
				if (
					ev.event === "content_block_start" ||
					ev.event === "content_block_delta"
				)
					markDownstreamSemanticWritten(downstream);
				if (ev.event === "message_stop")
					markDownstreamTerminalWritten(downstream);
			}
			if (routingMetadata)
				await writeSSE(
					stream,
					{
						event: "routing_metadata",
						data: JSON.stringify({
							type: "routing_metadata",
							unified_routing: routingMetadata,
						}),
					},
					downstream,
				);
			if (firstTokenAt !== null)
				log.upstreamTtftMs = firstTokenAt - upstreamStartedAt;
		} catch (error) {
			streamError = toGatewayError(error);
			log.applyFailedAttempts(streamError.attempts);
			if (streamError.code === "downstream_backpressure") log.abortUpstream();
			await notifyExtensionError(c, "chat", canonical.model, streamError);
			if (
				streamError.code !== "downstream_backpressure" &&
				!log.clientSignal.aborted
			)
				try {
					await writeSSE(
						stream,
						{
							event: "error",
							data: JSON.stringify(streamError.toAnthropic()),
						},
						downstream,
					);
					markDownstreamTerminalWritten(downstream);
				} catch {
					// The original stream failure remains authoritative.
				}
		} finally {
			if (routed)
				await routed.routing.finish(
					usage,
					lastChunkAt ?? undefined,
					streamError,
					undefined,
					downstream,
				);
			else finishDownstreamWriteObservation(downstream, streamError?.code);
			const cost = routed
				? computeUsageCost(routed.routing.candidate.meta, usage)
				: null;
			log.write({
				status: streamError ? "error" : "success",
				httpStatus:
					downstream.clientAbortAt !== null ||
					streamError?.code === "client_closed_request"
						? 499
						: 200,
				usage,
				cost,
				ttftMs: firstTokenAt !== null ? firstTokenAt - log.startedAt : null,
				responseBody: { streamed: true },
				metadata,
				error: streamError ? streamError.toLog() : null,
			});
		}
	});
}

/**
 * POST /v1/messages - Anthropic Messages API, provider-agnostic. Translates the request to canonical,
 * routes to an adapter with a `chat` handler, and renders the result to the Anthropic format. Errors
 * are returned with the Anthropic shape (onError decides based on the path).
 */
export async function messagesHandler(c: Context<AppEnv>): Promise<Response> {
	const log = new OperationLogDraft(c, "messages");
	const lifecycle = new RouteLifecycle<ChatExecResult>();

	try {
		const json = await readJsonBody(c, PUBLIC_JSON_BODY_MAX_BYTES);
		log.requestBody = json;
		const req = parseBody(messagesRequestSchema, json);
		log.publicModel = req.model;
		let canonical = messagesRequestToCanonical(req);
		await preflight(c, canonical.model);
		canonical = await applyCanonicalRequestExtensions(c, "chat", canonical);
		log.publicModel = canonical.model;
		assertFinalModelAllowed(c, canonical.model);

		// Isolated per virtual key (no leak between tenants); the MASTER never caches.
		const cache = await openResponseCache({
			c,
			draft: log,
			namespace: "messages",
			payload: canonical as unknown as Record<string, unknown>,
			eligible:
				!canonical.stream &&
				!canonical.tools?.length &&
				!hasContentInputs(canonical),
		});
		if (cache.hit) return c.json(cache.body as object);

		const settings = await getEffectiveSettings();
		if (canonical.stream) return streamMessages(c, canonical, settings, log);
		const { routing, parameterPolicy, contentInputResolution } =
			await routeChat(c, canonical, log.requestId, settings, {
				signal: log.clientSignal,
				operationId: log.operationId,
			});
		log.applyRouting(routing);
		lifecycle.attach(routing);
		if (routing.value.kind === "json")
			lifecycle.rememberUsage(routing.value.response.usage);
		const upstreamStartedAt = routing.upstreamStartedAt;
		const meta = routing.candidate.meta;
		const renderOpts: MessagesRenderOptions = {
			publicModel: routing.candidate.row.publicModel,
		};
		const metadata: Record<string, unknown> = {
			...candidateMetadata(routing.candidate),
			...(routing.value.kind === "stream"
				? { streamLifecycle: routing.value.observation }
				: { terminal: routing.value.terminal }),
		};
		const reasoning = reasoningLogInfo(
			canonical.reasoning,
			meta.capabilities.reasoning ? meta.reasoning : undefined,
		);
		if (reasoning) metadata.reasoning = reasoning;
		const parameterMetadata = parameterPolicyLogMetadata(
			parameterPolicy,
			settings.unsupportedParameterStrategy,
		);
		if (parameterMetadata) metadata.parameterPolicy = parameterMetadata;
		const contentInputMetadata = contentInputResolutionLogMetadata(
			contentInputResolution,
		);
		if (contentInputMetadata) metadata.contentInputs = contentInputMetadata;
		const routingMetadata = routingMetadataRequested(c)
			? publicRoutingMetadata(routing, settings)
			: null;

		if (routing.value.kind === "json") {
			// no-stream: the response arrives complete -> the "first token" is the whole response.
			log.upstreamTtftMs = Date.now() - upstreamStartedAt;
			const response = await applyCanonicalResponseExtensions(
				c,
				"chat",
				canonical.model,
				routing.value.response,
			);
			const usage = response.usage;
			await lifecycle.finish(usage);
			const cost = computeUsageCost(meta, usage);
			const rendered = canonicalToMessagesResponse(response, renderOpts);
			cache.store(rendered, usage);
			const body = attachRoutingMetadata(
				rendered as Record<string, unknown>,
				routingMetadata,
			);
			log.write({
				status: "success",
				httpStatus: 200,
				usage,
				cost,
				ttftMs: log.elapsedMs(),
				responseBody: rendered,
				metadata,
				error: null,
			});
			return c.json(body);
		}

		throw new GatewayError({
			class: "server",
			message: "Non-streaming Messages unexpectedly returned a stream",
		});
	} catch (err) {
		const ge = toGatewayError(err);
		log.applyFailedAttempts(ge.attempts);
		await lifecycle.finish(null, ge);
		await notifyExtensionError(c, "chat", log.publicModel, ge);
		log.writeError(ge);
		throw err; // onError formats it in the Anthropic shape (based on the path)
	}
}
