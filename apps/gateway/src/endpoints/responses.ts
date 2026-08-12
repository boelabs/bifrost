import { ResponsesWebSocketUpstreams } from "#gateway/responsesWebSocketSessions.ts";
import type { GatewayError as GatewayErrorType } from "#core/errors.ts";
import { authenticateRequest, getAuth } from "#auth/middleware.ts";
import { candidateMetadata } from "#gateway/candidateMetadata.ts";
import { hasContentInputs } from "#files/requestContentInputs.ts";
import type { CanonicalChatRequest } from "#core/canonical.ts";
import { OperationLogDraft } from "./runtime/operationLog.ts";
import type { EffectiveSettings } from "#router/settings.ts";
import { RouteLifecycle } from "./runtime/routeLifecycle.ts";
import { getEffectiveSettings } from "#router/settings.ts";
import type { ChatExecResult } from "#gateway/executor.ts";
import { reasoningLogInfo } from "#core/reasoning.ts";
import { upgradeWebSocket } from "@hono/node-server";
import { tapFirstToken } from "#gateway/ttft.ts";
import { GatewayError } from "#core/errors.ts";
import type { AppEnv } from "#auth/types.ts";
import type { Usage } from "#core/usage.ts";
import { streamSSE } from "hono/streaming";
import type { Auth } from "#auth/types.ts";
import { randomUUID } from "node:crypto";
import type { WSContext } from "hono/ws";
import { env } from "#config/env.ts";
import type { Context } from "hono";

import {
	canonicalChunksToResponsesEvents,
	canonicalToResponsesResponse,
	responsesRequestToCanonical,
	responseEventForClient,
	normalizeResponseInput,
	type ResponseInputItem,
	expandInputReferences,
	type RenderOptions,
	responseForClient,
	toResponsesUsage,
} from "#contracts/openai/responsesRender.ts";

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
	type DownstreamWriteObservation,
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
	compactResponseRequestSchema,
	parseWebSocketResponseCreate,
	type CompactResponseRequest,
	responsesRequestSchema,
	type ResponsesRequest,
} from "#contracts/openai/responses.ts";

import {
	findResponseItemByIdForScope,
	deleteResponseStateForScope,
	getResponseStateForScope,
	storeResponseState,
} from "#db/repos/responseStates.ts";

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

import {
	type ConnectionResponseState,
	inheritWarmupRequest,
} from "#gateway/responsesWebSocketState.ts";

import {
	expandLocalCompactionItems,
	encodeCompactionSummary,
} from "./runtime/responseCompaction.ts";

interface PreparedResponsesRequest {
	req: ResponsesRequest;
	effectiveInput: ResponseInputItem[];
	currentInput: ResponseInputItem[];
}

function authVirtualKeyId(auth: Auth): string | null {
	return auth.type === "virtual" ? auth.key.id : null;
}

function outputItemsFromResponse(
	response: Record<string, unknown>,
): ResponseInputItem[] {
	return Array.isArray(response.output)
		? response.output.map((item) => structuredClone(item as ResponseInputItem))
		: [];
}

function responseId(response: Record<string, unknown>): string {
	if (typeof response.id === "string" && response.id.length > 0)
		return response.id;
	throw new GatewayError({
		class: "server",
		message: "Rendered response is missing id",
	});
}

async function prepareResponsesRequest(
	req: ResponsesRequest,
	auth: Auth,
	connectionState?: ConnectionResponseState | null,
): Promise<PreparedResponsesRequest> {
	const virtualKeyId = authVirtualKeyId(auth);
	let previousItems: ResponseInputItem[] = [];

	if (req.previous_response_id != null) {
		if (connectionState?.id === req.previous_response_id) {
			previousItems = [
				...connectionState.requestInput,
				...connectionState.output,
			];
		} else {
			const previous = await getResponseStateForScope(
				req.previous_response_id,
				virtualKeyId,
			);
			if (!previous) {
				throw new GatewayError({
					class: "bad_request",
					message: `previous_response_id not found: ${req.previous_response_id}`,
					publicMessage: "Previous response was not found.",
					code: "previous_response_not_found",
					param: "previous_response_id",
				});
			}
			previousItems = [...previous.requestInput, ...previous.output];
		}
	}

	const currentInput = await expandInputReferences(
		normalizeResponseInput(req.input),
		previousItems,
		(id) => findResponseItemByIdForScope(id, virtualKeyId),
	);
	const effectiveInput = expandLocalCompactionItems([
		...previousItems.map((item) => structuredClone(item)),
		...currentInput,
	]);
	// Resolve `store` against the gateway default so both persistence and the echoed value agree.
	const store = req.store ?? env.RESPONSES_STORE_DEFAULT;
	return {
		req: { ...req, input: effectiveInput, store },
		effectiveInput,
		currentInput,
	};
}

