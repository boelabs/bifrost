import { assertRealtimeConfigSupported } from "#gateway/realtimeRequestValidation.ts";
import { RealtimeTranscriptTracker } from "#contracts/openai/realtimeTranscript.ts";
import { type AudioInputDecoder, createAudioInputDecoder } from "#audio/pcm.ts";
import type { RealtimeTranscriptionSession } from "#adapters/types.ts";
import { candidateMetadata } from "#gateway/candidateMetadata.ts";
import { completedTerminal } from "#gateway/streamLifecycle.ts";
import { OperationLogDraft } from "./runtime/operationLog.ts";
import { route, type RouteResult } from "#router/index.ts";
import { upgradeWebSocket } from "@hono/node-server";
import { GatewayError } from "#core/errors.ts";
import { getAuth } from "#auth/middleware.ts";
import type { AppEnv } from "#auth/types.ts";
import { randomUUID } from "node:crypto";
import type { WSContext } from "hono/ws";
import { env } from "#config/env.ts";
import type { Context } from "hono";

import {
	type RealtimeSessionState,
	RealtimeClientEventError,
	parseRealtimeClientEvent,
	newRealtimeSessionState,
	realtimeErrorEvent,
	applySessionUpdate,
	realtimeConfigOf,
	INTERIM_INCLUDE,
	renderSession,
	eventId,
} from "#contracts/openai/realtime.ts";

import {
	type CanonicalRealtimeTranscriptionConfig,
	type RealtimeTranscriptionUsage,
	realtimeUsageToCore,
	addRealtimeUsage,
} from "#core/realtime.ts";

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

/**
 * GET /v1/realtime?intent=transcription with Upgrade: websocket — OpenAI's Realtime API in
 * transcription mode, served by any adapter with a realtime transcription handler.
 *
 * Each provider session is one routed operation: it starts when a `session.update` names a model
 * (or changes how that model must be configured) and ends when the configuration changes again or
 * the socket closes. Its usage and cost are logged once, at the end.
 */

const REALTIME_MAX_MS = 60 * 60 * 1000;
const MAX_MESSAGE_BYTES = 16 * 1024 * 1024;
const MAX_QUEUED_EVENTS = 2000;
/**
 * Usage estimates for providers that report none (Gemini Live sends no `usageMetadata` for
 * transcription-only sessions): Google bills live audio at 25 tokens per second, and Gemini
 * Transcribe's text runs about 4 characters per output token.
 */
const ESTIMATED_AUDIO_TOKENS_PER_SECOND = 25;
const ESTIMATED_CHARACTERS_PER_OUTPUT_TOKEN = 4;

interface UpstreamRun {
	configKey: string;
	config: CanonicalRealtimeTranscriptionConfig;
	session: RealtimeTranscriptionSession;
	routing: RouteResult<RealtimeTranscriptionSession>;
	log: OperationLogDraft;
	abort: AbortController;
	decoder: AudioInputDecoder;
	/** Seconds of audio received before the current decoder (a format change replaces it). */
	secondsBefore: number;
	usage: RealtimeTranscriptionUsage | null;
	tracker: RealtimeTranscriptTracker;
	downstream: DownstreamWriteObservation;
	ended: boolean;
}

interface RealtimeConnection {
	c: Context<AppEnv>;
	scopeKey: string;
	socket: WSContext | null;
	state: RealtimeSessionState;
	queue: Promise<void>;
	queued: number;
	run: UpstreamRun | null;
	lastItemId: string | null;
	timer: ReturnType<typeof setTimeout> | undefined;
	closed: boolean;
}

const activeRealtimeConnections = new Set<RealtimeConnection>();

function send(
	connection: RealtimeConnection,
	value: Record<string, unknown>,
	downstream?: DownstreamWriteObservation,
): void {
	const ws = connection.socket;
	if (ws?.readyState !== 1) {
		return;
	}
	const serialized = JSON.stringify(value);
	ws.send(serialized);
	if (downstream) {
		downstream.bytes += Buffer.byteLength(serialized);
	}
}

