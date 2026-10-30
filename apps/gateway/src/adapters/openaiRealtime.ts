import { EventQueue, closeStatus, rawText } from "./google/live.ts";
import { upstreamWebSocket } from "#gateway/instrumentedTransport.ts";
import { abortGatewayError } from "#gateway/abortReason.ts";
import { createPcmResampler } from "#audio/pcm.ts";
import { GatewayError } from "#core/errors.ts";

import type {
	CanonicalRealtimeConversationConfig,
	CanonicalRealtimeConversationEvent,
	RealtimeFunctionCall,
	RealtimeUsage,
	RealtimeTurn,
} from "#core/realtime.ts";

import type {
	RealtimeConversationHandler,
	RealtimeConversationSession,
	AdapterContext,
} from "./types.ts";

/**
 * OpenAI's Realtime API (`wss://…/v1/realtime?model=`) as a realtime conversation upstream.
 *
 * The public contract is the same API, but sessions still go through the canonical form so routing,
 * validation, logging and failover treat every provider alike. OpenAI takes audio at 24 kHz only,
 * so canonical 16 kHz input is resampled; its output is already 24 kHz PCM. Unlike Gemini, OpenAI
 * applies `session.update` live, so a configuration change needs no new connection.
 */

/** OpenAI accepts audio at this rate only. */
const OPENAI_AUDIO_RATE = 24_000;
/** Audio is sent in 100 ms chunks. */
const CHUNK_BYTES = (OPENAI_AUDIO_RATE / 10) * 2;
/** The transcription model used when the client asks for transcripts without naming one. */
const DEFAULT_TRANSCRIPTION_MODEL = "gpt-transcribe";

export interface OpenAIRealtimeDeps {
	label: string;
	resolveConnection: (ctx: AdapterContext) => {
		url: string;
		headers: Record<string, string>;
	};
	mapError: (err: unknown, ctx: AdapterContext) => GatewayError;
}