const COMPACTION_INSTRUCTIONS =
	"Create a compact, faithful conversation state for a later model turn. Preserve user intent, constraints, decisions, tool results, unresolved work, and identifiers that are still needed. Remove repetition and incidental wording. Return only the compacted state.";

/** POST /v1/responses/compact - provider-agnostic conversation compaction. */
export async function compactResponseHandler(
	c: Context<AppEnv>,
): Promise<Response> {
	const log = new OperationLogDraft(c, "responses.compact");
	const lifecycle = new RouteLifecycle<ChatExecResult>();
	const auth = getAuth(c);
	try {
		const json = await readJsonBody(c, PUBLIC_JSON_BODY_MAX_BYTES);
		log.requestBody = json;
		const compact: CompactResponseRequest = parseBody(
			compactResponseRequestSchema,
			json,
		);
		log.publicModel = compact.model;
		const request = responsesRequestSchema.parse({
			model: compact.model,
			...(compact.input !== undefined ? { input: compact.input } : {}),
			...(compact.previous_response_id != null
				? { previous_response_id: compact.previous_response_id }
				: {}),
			instructions: [COMPACTION_INSTRUCTIONS, compact.instructions]
				.filter(
					(value): value is string =>
						typeof value === "string" && value.length > 0,
				)
				.join("\n\n"),
			...(compact.prompt_cache_key !== undefined
				? { prompt_cache_key: compact.prompt_cache_key }
				: {}),
			stream: false,
			store: false,
		});
		const prepared = await prepareResponsesRequest(request, auth);
		let canonical = responsesRequestToCanonical(prepared.req);
		await preflight(c, canonical.model);
		canonical = await applyCanonicalRequestExtensions(c, "chat", canonical);
		log.publicModel = canonical.model;
		assertFinalModelAllowed(c, canonical.model);
		const settings = await getEffectiveSettings();
		const { routing, parameterPolicy, contentInputResolution } =
			await routeChat(c, canonical, log.requestId, settings, {
				signal: log.clientSignal,
				operationId: log.operationId,
			});
		log.applyRouting(routing);
		lifecycle.attach(routing);
		if (routing.value.kind === "json")
			lifecycle.rememberUsage(routing.value.response.usage);
		if (routing.value.kind !== "json")
			throw new GatewayError({
				class: "server",
				message: "Compaction unexpectedly returned a stream",
			});
		const response = await applyCanonicalResponseExtensions(
			c,
			"chat",
			canonical.model,
			routing.value.response,
		);
		const summary = response.choices[0]?.message.content;
		if (typeof summary !== "string" || summary.length === 0)
			throw new GatewayError({
				class: "server",
				message: "Compaction returned no summary",
			});
		await lifecycle.finish(response.usage);
		const meta = routing.candidate.meta;
		const cost = computeUsageCost(meta, response.usage);
		const metadata: Record<string, unknown> = candidateMetadata(
			routing.candidate,
		);
		metadata.terminal = routing.value.terminal;
		const parameterMetadata = parameterPolicyLogMetadata(
			parameterPolicy,
			settings.unsupportedParameterStrategy,
		);
		if (parameterMetadata) metadata.parameterPolicy = parameterMetadata;
		const contentInputMetadata = contentInputResolutionLogMetadata(
			contentInputResolution,
		);
		if (contentInputMetadata) metadata.contentInputs = contentInputMetadata;
		const createdAt = Math.floor(Date.now() / 1000);
		const body = {
			id: `resp_${randomUUID()}`,
			object: "response.compaction",
			created_at: createdAt,
			output: [
				{
					id: `cmp_${randomUUID()}`,
					type: "compaction",
					encrypted_content: encodeCompactionSummary(summary),
				},
			],
			usage: toResponsesUsage(response.usage),
		};
		log.write({
			status: "success",
			httpStatus: 200,
			usage: response.usage,
			cost,
			ttftMs: log.elapsedMs(),
			responseBody: body,
			metadata,
			error: null,
		});
		return c.json(body);
	} catch (error) {
		const gatewayError = toGatewayError(error);
		log.applyFailedAttempts(gatewayError.attempts);
		await lifecycle.finish(null, gatewayError);
		await notifyExtensionError(c, "chat", log.publicModel, gatewayError);
		log.writeError(gatewayError);
		throw error;
	}
}

