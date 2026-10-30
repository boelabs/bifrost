import { RealtimeConversationTracker } from "#contracts/openai/realtimeConversationTracker.ts";
import { assertRealtimeConversationSupported } from "#gateway/realtimeRequestValidation.ts";
import { type AudioInputDecoder, createAudioInputDecoder } from "#audio/pcm.ts";
import type { RealtimeConversationSession } from "#adapters/types.ts";
import { realtimeConversationProfileFor } from "#catalog/types.ts";
import { candidateMetadata } from "#gateway/candidateMetadata.ts";
import { completedTerminal } from "#gateway/streamLifecycle.ts";
import { OperationLogDraft } from "./runtime/operationLog.ts";
import { route, type RouteResult } from "#router/index.ts";
import { GatewayError } from "#core/errors.ts";
import type { AppEnv } from "#auth/types.ts";
import { randomUUID } from "node:crypto";
import type { WSEvents } from "hono/ws";
import type { Context } from "hono";

import {
	type CanonicalRealtimeConversationConfig,
	realtimeUsageToCore,
	type RealtimeUsage,
} from "#core/realtime.ts";

import {
	RealtimeClientEventError,
	realtimeErrorEvent,
	eventId,
} from "#contracts/openai/realtime.ts";

import {
	type RealtimeConversationSessionUpdate,
	type RealtimeConversationClientEvent,
	applyConversationSessionUpdate,
	parseRealtimeConversationEvent,
	type RealtimeConversationState,
	newRealtimeConversationState,
	renderConversationSession,
	conversationConfigOf,
} from "#contracts/openai/realtimeConversation.ts";

import {
	finishDownstreamWriteObservation,
	type DownstreamWriteObservation,
	newDownstreamWriteObservation,
} from "./runtime/sse.ts";

import {
	assertFinalModelAllowed,
	usageQuotaForRequest,
	computeUsageCost,
	toGatewayError,
	preflight,
} from "./runtime/pipeline.ts";

import {
	type RealtimeSocketEntry,
	unregisterRealtimeSocket,
	registerRealtimeSocket,
	eventQueueLimitError,
	sessionExpiredError,
	realtimeMessageJson,
	sendRealtimeEvent,
	MAX_QUEUED_EVENTS,
	REALTIME_MAX_MS,
} from "./realtimeSockets.ts";

/**
 * GET /v1/realtime?model=… with Upgrade: websocket — OpenAI's Realtime API in conversation mode,
 * served by any adapter with a realtime conversation handler.
 *
 * The provider session opens with the first event that needs it (audio, an item, a response), so
 * the `session.update`s a client sends first configure it instead of reconnecting it. The whole
 * connection is one routed operation; its usage and cost are logged when it closes.
 */

/**
 * Usage estimates for a provider that reports none: Google bills live audio at 25 tokens per
 * second in both directions, and text runs about 4 characters per token.
 */
const ESTIMATED_AUDIO_TOKENS_PER_SECOND = 25;
const ESTIMATED_CHARACTERS_PER_TOKEN = 4;

interface ConversationRun {
	session: RealtimeConversationSession;
	routing: RouteResult<RealtimeConversationSession>;
	log: OperationLogDraft;
	abort: AbortController;
	configKey: string;
	downstream: DownstreamWriteObservation;
	ended: boolean;
}

interface ConversationConnection {
	c: Context<AppEnv>;
	entry: RealtimeSocketEntry;
	state: RealtimeConversationState;
	tracker: RealtimeConversationTracker;
	decoder: AudioInputDecoder;
	queue: Promise<void>;
	queued: number;
	run: ConversationRun | null;
	/**
	 * The provider session failed to open. Later events report it instead of retrying (and logging)
	 * once per audio chunk; the next `session.update` clears it.
	 */
	failed: GatewayError | null;
	timer: ReturnType<typeof setTimeout> | undefined;
	closed: boolean;
}

function send(
	connection: ConversationConnection,
	value: Record<string, unknown>,
): void {
	sendRealtimeEvent(connection.entry.socket, value, connection.run?.downstream);
}

function sendError(
	connection: ConversationConnection,
	error: GatewayError,
	clientEventId: string | null = null,
): void {
	const body = error.toOpenAI().error;
	send(
		connection,
		realtimeErrorEvent({
			type: body.type,
			code: body.code ?? null,
			message: body.message,
			param: body.param ?? null,
			eventId: clientEventId,
		}),
	);
}