function record(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function count(value: unknown): number | undefined {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
		? value
		: undefined;
}

/** `https://api.openai.com/v1` -> `wss://api.openai.com/v1/realtime?model=…`. */
export function openAIRealtimeUrl(base: string, model: string): string {
	const url = new URL(base);
	url.protocol = url.protocol === "http:" ? "ws:" : "wss:";
	url.pathname = `${url.pathname.replace(/\/+$/, "")}/realtime`;
	url.search = new URLSearchParams({ model }).toString();
	url.hash = "";
	return url.toString();
}

function turnDetection(
	config: CanonicalRealtimeConversationConfig,
): Record<string, unknown> | null {
	const { vad } = config;
	if (!vad) {
		return null;
	}
	const common = {
		create_response: vad.createResponse,
		interrupt_response: vad.interruptResponse,
	};
	if (vad.type === "semantic_vad") {
		return {
			type: "semantic_vad",
			...(vad.eagerness === undefined ? {} : { eagerness: vad.eagerness }),
			...common,
		};
	}
	return {
		type: "server_vad",
		...(vad.threshold === undefined ? {} : { threshold: vad.threshold }),
		...(vad.prefixPaddingMs === undefined
			? {}
			: { prefix_padding_ms: vad.prefixPaddingMs }),
		...(vad.silenceDurationMs === undefined
			? {}
			: { silence_duration_ms: vad.silenceDurationMs }),
		...(vad.idleTimeoutMs === undefined
			? {}
			: { idle_timeout_ms: vad.idleTimeoutMs }),
		...common,
	};
}

/** One hint goes as `language`; several as `languages` (gpt-transcribe and later). */
function languageHints(
	languages: string[] | undefined,
): Record<string, unknown> {
	if (!languages || languages.length === 0) {
		return {};
	}
	const [language] = languages;
	return languages.length === 1 ? { language } : { languages };
}

/** The canonical configuration as an OpenAI `session.update`. */
export function openAIRealtimeSession(
	config: CanonicalRealtimeConversationConfig,
): Record<string, unknown> {
	const pcm = { type: "audio/pcm", rate: OPENAI_AUDIO_RATE };
	const transcription = config.inputTranscription;
	return {
		type: "realtime",
		instructions: config.instructions ?? "",
		output_modalities: [config.outputModality],
		audio: {
			input: {
				format: pcm,
				turn_detection: turnDetection(config),
				transcription: transcription
					? {
							model: transcription.model ?? DEFAULT_TRANSCRIPTION_MODEL,
							...languageHints(transcription.languages),
							...(transcription.keywords?.length
								? { keywords: transcription.keywords }
								: {}),
						}
					: null,
			},
			output: {
				format: pcm,
				...(config.voice === undefined ? {} : { voice: config.voice }),
				...(config.speed === undefined ? {} : { speed: config.speed }),
			},
		},
		tools: config.tools.map((tool) => ({
			type: "function",
			name: tool.name,
			...(tool.description === undefined
				? {}
				: { description: tool.description }),
			...(tool.parameters === undefined ? {} : { parameters: tool.parameters }),
		})),
		tool_choice: config.toolChoice,
		max_output_tokens: config.maxOutputTokens ?? "inf",
		...(config.reasoningEffort
			? { reasoning: { effort: config.reasoningEffort } }
			: {}),
		truncation: config.truncation,
	};
}

/** OpenAI realtime usage -> canonical realtime usage. */
export function openAIRealtimeUsage(raw: unknown): RealtimeUsage | undefined {
	const usage = record(raw);
	if (!usage) {
		return undefined;
	}
	const input = count(usage.input_tokens) ?? 0;
	const output = count(usage.output_tokens) ?? 0;
	if (input === 0 && output === 0) {
		return undefined;
	}
	const inputDetails = record(usage.input_token_details);
	const outputDetails = record(usage.output_token_details);
	const details = {
		textTokens: count(inputDetails?.text_tokens),
		audioTokens: count(inputDetails?.audio_tokens),
		imageTokens: count(inputDetails?.image_tokens),
		cachedTokens: count(inputDetails?.cached_tokens),
		outputTextTokens: count(outputDetails?.text_tokens),
		outputAudioTokens: count(outputDetails?.audio_tokens),
	};
	return {
		inputTokens: input,
		outputTokens: output,
		totalTokens: input + output,
		...Object.fromEntries(
			Object.entries(details).filter(([, value]) => value !== undefined),
		),
	};
}

/** Canonical turns as OpenAI conversation items. Audio parts go at 24 kHz. */
export function openAIRealtimeItems(
	turns: RealtimeTurn[],
): Record<string, unknown>[] {
	const toRate = createPcmResampler(OPENAI_AUDIO_RATE);
	return turns.map((turn) => ({
		type: "message",
		role: turn.role === "model" ? "assistant" : "user",
		content: turn.parts.map((part) => {
			if (part.type === "text") {
				return {
					type: turn.role === "model" ? "output_text" : "input_text",
					text: part.text,
				};
			}
			if (part.type === "image") {
				return {
					type: "input_image",
					image_url: `data:${part.mimeType};base64,${part.data}`,
				};
			}
			return {
				type: "input_audio",
				audio: toRate(part.pcm).toString("base64"),
			};
		}),
	}));
}

/** Per response: the calls collected until `response.done`, so they leave as one batch. */
interface ResponseState {
	calls: RealtimeFunctionCall[];
}

/**
 * One OpenAI server event -> canonical events. `transcripts` tracks, per user item, whether
 * deltas arrived (a `completed` without them carries the whole transcript).
 */
export function parseOpenAIRealtimeEvent(
	raw: unknown,
	state: { response: ResponseState; transcripts: Map<string, boolean> },
): CanonicalRealtimeConversationEvent[] {
	const event = record(raw) ?? {};
	switch (event.type) {
		case "input_audio_buffer.speech_started":
			return [{ kind: "speech_started" }];
		case "input_audio_buffer.speech_stopped":
			return [{ kind: "speech_stopped" }];
		case "conversation.item.input_audio_transcription.delta": {
			const delta = typeof event.delta === "string" ? event.delta : "";
			state.transcripts.set(String(event.item_id), true);
			return delta ? [{ kind: "input_transcript", text: delta }] : [];
		}
		case "conversation.item.input_audio_transcription.completed": {
			const id = String(event.item_id);
			const streamed = state.transcripts.get(id) === true;
			state.transcripts.delete(id);
			const transcript =
				typeof event.transcript === "string" ? event.transcript : "";
			return !streamed && transcript
				? [{ kind: "input_transcript", text: transcript }]
				: [];
		}
		case "response.output_audio.delta":
			return typeof event.delta === "string"
				? [{ kind: "output_audio", pcm: Buffer.from(event.delta, "base64") }]
				: [];
		case "response.output_audio_transcript.delta":
			return typeof event.delta === "string" && event.delta
				? [{ kind: "output_transcript", text: event.delta }]
				: [];
		case "response.output_text.delta":
			return typeof event.delta === "string" && event.delta
				? [{ kind: "output_text", text: event.delta }]
				: [];
		case "response.function_call_arguments.done":
			state.response.calls.push({
				id: String(event.call_id ?? ""),
				name: typeof event.name === "string" ? event.name : "",
				arguments: typeof event.arguments === "string" ? event.arguments : "{}",
			});
			return [];
		case "response.done": {
			const response = record(event.response) ?? {};
			const details = record(response.status_details);
			const events: CanonicalRealtimeConversationEvent[] = [];
			const usage = openAIRealtimeUsage(response.usage);
			if (usage) {
				events.push({ kind: "usage", usage });
			}
			if (state.response.calls.length > 0) {
				events.push({ kind: "function_calls", calls: state.response.calls });
				state.response.calls = [];
			}
			if (
				response.status === "cancelled" &&
				details?.reason === "turn_detected"
			) {
				events.push({ kind: "interrupted" });
			}
			events.push({ kind: "turn_complete" });
			return events;
		}
		case "error": {
			const error = record(event.error);
			return [
				{
					kind: "provider_error",
					code: typeof error?.code === "string" ? error.code : null,
				},
			];
		}
		default:
			return [];
	}
}

export function makeOpenAIRealtimeConversationHandler(
	deps: OpenAIRealtimeDeps,
): RealtimeConversationHandler {
	return {
		async connect(initialConfig, ctx): Promise<RealtimeConversationSession> {
			const connection = deps.resolveConnection(ctx);
			const url = openAIRealtimeUrl(connection.url, ctx.upstreamModel);
			const queue = new EventQueue<CanonicalRealtimeConversationEvent>();
			const toRate = createPcmResampler(OPENAI_AUDIO_RATE);
			const parseState = {
				response: { calls: [] } as ResponseState,
				transcripts: new Map<string, boolean>(),
			};
			let closed = false;
			let pending: Buffer[] = [];
			let pendingBytes = 0;
			/** `session.update`s waiting for their `session.updated` (or an error). */
			const updates: Array<{
				resolve: () => void;
				reject: (error: unknown) => void;
			}> = [];
			const socket = upstreamWebSocket(ctx, url, {
				headers: connection.headers,
			});
			const send = (event: Record<string, unknown>) => {
				if (!closed && socket.readyState === socket.OPEN) {
					socket.send(JSON.stringify(event));
				}
			};
			const fail = (error: unknown) => {
				if (closed) {
					return;
				}
				closed = true;
				for (const update of updates.splice(0)) {
					update.reject(error);
				}
				queue.fail(error);
			};
			const update = (config: CanonicalRealtimeConversationConfig) =>
				new Promise<void>((resolve, reject) => {
					updates.push({ resolve, reject });
					send({
						type: "session.update",
						session: openAIRealtimeSession(config),
					});
				});

			await new Promise<void>((resolve, reject) => {
				let ready = false;
				socket.on("message", (data) => {
					let raw: unknown;
					try {
						raw = JSON.parse(rawText(data));
					} catch (cause) {
						const error = new GatewayError({
							class: "server",
							code: "upstream_protocol_error",
							message: `${deps.label} realtime emitted a message that is not JSON`,
							cause,
						});
						if (ready) {
							fail(error);
						} else {
							reject(error);
						}
						return;
					}
					const event = record(raw) ?? {};
					if (event.type === "session.created" && !ready) {
						update(initialConfig).then(() => {
							ready = true;
							resolve();
						}, reject);
						return;
					}
					if (event.type === "session.updated") {
						updates.shift()?.resolve();
						return;
					}
					if (event.type === "error" && updates.length > 0) {
						// A refused session.update: the configuration was not applied.
						const error = deps.mapError(
							{ status: 400, body: { error: event.error } },
							ctx,
						);
						updates.shift()?.reject(error);
						return;
					}
					for (const canonical of parseOpenAIRealtimeEvent(raw, parseState)) {
						queue.push(canonical);
					}
				});
				socket.on("error", (error) => {
					if (!ready) {
						reject(deps.mapError(error, ctx));
					}
				});
				socket.on("unexpected-response", (_request, response) => {
					reject(
						deps.mapError(
							{
								status: response.statusCode ?? 502,
								body: { error: { message: response.statusMessage } },
							},
							ctx,
						),
					);
				});
				socket.on("close", (code, reasonBuffer) => {
					if (ctx.signal?.aborted) {
						const error = abortGatewayError(ctx.signal);
						if (ready) {
							fail(error);
						} else {
							reject(error);
						}
						return;
					}
					if (closed) {
						return;
					}
					const reason = reasonBuffer.toString();
					const error = deps.mapError(
						{
							status: closeStatus(code, reason),
							body: {
								error: {
									code,
									message:
										reason || `${deps.label} realtime closed with code ${code}`,
								},
							},
						},
						ctx,
					);
					if (ready) {
						fail(error);
					} else {
						reject(error);
					}
				});
			});
			ctx.watchdog?.headers();
			ctx.watchdog?.complete();

			const flushAudio = () => {
				if (pendingBytes === 0) {
					return;
				}
				const audio = Buffer.concat(pending);
				pending = [];
				pendingBytes = 0;
				send({
					type: "input_audio_buffer.append",
					audio: audio.toString("base64"),
				});
			};

			return {
				appendAudio(pcm) {
					if (closed) {
						return;
					}
					const resampled = toRate(pcm);
					pending.push(resampled);
					pendingBytes += resampled.byteLength;
					if (pendingBytes >= CHUNK_BYTES) {
						flushAudio();
					}
				},
				startActivity() {
					// Manual turns are the session's `turn_detection: null`; the turn ends on commit.
				},
				endActivity() {
					flushAudio();
					send({ type: "input_audio_buffer.commit" });
					send({ type: "response.create" });
				},
				flushAudio() {
					flushAudio();
					send({ type: "input_audio_buffer.commit" });
				},
				sendTurns(turns, complete) {
					flushAudio();
					for (const item of openAIRealtimeItems(turns)) {
						send({ type: "conversation.item.create", item });
					}
					if (complete) {
						send({ type: "response.create" });
					}
				},
				sendFunctionResults(results) {
					for (const result of results) {
						send({
							type: "conversation.item.create",
							item: {
								type: "function_call_output",
								call_id: result.id,
								output: result.output,
							},
						});
					}
					send({ type: "response.create" });
				},
				cancelResponse() {
					send({ type: "response.cancel" });
				},
				reconfigure(next) {
					if (closed) {
						return Promise.reject(
							new GatewayError({
								class: "server",
								message: `${deps.label} realtime session is closed`,
							}),
						);
					}
					// OpenAI applies session.update live: same connection, same conversation.
					return update(next);
				},
				events: queue.iterate(),
				close() {
					if (closed) {
						return;
					}
					closed = true;
					for (const pendingUpdate of updates.splice(0)) {
						pendingUpdate.reject(
							new GatewayError({
								class: "server",
								message: `${deps.label} realtime session closed`,
							}),
						);
					}
					queue.end();
					socket.close(1000);
				},
			};
		},
	};
}