async function persistResponseState(opts: {
	auth: Auth;
	req: ResponsesRequest;
	effectiveInput: ResponseInputItem[];
	response: Record<string, unknown>;
	deploymentId: string | null;
	adapterKey: string | null;
	requestId: string;
	metadata: Record<string, unknown>;
	internalOutput?: ResponseInputItem[];
}): Promise<void> {
	// Opaque tool-call state round-trips statelessly through the client (thought signatures ride
	// inside call ids); only client-requested storage (`store: true`) persists anything.
	if (opts.req.store !== true) return;
	const output = opts.internalOutput ?? outputItemsFromResponse(opts.response);
	const id = responseId(opts.response);
	await storeResponseState({
		id,
		virtualKeyId: authVirtualKeyId(opts.auth),
		publicModel: opts.req.model,
		deploymentId: opts.deploymentId,
		adapterKey: opts.adapterKey,
		previousResponseId: opts.req.previous_response_id ?? null,
		store: true,
		requestInput: opts.effectiveInput,
		output,
		response: opts.response,
		metadata: {
			requestId: opts.requestId,
			...opts.metadata,
		},
	});
}

function streamResponses(
	c: Context<AppEnv>,
	log: OperationLogDraft,
	auth: Auth,
	pipelineReq: ResponsesRequest,
	prepared: PreparedResponsesRequest,
	canonical: CanonicalChatRequest,
	settings: EffectiveSettings,
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
		let statePersisted = false;
		let metadata: Record<string, unknown> = { downstream };
		let responseIdentity: {
			id: string;
			createdAt: number;
			model: string;
		} | null = null;
		let nextFailureSequence = 0;
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
					message: "Streaming Responses unexpectedly returned JSON",
				});
			const upstreamStartedAt = routing.upstreamStartedAt;
			const meta = routing.candidate.meta;
			const renderOpts: RenderOptions = {
				req: pipelineReq,
				upstreamModel: routing.candidate.upstreamModel,
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
					yield await applyStreamEventExtensions(
						c,
						"chat",
						canonical.model,
						chunk,
					);
				}
			}
			const events = canonicalChunksToResponsesEvents(
				transformedChunks(),
				renderOpts,
			);
			for await (const ev of withSSEHeartbeats(events, () =>
				writeSSEHeartbeat(stream, downstream),
			)) {
				const clientEvent = responseEventForClient(ev, pipelineReq.include);
				let eventData = clientEvent.data;
				try {
					const sequenced = JSON.parse(ev.data) as {
						sequence_number?: unknown;
					};
					if (typeof sequenced.sequence_number === "number")
						nextFailureSequence = Math.max(
							nextFailureSequence,
							sequenced.sequence_number + 1,
						);
				} catch {
					// Renderer validation remains authoritative for the event itself.
				}
				if (ev.event === "response.created") {
					try {
						const created = JSON.parse(ev.data) as {
							response?: {
								id?: string;
								created_at?: number;
								model?: string;
							};
						};
						if (created.response?.id)
							responseIdentity = {
								id: created.response.id,
								createdAt:
									created.response.created_at ?? Math.floor(Date.now() / 1000),
								model: created.response.model ?? canonical.model,
							};
					} catch {
						// The regular renderer validation below remains authoritative.
					}
				}
				if (
					ev.event === "response.completed" ||
					ev.event === "response.incomplete"
				) {
					let completed:
						| (Record<string, unknown> & { usage?: unknown })
						| undefined;
					let internalResponse: Record<string, unknown> | undefined;
					try {
						const internalData = JSON.parse(ev.data) as {
							response?: Record<string, unknown> & { usage?: unknown };
						};
						internalResponse = internalData.response;
						const data = JSON.parse(clientEvent.data) as {
							response?: Record<string, unknown> & { usage?: unknown };
						};
						completed = data.response;
						if (routingMetadata && completed)
							eventData = JSON.stringify({
								...data,
								response: {
									...completed,
									unified_routing: routingMetadata,
								},
							});
						const finalUsage = completed?.usage as
							| {
									input_tokens?: number;
									output_tokens?: number;
									total_tokens?: number;
							  }
							| undefined;
						if (finalUsage)
							usage = {
								promptTokens: finalUsage.input_tokens ?? 0,
								completionTokens: finalUsage.output_tokens ?? 0,
								totalTokens: finalUsage.total_tokens ?? 0,
							};
					} catch {
						completed = undefined;
					}
					if (completed && !statePersisted) {
						await persistResponseState({
							auth,
							req: pipelineReq,
							effectiveInput: prepared.effectiveInput,
							response: completed,
							...(internalResponse
								? { internalOutput: outputItemsFromResponse(internalResponse) }
								: {}),
							deploymentId: routing.candidate.row.id,
							adapterKey: routing.candidate.adapter.key,
							requestId: log.requestId,
							metadata,
						});
						statePersisted = true;
					}
				}
				await writeSSE(
					stream,
					{ event: clientEvent.event!, data: eventData },
					downstream,
				);
				if (
					ev.event === "response.output_text.delta" ||
					ev.event === "response.reasoning_summary_text.delta" ||
					ev.event === "response.function_call_arguments.delta"
				)
					markDownstreamSemanticWritten(downstream);
				if (
					ev.event === "response.completed" ||
					ev.event === "response.incomplete"
				)
					markDownstreamTerminalWritten(downstream);
			}
			await writeSSE(stream, { data: "[DONE]" }, downstream);
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
			) {
				const publicError = streamError.toOpenAI().error;
				try {
					await writeSSE(
						stream,
						{
							event: "response.failed",
							data: JSON.stringify({
								type: "response.failed",
								sequence_number: nextFailureSequence,
								response: {
									id: responseIdentity?.id ?? `resp_${randomUUID()}`,
									object: "response",
									created_at:
										responseIdentity?.createdAt ??
										Math.floor(Date.now() / 1000),
									status: "failed",
									model: responseIdentity?.model ?? canonical.model,
									output: [],
									error: publicError,
									incomplete_details: null,
									usage: null,
								},
							}),
						},
						downstream,
					);
					markDownstreamTerminalWritten(downstream);
					await writeSSE(stream, { data: "[DONE]" }, downstream);
				} catch {
					// The original stream failure remains authoritative.
				}
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
 * POST /v1/responses - OpenResponses API, provider-agnostic.
 * Translates the request to canonical, routes to an adapter with a `chat` handler, and renders the
 * canonical result to the OpenResponses contract. Works with any provider.
 */
export async function responsesHandler(c: Context<AppEnv>): Promise<Response> {
	const log = new OperationLogDraft(c, "responses");
	const lifecycle = new RouteLifecycle<ChatExecResult>();
	const auth = getAuth(c);

	try {
		const json = await readJsonBody(c, PUBLIC_JSON_BODY_MAX_BYTES);
		log.requestBody = json;
		const req: ResponsesRequest = parseBody(responsesRequestSchema, json);
		log.publicModel = req.model;

		const prepared = await prepareResponsesRequest(req, auth);
		const pipelineReq = prepared.req;
		let canonical = responsesRequestToCanonical(pipelineReq);
		await preflight(c, canonical.model);
		canonical = await applyCanonicalRequestExtensions(c, "chat", canonical);
		log.publicModel = canonical.model;
		assertFinalModelAllowed(c, canonical.model);

		// Cache (opt-in, safe): only non-stream, without tools and without server-side state. Isolated per virtual
		// key (no cross-tenant leak); MASTER never caches.
		const cache = await openResponseCache({
			c,
			draft: log,
			namespace: "responses",
			payload: canonical as unknown as Record<string, unknown>,
			eligible:
				!canonical.stream &&
				!canonical.tools?.length &&
				pipelineReq.previous_response_id == null &&
				pipelineReq.store !== true &&
				!hasContentInputs(canonical),
		});
		if (cache.hit) return c.json(cache.body as object);

		const settings = await getEffectiveSettings();
		if (canonical.stream)
			return streamResponses(
				c,
				log,
				auth,
				pipelineReq,
				prepared,
				canonical,
				settings,
			);
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
		const renderOpts: RenderOptions = {
			req: pipelineReq,
			upstreamModel: routing.candidate.upstreamModel,
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
			const internalRendered = canonicalToResponsesResponse(
				response,
				renderOpts,
			);
			const rendered = responseForClient(internalRendered, pipelineReq.include);
			await persistResponseState({
				auth,
				req: pipelineReq,
				effectiveInput: prepared.effectiveInput,
				response: rendered,
				internalOutput: outputItemsFromResponse(internalRendered),
				deploymentId: routing.candidate.row.id,
				adapterKey: routing.candidate.adapter.key,
				requestId: log.requestId,
				metadata,
			});
			cache.store(rendered, usage);
			const body = attachRoutingMetadata(rendered, routingMetadata);
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
			message: "Non-streaming Responses unexpectedly returned a stream",
		});
	} catch (err) {
		const ge = toGatewayError(err);
		log.applyFailedAttempts(ge.attempts);
		await lifecycle.finish(null, ge);
		await notifyExtensionError(c, "chat", log.publicModel, ge);
		log.writeError(ge);
		throw err;
	}
}

