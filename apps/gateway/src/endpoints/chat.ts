import { candidateMetadata } from "#gateway/candidateMetadata.ts";
import { hasContentInputs } from "#files/requestContentInputs.ts";
import { chatChunkSemantic } from "#gateway/streamLifecycle.ts";
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
	toCanonicalChatRequest,
	toOpenAIChatResponse,
	chatRequestSchema,
	toOpenAIChatChunk,
} from "#contracts/openai/chat.ts";

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

function streamChatCompletion(
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
		let finalUsage: Usage | null = null;
		let firstTokenAt: number | null = null;
		let lastChunkAt: number | null = null;
		let content = "";
		let streamError: GatewayError | null = null;
		let metadata: Record<string, unknown> = { downstream };
		try {
			// Force headers onto the wire before upstream routing can stall.
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
					message: "Streaming chat unexpectedly returned JSON",
				});
			const upstreamStartedAt = routing.upstreamStartedAt;
			const meta = routing.candidate.meta;
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
			const chunks = tapFirstToken(
				routing.value.chunks,
				(at) => {
					firstTokenAt = at;
				},
				(at) => {
					lastChunkAt = at;
				},
			);
			for await (const chunk of withSSEHeartbeats(chunks, () =>
				writeSSEHeartbeat(stream, downstream),
			)) {
				log.progress();
				const transformed = await applyStreamEventExtensions(
					c,
					"chat",
					canonical.model,
					chunk,
				);
				const delta = transformed.choices[0]?.delta;
				if (delta?.content) content += delta.content;
				if (transformed.usage) finalUsage = transformed.usage;

				let out = transformed;
				if (!canonical.includeUsage && transformed.usage !== undefined) {
					if (transformed.choices.length === 0) continue;
					out = { ...transformed };
					delete out.usage;
				}
				await writeSSE(
					stream,
					{
						data: JSON.stringify(
							toOpenAIChatChunk(out, routing.candidate.row.publicModel),
						),
					},
					downstream,
				);
				const semantic = chatChunkSemantic(transformed);
				if (
					semantic === "reasoning" ||
					semantic === "content" ||
					semantic === "tool"
				)
					markDownstreamSemanticWritten(downstream);
				if (transformed.choices.some((choice) => choice.finishReason !== null))
					markDownstreamTerminalWritten(downstream);
			}
			if (routingMetadata)
				await writeSSE(
					stream,
					{
						data: JSON.stringify({
							id: `chatcmpl-${log.requestId}`,
							object: "chat.completion.chunk",
							created: Math.floor(Date.now() / 1000),
							model: routing.candidate.row.publicModel,
							choices: [],
							unified_routing: routingMetadata,
						}),
					},
					downstream,
				);
			await writeSSE(stream, { data: "[DONE]" }, downstream);
			markDownstreamTerminalWritten(downstream);
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
						{ data: JSON.stringify(streamError.toOpenAI()) },
						downstream,
					);
					await writeSSE(stream, { data: "[DONE]" }, downstream);
					markDownstreamTerminalWritten(downstream);
				} catch {
					// The original stream failure remains authoritative.
				}
		} finally {
			if (routed) {
				await routed.routing.finish(
					finalUsage,
					lastChunkAt ?? undefined,
					streamError,
					undefined,
					downstream,
				);
			} else {
				finishDownstreamWriteObservation(downstream, streamError?.code);
			}
			const cost = routed
				? computeUsageCost(routed.routing.candidate.meta, finalUsage)
				: null;
			log.write({
				status: streamError ? "error" : "success",
				httpStatus:
					downstream.clientAbortAt !== null ||
					streamError?.code === "client_closed_request"
						? 499
						: 200,
				usage: finalUsage,
				cost,
				ttftMs: firstTokenAt !== null ? firstTokenAt - log.startedAt : null,
				responseBody: { streamed: true, content },
				metadata,
				error: streamError ? streamError.toLog() : null,
			});
		}
	});
}

/** POST /v1/chat/completions - compatible public contract, stream and non-stream, with logging. */
export async function chatCompletionsHandler(
	c: Context<AppEnv>,
): Promise<Response> {
	const log = new OperationLogDraft(c, "chat");
	const lifecycle = new RouteLifecycle<ChatExecResult>();

	try {
		const json = await readJsonBody(c, PUBLIC_JSON_BODY_MAX_BYTES);
		log.requestBody = json;
		const parsed = parseBody(chatRequestSchema, json);

		let canonical = toCanonicalChatRequest(parsed);
		log.publicModel = canonical.model;
		await preflight(c, canonical.model);
		canonical = await applyCanonicalRequestExtensions(c, "chat", canonical);
		log.publicModel = canonical.model;
		assertFinalModelAllowed(c, canonical.model);

		// Cache (opt-in, safe): only non-stream and without tools. Isolated per virtual key (no leak
		// between tenants); the MASTER never caches (it has no tenant to isolate).
		const cache = await openResponseCache({
			c,
			draft: log,
			namespace: "chat",
			payload: canonical as unknown as Record<string, unknown>,
			eligible:
				!canonical.stream &&
				!canonical.tools?.length &&
				!hasContentInputs(canonical),
		});
		if (cache.hit) return c.json(cache.body as object);

		const settings = await getEffectiveSettings();
		if (canonical.stream)
			return streamChatCompletion(c, canonical, settings, log);
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
			await lifecycle.finish(response.usage);
			const cost = computeUsageCost(meta, response.usage);
			const baseResponse = toOpenAIChatResponse(
				response,
				routing.candidate.row.publicModel,
			);
			cache.store(baseResponse, response.usage);
			const oa = attachRoutingMetadata(
				baseResponse as unknown as Record<string, unknown>,
				routingMetadata,
			);
			log.write({
				status: "success",
				httpStatus: 200,
				usage: response.usage,
				cost,
				ttftMs: log.elapsedMs(), // non-stream: the response arrives complete at once
				responseBody: oa,
				metadata,
				error: null,
			});
			return c.json(oa);
		}
		throw new GatewayError({
			class: "server",
			message: "Non-streaming chat unexpectedly returned a stream",
		});
	} catch (err) {
		const ge = toGatewayError(err);
		log.applyFailedAttempts(ge.attempts);
		await lifecycle.finish(null, ge);
		await notifyExtensionError(c, "chat", log.publicModel, ge);
		log.writeError(ge);
		throw err; // the global onError formats the OpenAI response
	}
}