function sendError(
	connection: RealtimeConnection,
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

function messageText(value: unknown): string {
	if (typeof value === "string") {
		return value;
	}
	if (value instanceof ArrayBuffer) {
		return Buffer.from(value).toString("utf8");
	}
	if (ArrayBuffer.isView(value)) {
		return Buffer.from(
			value.buffer,
			value.byteOffset,
			value.byteLength,
		).toString("utf8");
	}
	throw new RealtimeClientEventError(
		"Realtime messages must be JSON text.",
		"invalid_event",
		null,
		null,
	);
}

function runSeconds(run: UpstreamRun): number {
	return run.secondsBefore + run.decoder.seconds;
}

/* ------------------------------------------------------------------ provider runs */

async function pump(connection: RealtimeConnection, run: UpstreamRun) {
	try {
		for await (const event of run.session.events) {
			run.log.progress();
			if (event.kind === "usage") {
				run.usage = addRealtimeUsage(run.usage, event.usage);
			}
			run.tracker.provider(event);
		}
		await endRun(connection, run, null);
	} catch (error) {
		if (run.ended) {
			return;
		}
		const gatewayError = toGatewayError(error, "Realtime transcription failed");
		sendError(connection, gatewayError);
		await endRun(connection, run, gatewayError);
		connection.socket?.close(1011, "upstream session failed");
	}
}

async function endRun(
	connection: RealtimeConnection,
	run: UpstreamRun,
	error: GatewayError | null,
): Promise<void> {
	if (run.ended) {
		return;
	}
	run.ended = true;
	if (connection.run === run) {
		connection.run = null;
	}
	run.tracker.finish();
	connection.lastItemId = run.tracker.lastItemId;
	run.session.close();
	run.abort.abort();
	let { usage } = run;
	let estimated = false;
	const seconds = runSeconds(run);
	if (!usage && seconds > 0) {
		const audioTokens = Math.ceil(seconds * ESTIMATED_AUDIO_TOKENS_PER_SECOND);
		const outputTokens = Math.ceil(
			run.tracker.transcriptCharacters / ESTIMATED_CHARACTERS_PER_OUTPUT_TOKEN,
		);
		usage = {
			inputTokens: audioTokens,
			outputTokens,
			totalTokens: audioTokens + outputTokens,
			audioTokens,
		};
		estimated = true;
	}
	const core = realtimeUsageToCore(usage);
	const terminal = error ? null : completedTerminal(core);
	await run.routing.finish(core, undefined, error, terminal, run.downstream);
	finishDownstreamWriteObservation(run.downstream, error?.code);
	run.log.write({
		status: error ? "error" : "success",
		httpStatus: error?.httpStatus ?? 200,
		usage: core,
		cost: computeUsageCost(run.routing.candidate.meta, core),
		firstOutputMs:
			run.tracker.firstOutputAt === null
				? null
				: run.tracker.firstOutputAt - run.log.startedAt,
		responseBody: {
			streamed: true,
			items: run.tracker.completedItems,
			audioSeconds: Math.round(seconds * 1000) / 1000,
		},
		metadata: {
			...candidateMetadata(run.routing.candidate),
			...(terminal ? { terminal } : {}),
			turnDetection: run.config.turnDetection,
			...(estimated ? { usageEstimated: true } : {}),
		},
		error: error ? error.toLog() : null,
	});
}

async function startRun(
	connection: RealtimeConnection,
	config: CanonicalRealtimeTranscriptionConfig,
	configKey: string,
	state: RealtimeSessionState,
): Promise<UpstreamRun> {
	const { c } = connection;
	const requestId = randomUUID();
	const log = new OperationLogDraft(c, "realtime.transcription", {
		publicModel: config.model,
		requestId,
	});
	log.requestBody = { session: renderSession(state) };
	const abort = new AbortController();
	try {
		await preflight(c, config.model, { writeHeaders: false });
		assertFinalModelAllowed(c, config.model);
		const routing = await route(
			config.model,
			"realtime.transcription",
			{
				clientSignal: abort.signal,
				requestId,
				operationId: log.operationId,
				executionMode: "stream",
				candidateEligibility: (candidate) =>
					assertRealtimeConfigSupported(config, candidate.meta),
				usageQuota: usageQuotaForRequest(c),
			},
			(candidate, ctx) => {
				const handler = candidate.adapter.realtimeTranscription;
				if (!handler) {
					throw new GatewayError({
						class: "server",
						message: `Adapter "${candidate.adapter.key}" does not implement realtime transcription`,
					});
				}
				return handler.connect(config, ctx);
			},
		);
		log.applyRouting(routing);
		log.upstreamTtftMs = Date.now() - routing.upstreamStartedAt;
		const downstream = newDownstreamWriteObservation(log.operationId);
		const run: UpstreamRun = {
			configKey,
			config,
			session: routing.value,
			routing,
			log,
			abort,
			decoder: createAudioInputDecoder(state.format),
			secondsBefore: 0,
			usage: null,
			downstream,
			ended: false,
			tracker: new RealtimeTranscriptTracker({
				turnDetection: config.turnDetection,
				previousItemId: connection.lastItemId,
				includeInterim: () =>
					connection.state.include.includes(INTERIM_INCLUDE),
				audioMs: () => Math.round(runSeconds(run) * 1000),
				emit: (event) => send(connection, event, downstream),
			}),
		};
		return run;
	} catch (error) {
		const gatewayError = toGatewayError(error);
		log.applyFailedAttempts(gatewayError.attempts);
		log.writeError(gatewayError);
		throw gatewayError;
	}
}

/* ------------------------------------------------------------------ client events */

async function updateSession(
	connection: RealtimeConnection,
	state: RealtimeSessionState,
): Promise<void> {
	const { run } = connection;
	const config = realtimeConfigOf(state);
	const configKey = config ? JSON.stringify(config) : "";
	if (config && configKey !== run?.configKey) {
		// The provider fixes its configuration when the session opens: a change means a new one.
		if (run) {
			await endRun(connection, run, null);
		}
		const next = await startRun(connection, config, configKey, state);
		if (connection.closed) {
			await endRun(connection, next, null);
			return;
		}
		connection.run = next;
		void pump(connection, next);
	} else if (
		run &&
		JSON.stringify(state.format) !== JSON.stringify(connection.state.format)
	) {
		run.secondsBefore += run.decoder.seconds;
		run.decoder = createAudioInputDecoder(state.format);
	}
	connection.state = state;
	send(connection, {
		type: "session.updated",
		event_id: eventId(),
		session: renderSession(state),
	});
}

async function handleMessage(
	connection: RealtimeConnection,
	rawMessage: unknown,
): Promise<void> {
	let clientEventId: string | null = null;
	try {
		const text = messageText(rawMessage);
		if (Buffer.byteLength(text, "utf8") > MAX_MESSAGE_BYTES) {
			throw new RealtimeClientEventError(
				"Realtime message is too large.",
				"invalid_event",
				null,
				null,
			);
		}
		let json: unknown;
		try {
			json = JSON.parse(text);
		} catch {
			throw new RealtimeClientEventError(
				"Invalid JSON.",
				"invalid_json",
				null,
				null,
			);
		}
		const event = parseRealtimeClientEvent(json);
		clientEventId = event.event_id ?? null;
		if (event.type === "session.update") {
			await updateSession(
				connection,
				applySessionUpdate(connection.state, event.session),
			);
			return;
		}
		const { run } = connection;
		if (!run) {
			throw new RealtimeClientEventError(
				event.type === "input_audio_buffer.commit"
					? "Error committing input audio buffer: the buffer is empty."
					: "Set session.audio.input.transcription.model with session.update before sending audio.",
				event.type === "input_audio_buffer.commit"
					? "input_audio_buffer_commit_empty"
					: "session_not_configured",
				event.type === "input_audio_buffer.commit"
					? null
					: "session.audio.input.transcription.model",
				clientEventId,
			);
		}
		if (event.type === "input_audio_buffer.append") {
			if (run.tracker.beforeAudio()) {
				run.session.startUtterance();
			}
			const pcm = run.decoder.push(Buffer.from(event.audio, "base64"));
			if (pcm.byteLength > 0) {
				run.session.appendAudio(pcm);
			}
			return;
		}
		if (event.type === "input_audio_buffer.commit") {
			run.tracker.commit(clientEventId);
			run.session.endUtterance();
			return;
		}
		if (run.tracker.clear()) {
			run.session.endUtterance();
		}
		send(connection, {
			type: "input_audio_buffer.cleared",
			event_id: eventId(),
		});
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

async function closeConnection(connection: RealtimeConnection): Promise<void> {
	if (connection.closed) {
		return;
	}
	connection.closed = true;
	clearTimeout(connection.timer);
	activeRealtimeConnections.delete(connection);
	await connection.queue.catch(() => undefined);
	if (connection.run) {
		await endRun(connection, connection.run, null);
	}
}

export const realtimeWebSocketHandler = upgradeWebSocket(
	(c) => {
		const intent = c.req.query("intent");
		if (intent !== "transcription" || c.req.query("model") !== undefined) {
			const message =
				"Only transcription sessions are supported: connect with ?intent=transcription and set the model in session.update.";
			throw new GatewayError({
				class: "bad_request",
				code: "unsupported_parameter",
				message,
				publicMessage: message,
				param: intent === "transcription" ? "model" : "intent",
			});
		}
		const auth = getAuth(c);
		const scopeKey = auth.type === "virtual" ? auth.key.id : "master";
		const forScope = [...activeRealtimeConnections].filter(
			(active) => active.scopeKey === scopeKey,
		).length;
		if (
			activeRealtimeConnections.size >=
				env.REALTIME_WEBSOCKET_MAX_CONNECTIONS ||
			forScope >= env.REALTIME_WEBSOCKET_MAX_CONNECTIONS_PER_KEY
		) {
			throw new GatewayError({
				class: "rate_limit",
				code: "websocket_connection_limit_exceeded",
				message: "Realtime WebSocket connection concurrency limit exceeded",
				publicMessage: "Realtime WebSocket connection limit exceeded.",
			});
		}
		const connection: RealtimeConnection = {
			c,
			scopeKey,
			socket: null,
			state: newRealtimeSessionState(),
			queue: Promise.resolve(),
			queued: 0,
			run: null,
			lastItemId: null,
			timer: undefined,
			closed: false,
		};
		activeRealtimeConnections.add(connection);
		return {
			onOpen(_event, ws) {
				connection.socket = ws;
				send(connection, {
					type: "session.created",
					event_id: eventId(),
					session: renderSession(connection.state),
				});
				connection.timer = setTimeout(() => {
					sendError(
						connection,
						new GatewayError({
							class: "bad_request",
							code: "session_expired",
							message: "Realtime session reached 60 minutes",
							publicMessage:
								"Your session hit the maximum duration of 60 minutes.",
						}),
					);
					connection.socket?.close(1000, "60 minute session limit");
				}, REALTIME_MAX_MS);
				connection.timer.unref?.();
			},
			onMessage(event) {
				if (connection.queued >= MAX_QUEUED_EVENTS) {
					sendError(
						connection,
						new GatewayError({
							class: "rate_limit",
							code: "websocket_event_queue_limit_exceeded",
							message: "Realtime WebSocket queued-event limit exceeded",
							publicMessage: "Too many queued events.",
						}),
					);
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
	},
	{
		onError(error) {
			throw error;
		},
	},
);

/**
 * Hangs up live realtime sockets during process shutdown. Idle ones (no provider session) go first;
 * the rest get 1012 "service restarting" when the drain window closes, after their usage is logged.
 */
export async function closeRealtimeWebSockets(
	options: { idleOnly?: boolean } = {},
): Promise<void> {
	const closing: Promise<void>[] = [];
	for (const connection of activeRealtimeConnections) {
		if (options.idleOnly && connection.run) {
			continue;
		}
		const { socket } = connection;
		closing.push(
			closeConnection(connection).finally(() =>
				socket?.close(1012, "service restarting"),
			),
		);
	}
	await Promise.allSettled(closing);
}