/* ------------------------------------------------- state endpoints (server-side store) */

function requireId(c: Context<AppEnv>): string {
	const id = c.req.param("id");
	if (!id)
		throw new GatewayError({
			class: "bad_request",
			message: "Missing response id",
			param: "id",
		});
	return id;
}

/** Loads a state within the key's scope or throws not_found with the OpenResponses shape. */
async function loadStateOr404(c: Context<AppEnv>): Promise<{
	id: string;
	row: Awaited<ReturnType<typeof getResponseStateForScope>>;
}> {
	const id = requireId(c);
	const row = await getResponseStateForScope(id, authVirtualKeyId(getAuth(c)));
	if (!row) {
		throw new GatewayError({
			class: "not_found",
			message: `response not found: ${id}`,
			publicMessage: `Response with id '${id}' not found.`,
			code: "response_not_found",
			param: "id",
		});
	}
	return { id, row };
}

/** GET /v1/responses/{id} - returns the stored canonical `response` object. */
export async function retrieveResponseHandler(
	c: Context<AppEnv>,
): Promise<Response> {
	const { row } = await loadStateOr404(c);
	return c.json(row!.response as object);
}

/** DELETE /v1/responses/{id} - deletes the saved state. */
export async function deleteResponseHandler(
	c: Context<AppEnv>,
): Promise<Response> {
	const id = requireId(c);
	const deleted = await deleteResponseStateForScope(
		id,
		authVirtualKeyId(getAuth(c)),
	);
	if (!deleted) {
		throw new GatewayError({
			class: "not_found",
			message: `response not found: ${id}`,
			publicMessage: `Response with id '${id}' not found.`,
			code: "response_not_found",
			param: "id",
		});
	}
	return c.json({ id, object: "response.deleted", deleted: true });
}