function estimatedUsage(
	tracker: RealtimeConversationTracker,
): RealtimeUsage | null {
	const audioTokens = Math.ceil(
		tracker.inputAudioSeconds * ESTIMATED_AUDIO_TOKENS_PER_SECOND,
	);
	const textTokens = Math.ceil(
		tracker.inputTextCharacters / ESTIMATED_CHARACTERS_PER_TOKEN,
	);
	const outputAudioTokens = Math.ceil(
		tracker.outputAudioSeconds * ESTIMATED_AUDIO_TOKENS_PER_SECOND,
	);
	const outputTextTokens = Math.ceil(
		tracker.outputTextCharacters / ESTIMATED_CHARACTERS_PER_TOKEN,
	);
	const inputTokens = audioTokens + textTokens;
	const outputTokens = outputAudioTokens + outputTextTokens;
	if (inputTokens === 0 && outputTokens === 0) {
		return null;
	}
	return {
		inputTokens,
		outputTokens,
		totalTokens: inputTokens + outputTokens,
		audioTokens,
		textTokens,
		outputAudioTokens,
		outputTextTokens,
	};
}

/* ------------------------------------------------------------------ provider run */

async function pump(connection: ConversationConnection, run: ConversationRun) {
	try {
		for await (const event of run.session.events) {
			run.log.progress();
			connection.tracker.provider(event);
		}
		await endRun(connection, run, null);
	} catch (error) {
		if (run.ended) {
			return;
		}
		const gatewayError = toGatewayError(error, "Realtime conversation failed");
		sendError(connection, gatewayError);
		await endRun(connection, run, gatewayError);
		connection.entry.socket?.close(1011, "upstream session failed");
	}
}

async function endRun(
	connection: ConversationConnection,
	run: ConversationRun,
	error: GatewayError | null,
): Promise<void> {
	if (run.ended) {
		return;
	}
	run.ended = true;
	const { tracker } = connection;
	tracker.finish();
	run.session.close();
	run.abort.abort();
	let { usage } = tracker;
	let estimated = false;
	if (!usage) {
		usage = estimatedUsage(tracker);
		estimated = usage !== null;
	}
	const core = realtimeUsageToCore(usage);
	const terminal = error ? null : completedTerminal(core);
	await run.routing.finish(core, undefined, error, terminal, run.downstream);
	finishDownstreamWriteObservation(run.downstream, error?.code);
	const round = (seconds: number) => Math.round(seconds * 1000) / 1000;
	run.log.write({
		status: error ? "error" : "success",
		httpStatus: error?.httpStatus ?? 200,
		usage: core,
		cost: computeUsageCost(run.routing.candidate.meta, core),
		firstOutputMs:
			tracker.firstOutputAt === null
				? null
				: tracker.firstOutputAt - run.log.startedAt,
		responseBody: {
			streamed: true,
			responses: tracker.completedResponses,
			inputAudioSeconds: round(tracker.inputAudioSeconds),
			outputAudioSeconds: round(tracker.outputAudioSeconds),
		},
		metadata: {
			...candidateMetadata(run.routing.candidate),
			...(terminal ? { terminal } : {}),
			turnDetection: connection.state.turnDetection?.type ?? "manual",
			...(estimated ? { usageEstimated: true } : {}),
		},
		error: error ? error.toLog() : null,
	});
}