/** GET /v1/responses/{id}/input_items - lists the stored input items. */
export async function listResponseInputItemsHandler(
	c: Context<AppEnv>,
): Promise<Response> {
	const { row } = await loadStateOr404(c);
	const items = row!.requestInput;
	const idOf = (it: Record<string, unknown>): string | null =>
		typeof it.id === "string" ? it.id : null;
	return c.json({
		object: "list",
		data: items,
		first_id: items.length > 0 ? idOf(items[0]!) : null,
		last_id: items.length > 0 ? idOf(items[items.length - 1]!) : null,
		has_more: false,
	});
}

/* ------------------------------------------------- persistent WebSocket transport */

const RESPONSES_WEBSOCKET_MAX_MS = 60 * 60 * 1000;
const RESPONSES_WEBSOCKET_MAX_MESSAGE_BYTES = 16 * 1024 * 1024;

interface ActiveResponsesWebSocket {
	state: ConnectionResponseState | null;
	upstreams: ResponsesWebSocketUpstreams;
	queue: Promise<void>;
	activeAbort: AbortController | null;
	timer: ReturnType<typeof setTimeout>;
	socket: WSContext | null;
	preferredDeploymentId: string | null;
	scopeKey: string;
	queuedTurns: number;
}

const activeResponsesWebSockets = new Set<ActiveResponsesWebSocket>();

function websocketError(error: GatewayErrorType): Record<string, unknown> {
	return {
		type: "error",
		status: error.httpStatus,
		...error.toOpenAI(),
	};
}

async function sendWebSocketJson(
	ws: WSContext,
	value: unknown,
	observation?: DownstreamWriteObservation,
): Promise<void> {
	if (ws.readyState !== 1) return;
	const startedAt = Date.now();
	const serialized = JSON.stringify(value);
	ws.send(serialized);
	const raw = ws.raw as { bufferedAmount?: number } | undefined;
	while ((raw?.bufferedAmount ?? 0) > 1_048_576) {
		if (Date.now() - startedAt >= 30_000)
			throw new GatewayError({
				class: "server",
				code: "downstream_backpressure",
				message: "WebSocket client did not drain its receive buffer",
				failureKind: "gateway",
				deploymentHealth: "neutral",
				retryable: false,
			});
		await new Promise<void>((resolve) => setTimeout(resolve, 10));
	}
	if (observation) {
		observation.bytes += Buffer.byteLength(serialized);
		const blockedMs = Date.now() - startedAt;
		observation.totalBlockedMs += blockedMs;
		observation.maxBlockedMs = Math.max(observation.maxBlockedMs, blockedMs);
	}
}

function websocketMessageText(value: unknown): string {
	if (typeof value === "string") return value;
	if (value instanceof ArrayBuffer) return Buffer.from(value).toString("utf8");
	if (ArrayBuffer.isView(value))
		return Buffer.from(
			value.buffer,
			value.byteOffset,
			value.byteLength,
		).toString("utf8");
	throw new GatewayError({
		class: "bad_request",
		code: "invalid_websocket_message",
		message: "Responses WebSocket messages must be UTF-8 JSON text",
		publicMessage: "WebSocket messages must be JSON text.",
	});
}

async function executeResponsesWebSocketTurn(
	c: Context<AppEnv>,
	session: ActiveResponsesWebSocket,
	rawMessage: unknown,
): Promise<void> {
	const ws = session.socket;
	if (ws?.readyState !== 1) return;
	const turnAbort = new AbortController();
	session.activeAbort = turnAbort;
	const requestId = randomUUID();
	c.set("turnRequestId", requestId);
	c.set("turnSignal", turnAbort.signal);
	const log = new OperationLogDraft(c, "responses.websocket", { requestId });
	const lifecycle = new RouteLifecycle<ChatExecResult>();
	let referencedPreviousId: string | null = null;
	let logged = false;

	try {
		const text = websocketMessageText(rawMessage);
		if (Buffer.byteLength(text, "utf8") > RESPONSES_WEBSOCKET_MAX_MESSAGE_BYTES)
			throw new GatewayError({
				class: "bad_request",
				status: 413,
				code: "websocket_message_too_large",
				message: "Responses WebSocket message exceeds 16 MiB",
				publicMessage: "WebSocket message is too large.",
			});
		let json: unknown;
		try {
			json = JSON.parse(text);
		} catch (cause) {
			throw new GatewayError({
				class: "bad_request",
				code: "invalid_json",
				message: "Responses WebSocket message is not valid JSON",
				publicMessage: "Invalid JSON.",
				cause,
			});
		}
		log.requestBody = json;
		let parsed: ReturnType<typeof parseWebSocketResponseCreate>;
		try {
			parsed = parseWebSocketResponseCreate(json);
		} catch (cause) {
			const issue = (
				cause as {
					issues?: Array<{ path?: PropertyKey[]; message?: string }>;
				}
			)?.issues?.[0];
			throw new GatewayError({
				class: "bad_request",
				code: "invalid_request_error",
				message:
					cause instanceof Error
						? cause.message
						: "Invalid response.create event",
				publicMessage: issue?.message ?? "Invalid response.create event.",
				param:
					issue?.path && issue.path.length > 0
						? issue.path.map(String).join(".")
						: null,
				cause,
			});
		}
		const req = inheritWarmupRequest(parsed.request, session.state);
		referencedPreviousId = req.previous_response_id ?? null;
		log.publicModel = req.model;
		const auth = await authenticateRequest(c);
		c.set("auth", auth);
		const prepared = await prepareResponsesRequest(req, auth, session.state);
		const pipelineReq = prepared.req;
		let canonical = responsesRequestToCanonical(pipelineReq);
		canonical = { ...canonical, stream: true };
		await preflight(c, canonical.model, { writeHeaders: false });
		canonical = await applyCanonicalRequestExtensions(c, "chat", canonical);
		log.publicModel = canonical.model;
		assertFinalModelAllowed(c, canonical.model);
		const settings = await getEffectiveSettings();
		const { routing, parameterPolicy, contentInputResolution } =
			await routeChat(c, canonical, requestId, settings, {
				signal: turnAbort.signal,
				operationId: log.operationId,
				...(session.preferredDeploymentId
					? {
							preferredDeploymentId: session.preferredDeploymentId,
						}
					: {}),
				execute: (candidate, ctx, candidateRequest) =>
					session.upstreams.execute(candidate, ctx, candidateRequest, {
						currentRawInput: prepared.currentInput as Record<string, unknown>[],
						previousPublicResponseId: referencedPreviousId,
						generate: parsed.generate,
					}),
			});
		log.applyRouting(routing);
		lifecycle.attach(routing);
		if (routing.value.kind === "json")
			lifecycle.rememberUsage(routing.value.response.usage);
		const upstreamStartedAt = routing.upstreamStartedAt;
		const meta = routing.candidate.meta;
		const renderOpts: RenderOptions = {
			req: pipelineReq,
			upstreamModel: routing.candidate.upstreamModel,
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

		if (routing.value.kind !== "stream")
			throw new GatewayError({
				class: "server",
				message: "Responses WebSocket turn unexpectedly returned JSON",
			});

		let firstTokenAt: number | null = null;
		let lastChunkAt: number | null = null;
		let usage: Usage | null = null;
		let streamError: GatewayErrorType | null = null;
		const downstream = newDownstreamWriteObservation(log.operationId);
		let completedResponse: Record<string, unknown> | null = null;
		let internalResponse: Record<string, unknown> | null = null;
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
				yield await applyStreamEventExtensions(
					c,
					"chat",
					canonical.model,
					chunk,
				);
			}
		}
		const events = canonicalChunksToResponsesEvents(
			transformedChunks(),
			renderOpts,
		);
		try {
			for await (const event of events) {
				const clientEvent = responseEventForClient(event, pipelineReq.include);
				let data: Record<string, unknown>;
				try {
					data = JSON.parse(clientEvent.data) as Record<string, unknown>;
				} catch {
					throw new GatewayError({
						class: "server",
						message: "Rendered Responses event is not valid JSON",
					});
				}
				if (
					event.event === "response.completed" ||
					event.event === "response.incomplete"
				) {
					const internalData = JSON.parse(event.data) as {
						response?: Record<string, unknown>;
					};
					internalResponse = internalData.response ?? null;
					completedResponse =
						(data.response as Record<string, unknown> | undefined) ?? null;
					const responseUsage = completedResponse?.usage as
						| {
								input_tokens?: number;
								output_tokens?: number;
								total_tokens?: number;
						  }
						| undefined;
					if (responseUsage) {
						usage = {
							promptTokens: responseUsage.input_tokens ?? 0,
							completionTokens: responseUsage.output_tokens ?? 0,
							totalTokens: responseUsage.total_tokens ?? 0,
						};
					}
					if (completedResponse) {
						await persistResponseState({
							auth,
							req: pipelineReq,
							effectiveInput: prepared.effectiveInput,
							response: completedResponse,
							...(internalResponse
								? {
										internalOutput: outputItemsFromResponse(internalResponse),
									}
								: {}),
							deploymentId: routing.candidate.row.id,
							adapterKey: routing.candidate.adapter.key,
							requestId,
							metadata,
						});
						const publicId = responseId(completedResponse);
						session.state = {
							id: publicId,
							requestInput: prepared.effectiveInput.map((item) =>
								structuredClone(item),
							),
							output: outputItemsFromResponse(
								internalResponse ?? completedResponse,
							),
							warmupRequest: parsed.generate
								? null
								: structuredClone(pipelineReq),
						};
						session.preferredDeploymentId = routing.candidate.row.id;
						session.upstreams.commit(
							routing.candidate.row.id,
							publicId,
							routing.value.upstreamResponseId,
						);
					}
				}
				await sendWebSocketJson(ws, data, downstream);
			}
		} catch (error) {
			streamError = toGatewayError(error, "Error during WebSocket streaming");
			throw streamError;
		} finally {
			if (firstTokenAt !== null)
				log.upstreamTtftMs = firstTokenAt - upstreamStartedAt;
			await lifecycle.finish(usage, streamError, {
				...(lastChunkAt !== null ? { finishedAt: lastChunkAt } : {}),
				downstream,
			});
			const cost = computeUsageCost(meta, usage);
			log.write({
				status: streamError ? "error" : "success",
				httpStatus: streamError?.httpStatus ?? 200,
				usage,
				cost,
				ttftMs: firstTokenAt !== null ? firstTokenAt - log.startedAt : null,
				responseBody: completedResponse ?? { streamed: true },
				metadata,
				error: streamError ? streamError.toLog() : null,
			});
			logged = true;
		}
	} catch (error) {
		const gatewayError = toGatewayError(error);
		log.applyFailedAttempts(gatewayError.attempts);
		await lifecycle.finish(null, gatewayError);
		await notifyExtensionError(c, "chat", log.publicModel, gatewayError);
		if (!logged) log.writeError(gatewayError);
		if (
			referencedPreviousId &&
			gatewayError.httpStatus >= 400 &&
			gatewayError.httpStatus <= 599
		) {
			if (session.state?.id === referencedPreviousId) session.state = null;
			session.upstreams.invalidate(referencedPreviousId);
		}
		if (gatewayError.code !== "downstream_backpressure")
			await sendWebSocketJson(ws, websocketError(gatewayError));
	} finally {
		if (session.activeAbort === turnAbort) session.activeAbort = null;
		c.set("turnRequestId", undefined);
		c.set("turnSignal", undefined);
	}
}