async function startRun(
	connection: ConversationConnection,
	config: CanonicalRealtimeConversationConfig,
): Promise<ConversationRun> {
	const { c } = connection;
	const requestId = randomUUID();
	const log = new OperationLogDraft(c, "realtime.conversation", {
		publicModel: config.model,
		requestId,
	});
	log.requestBody = { session: renderConversationSession(connection.state) };
	const abort = new AbortController();
	try {
		await preflight(c, config.model, { writeHeaders: false });
		assertFinalModelAllowed(c, config.model);
		const routing = await route(
			config.model,
			"realtime.conversation",
			{
				clientSignal: abort.signal,
				requestId,
				operationId: log.operationId,
				executionMode: "stream",
				candidateEligibility: (candidate) =>
					assertRealtimeConversationSupported(config, candidate.meta),
				usageQuota: usageQuotaForRequest(c),
			},
			(candidate, ctx) => {
				const handler = candidate.adapter.realtimeConversation;
				if (!handler) {
					throw new GatewayError({
						class: "server",
						message: `Adapter "${candidate.adapter.key}" does not implement realtime conversations`,
					});
				}
				return handler.connect(config, ctx);
			},
		);
		log.applyRouting(routing);
		log.upstreamTtftMs = Date.now() - routing.upstreamStartedAt;
		return {
			session: routing.value,
			routing,
			log,
			abort,
			configKey: JSON.stringify(config),
			downstream: newDownstreamWriteObservation(log.operationId),
			ended: false,
		};
	} catch (error) {
		const gatewayError = toGatewayError(error);
		log.applyFailedAttempts(gatewayError.attempts);
		log.writeError(gatewayError);
		throw gatewayError;
	}
}

/** The provider session, opened on first use with the session as configured so far. */
async function ensureRun(
	connection: ConversationConnection,
): Promise<ConversationRun> {
	if (connection.run) {
		return connection.run;
	}
	if (connection.failed) {
		throw connection.failed;
	}
	let run: ConversationRun;
	try {
		run = await startRun(connection, conversationConfigOf(connection.state));
	} catch (error) {
		if (error instanceof RealtimeClientEventError) {
			throw error;
		}
		connection.failed = toGatewayError(error);
		throw connection.failed;
	}
	if (connection.closed) {
		await endRun(connection, run, null);
		throw new GatewayError({
			class: "server",
			message: "Realtime socket closed",
		});
	}
	connection.run = run;
	connection.tracker.attach(run.session);
	void pump(connection, run);
	return run;
}

/* ------------------------------------------------------------------ client events */

async function updateSession(
	connection: ConversationConnection,
	event: Extract<RealtimeConversationClientEvent, { type: "session.update" }>,
	clientEventId: string | null,
): Promise<void> {
	const next = applyConversationSessionUpdate(
		connection.state,
		event.session,
		clientEventId,
	);
	const config = conversationConfigOf(next);
	const { run } = connection;
	if (run) {
		assertRealtimeConversationSupported(config, run.routing.candidate.meta);
		const configKey = JSON.stringify(config);
		if (configKey !== run.configKey) {
			// The provider fixes its configuration per connection: it reconnects, keeping context.
			await run.session.reconfigure(config);
			run.configKey = configKey;
		}
	}
	if (
		JSON.stringify(next.inputFormat) !==
		JSON.stringify(connection.state.inputFormat)
	) {
		connection.decoder = createAudioInputDecoder(next.inputFormat);
	}
	connection.state = next;
	connection.failed = null;
	send(connection, {
		type: "session.updated",
		event_id: eventId(),
		session: renderConversationSession(next),
	});
}

function assertItemSupported(
	run: ConversationRun,
	event: Extract<
		RealtimeConversationClientEvent,
		{ type: "conversation.item.create" }
	>,
	clientEventId: string | null,
): void {
	const profile = realtimeConversationProfileFor(run.routing.candidate.meta);
	const { item } = event;
	if (item.type !== "message") {
		return;
	}
	for (const part of item.content) {
		if (
			(part.type === "input_text" || part.type === "output_text") &&
			!profile?.supportsTextInput
		) {
			throw new RealtimeClientEventError(
				"The selected model does not accept text input.",
				"unsupported_parameter",
				"item.content",
				clientEventId,
			);
		}
		if (part.type === "input_image" && !profile?.supportsImageInput) {
			throw new RealtimeClientEventError(
				"The selected model does not accept image input.",
				"unsupported_parameter",
				"item.content",
				clientEventId,
			);
		}
	}
}

async function handleMessage(
	connection: ConversationConnection,
	rawMessage: unknown,
): Promise<void> {
	let clientEventId: string | null = null;
	try {
		const event = parseRealtimeConversationEvent(
			realtimeMessageJson(rawMessage),
		);
		clientEventId = event.event_id ?? null;
		const { tracker } = connection;
		switch (event.type) {
			case "session.update":
				await updateSession(connection, event, clientEventId);
				return;
			case "conversation.item.retrieve":
				tracker.retrieve(event.item_id, clientEventId);
				return;
			case "conversation.item.truncate":
				tracker.truncate(
					event.item_id,
					event.content_index,
					event.audio_end_ms,
					clientEventId,
				);
				return;
			case "conversation.item.delete":
				tracker.delete(event.item_id, clientEventId);
				return;
			case "input_audio_buffer.clear":
				tracker.clear();
				return;
			case "response.cancel":
				tracker.cancelResponse(event.response_id, clientEventId);
				return;
			case "output_audio_buffer.clear":
				throw new RealtimeClientEventError(
					"output_audio_buffer.clear is only available over WebRTC and SIP; stop playback on the client.",
					"unsupported_parameter",
					"type",
					clientEventId,
				);
			default:
				break;
		}
		if (connection.failed && event.type === "input_audio_buffer.append") {
			// Already reported; audio keeps streaming until the client fixes the session.
			return;
		}
		const run = await ensureRun(connection);
		switch (event.type) {
			case "input_audio_buffer.append": {
				const pcm = connection.decoder.push(Buffer.from(event.audio, "base64"));
				if (pcm.byteLength > 0) {
					tracker.appendAudio(pcm, clientEventId);
				}
				return;
			}
			case "input_audio_buffer.commit":
				tracker.commit(clientEventId);
				return;
			case "conversation.item.create":
				assertItemSupported(run, event, clientEventId);
				tracker.createItem(event.item, event.previous_item_id, clientEventId);
				return;
			case "response.create":
				tracker.createResponse(event.response, clientEventId);
				return;
			default:
				return;
		}
	} catch (error) {
		if (error instanceof RealtimeClientEventError) {
			send(
				connection,
				realtimeErrorEvent({
					type: "invalid_request_error",
					code: error.code,
					message: error.message,
					param: error.param,
					eventId: error.eventId ?? clientEventId,
				}),
			);
			return;
		}
		sendError(connection, toGatewayError(error), clientEventId);
	}
}

async function closeConnection(
	connection: ConversationConnection,
): Promise<void> {
	if (connection.closed) {
		return;
	}
	connection.closed = true;
	clearTimeout(connection.timer);
	unregisterRealtimeSocket(connection.entry);
	await connection.queue.catch(() => undefined);
	if (connection.run) {
		await endRun(connection, connection.run, null);
	}
}

/** Builds the socket handlers for a conversation on `model`. Throws when the socket is refused. */
export function realtimeConversationSocket(
	c: Context<AppEnv>,
	scopeKey: string,
	model: string,
	preset: RealtimeConversationSessionUpdate | null,
): WSEvents {
	const state = preset
		? applyConversationSessionUpdate(
				newRealtimeConversationState(model),
				preset,
				null,
			)
		: newRealtimeConversationState(model);
	let connection: ConversationConnection;
	const entry: RealtimeSocketEntry = {
		scopeKey,
		socket: null,
		busy: () => connection.run !== null,
		close: () => closeConnection(connection),
	};
	registerRealtimeSocket(entry);
	const tracker = new RealtimeConversationTracker({
		state: () => connection?.state ?? state,
		emit: (event) => send(connection, event),
	});
	connection = {
		c,
		entry,
		state,
		tracker,
		decoder: createAudioInputDecoder(state.inputFormat),
		queue: Promise.resolve(),
		queued: 0,
		run: null,
		failed: null,
		timer: undefined,
		closed: false,
	};
	return {
		onOpen(_event, ws) {
			entry.socket = ws;
			send(connection, {
				type: "session.created",
				event_id: eventId(),
				session: renderConversationSession(connection.state),
			});
			connection.timer = setTimeout(() => {
				sendError(connection, sessionExpiredError());
				entry.socket?.close(1000, "60 minute session limit");
			}, REALTIME_MAX_MS);
			connection.timer.unref?.();
		},
		onMessage(event) {
			if (connection.queued >= MAX_QUEUED_EVENTS) {
				sendError(connection, eventQueueLimitError());
				return;
			}
			connection.queued += 1;
			connection.queue = connection.queue
				.then(() => handleMessage(connection, event.data))
				.finally(() => {
					connection.queued -= 1;
				});
		},
		onClose() {
			void closeConnection(connection);
		},
		onError() {
			void closeConnection(connection);
		},
	};
}