/**
 * GET /v1/responses with Upgrade: websocket. Each connection owns one previous-response cache and a
 * sequential turn queue. The endpoint deliberately uses the same public resource as POST.
 */
export const responsesWebSocketHandler = upgradeWebSocket(
	(c) => {
		const auth = getAuth(c);
		const scopeKey = auth.type === "virtual" ? auth.key.id : "master";
		const connectionsForScope = [...activeResponsesWebSockets].filter(
			(active) => active.scopeKey === scopeKey,
		).length;
		if (
			activeResponsesWebSockets.size >=
				env.RESPONSES_WEBSOCKET_MAX_CONNECTIONS ||
			connectionsForScope >= env.RESPONSES_WEBSOCKET_MAX_CONNECTIONS_PER_KEY
		) {
			throw new GatewayError({
				class: "rate_limit",
				code: "websocket_connection_limit_exceeded",
				message: "Responses WebSocket connection concurrency limit exceeded",
				publicMessage: "Responses WebSocket connection limit exceeded.",
			});
		}
		const session: ActiveResponsesWebSocket = {
			state: null,
			upstreams: new ResponsesWebSocketUpstreams(),
			queue: Promise.resolve(),
			activeAbort: null,
			socket: null,
			preferredDeploymentId: null,
			scopeKey,
			queuedTurns: 0,
			timer: setTimeout(() => undefined, RESPONSES_WEBSOCKET_MAX_MS),
		};
		clearTimeout(session.timer);
		session.timer = setTimeout(() => {
			const ws = session.socket;
			if (!ws) return;
			void sendWebSocketJson(
				ws,
				websocketError(
					new GatewayError({
						class: "bad_request",
						code: "websocket_connection_limit_reached",
						message: "Responses WebSocket connection reached 60 minutes",
						publicMessage:
							"Responses websocket connection limit reached (60 minutes). Create a new websocket connection to continue.",
					}),
				),
			);
			ws.close(1000, "60 minute connection limit");
		}, RESPONSES_WEBSOCKET_MAX_MS);
		activeResponsesWebSockets.add(session);
		return {
			onOpen(_event, ws) {
				session.socket = ws;
			},
			onMessage(event) {
				if (session.queuedTurns >= env.RESPONSES_WEBSOCKET_MAX_QUEUED_TURNS) {
					if (session.socket)
						void sendWebSocketJson(
							session.socket,
							websocketError(
								new GatewayError({
									class: "rate_limit",
									code: "websocket_turn_queue_limit_exceeded",
									message: "Responses WebSocket queued-turn limit exceeded",
									publicMessage: "Too many queued response.create events.",
								}),
							),
						);
					return;
				}
				session.queuedTurns += 1;
				session.queue = session.queue
					.then(() => executeResponsesWebSocketTurn(c, session, event.data))
					.catch((error) => {
						const gatewayError = toGatewayError(error);
						if (session.socket)
							void sendWebSocketJson(
								session.socket,
								websocketError(gatewayError),
							);
					})
					.finally(() => {
						session.queuedTurns -= 1;
					});
			},
			onClose() {
				clearTimeout(session.timer);
				session.activeAbort?.abort();
				session.upstreams.close();
				activeResponsesWebSockets.delete(session);
			},
			onError() {
				session.activeAbort?.abort();
			},
		};
	},
	{
		onError(error) {
			// Upgrade errors are handled by Hono's normal error path before a socket exists.
			throw error;
		},
	},
);

/** Stops accepting work on all live Responses sockets during process shutdown. */
export function closeResponsesWebSockets(): void {
	for (const session of activeResponsesWebSockets) {
		clearTimeout(session.timer);
		session.activeAbort?.abort();
		session.upstreams.close();
		session.socket?.close(1012, "service restarting");
	}
	activeResponsesWebSockets.clear();
}
