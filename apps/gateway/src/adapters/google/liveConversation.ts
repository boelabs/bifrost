import { upstreamWebSocket } from "#gateway/instrumentedTransport.ts";
import { realtimeConversationProfileFor } from "#catalog/types.ts";
import { abortGatewayError } from "#gateway/abortReason.ts";
import type { BaseCreds } from "#adapters/creds.ts";
import { GatewayError } from "#core/errors.ts";
import { randomBytes } from "node:crypto";
import type WebSocket from "ws";

import {
	geminiLiveUsage,
	geminiLiveUrl,
	closeStatus,
	EventQueue,
	rawText,
} from "./live.ts";

import {
	type CanonicalRealtimeConversationConfig,
	type CanonicalRealtimeConversationEvent,
	type RealtimeConversationProfile,
	type RealtimeFunctionResult,
	REALTIME_AUDIO_SAMPLE_RATE,
	type RealtimeTurn,
} from "#core/realtime.ts";

import type {
	RealtimeConversationHandler,
	RealtimeConversationSession,
	AdapterContext,
} from "#adapters/types.ts";

/**
 * Gemini Live conversations (`BidiGenerateContent`): native-audio models that listen, speak, call
 * functions, and translate.
 *
 * Gemini fixes a session's configuration at setup and ends each connection after about ten minutes.
 * Both are handled the same way: the session keeps the latest resumption handle Gemini hands out,
 * and when the configuration changes or Gemini says `goAway`, it opens a new connection with the new
 * setup and that handle, so the conversation's context carries over.
 */

const AUDIO_MIME = `audio/pcm;rate=${REALTIME_AUDIO_SAMPLE_RATE}`;
/** Gemini recommends 20-40 ms of audio per message for conversations. */
const CHUNK_BYTES = (REALTIME_AUDIO_SAMPLE_RATE / 25) * 2;
/** Without a `goAway`, a capped connection is replaced this long before its cap. */
const ROTATE_EARLY_MS = 30_000;
/** A rotation waits for a resumable moment at most this long before `goAway` runs out. */
const FORCE_BEFORE_GO_AWAY_MS = 3000;

interface LiveDeps {
	creds: (ctx: AdapterContext) => BaseCreds & { apiKey: string };
	mapError: (err: unknown, ctx: AdapterContext) => GatewayError;
}

function record(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

/** `"12.5s"` (protobuf Duration JSON) -> milliseconds. */
function durationMs(value: unknown): number | undefined {
	if (typeof value !== "string") {
		return undefined;
	}
	const seconds = Number(value.trim().replace(/s$/, ""));
	return Number.isFinite(seconds) ? seconds * 1000 : undefined;
}

function sensitivity(
	kind: "START" | "END",
	level: "HIGH" | "LOW" | undefined,
): Record<string, string> {
	if (!level) {
		return {};
	}
	return kind === "START"
		? { startOfSpeechSensitivity: `START_SENSITIVITY_${level}` }
		: { endOfSpeechSensitivity: `END_SENSITIVITY_${level}` };
}

function activityDetection(
	config: CanonicalRealtimeConversationConfig,
): Record<string, unknown> {
	const { vad } = config;
	if (!vad) {
		return { automaticActivityDetection: { disabled: true } };
	}
	// OpenAI's threshold defaults to 0.5, Gemini's start sensitivity to HIGH: a stricter threshold
	// asks for LOW.
	const start =
		vad.threshold !== undefined && vad.threshold > 0.5 ? "LOW" : undefined;
	const eagerness = {
		high: "HIGH",
		low: "LOW",
		medium: undefined,
		auto: undefined,
	} as const;
	const end = vad.eagerness ? eagerness[vad.eagerness] : undefined;
	const detection = {
		...sensitivity("START", start),
		...sensitivity("END", end),
		...(vad.prefixPaddingMs === undefined
			? {}
			: { prefixPaddingMs: vad.prefixPaddingMs }),
		...(vad.silenceDurationMs === undefined
			? {}
			: { silenceDurationMs: vad.silenceDurationMs }),
	};
	return {
		...(Object.keys(detection).length > 0
			? { automaticActivityDetection: detection }
			: {}),
		...(vad.interruptResponse ? {} : { activityHandling: "NO_INTERRUPTION" }),
	};
}

/** The canonical configuration as a Live API `setup` message. */
export function geminiConversationSetup(
	config: CanonicalRealtimeConversationConfig,
	upstreamModel: string,
	profile: RealtimeConversationProfile | undefined,
	resumptionHandle: string | null,
): Record<string, unknown> {
	const nativeText =
		config.outputModality === "text" &&
		(profile?.outputModalities ?? []).includes("text");
	const generationConfig: Record<string, unknown> = {
		responseModalities: [nativeText ? "TEXT" : "AUDIO"],
		...(config.voice
			? {
					speechConfig: {
						voiceConfig: { prebuiltVoiceConfig: { voiceName: config.voice } },
					},
				}
			: {}),
		...(config.maxOutputTokens === undefined
			? {}
			: { maxOutputTokens: config.maxOutputTokens }),
		...(config.reasoningEffort
			? {
					thinkingConfig: {
						thinkingLevel: config.reasoningEffort.toUpperCase(),
					},
				}
			: {}),
		...(config.translation
			? {
					translationConfig: {
						targetLanguageCode: config.translation.targetLanguage,
						...(config.translation.echoTargetLanguage === undefined
							? {}
							: { echoTargetLanguage: config.translation.echoTargetLanguage }),
					},
				}
			: {}),
	};
	const tools: Record<string, unknown>[] = [];
	if (config.toolChoice !== "none" && config.tools.length > 0) {
		const behavior =
			profile?.functionCalling === "non_blocking" ? "NON_BLOCKING" : "BLOCKING";
		tools.push({
			functionDeclarations: config.tools.map((tool) => ({
				name: tool.name,
				...(tool.description === undefined
					? {}
					: { description: tool.description }),
				...(tool.parameters === undefined
					? {}
					: { parametersJsonSchema: tool.parameters }),
				behavior,
			})),
		});
	}
	if (config.googleSearch) {
		tools.push({ googleSearch: {} });
	}
	const transcription = config.inputTranscription;
	return {
		setup: {
			model: upstreamModel.startsWith("models/")
				? upstreamModel
				: `models/${upstreamModel}`,
			generationConfig,
			...(config.instructions
				? { systemInstruction: { parts: [{ text: config.instructions }] } }
				: {}),
			...(tools.length > 0 ? { tools } : {}),
			realtimeInputConfig: activityDetection(config),
			...(transcription
				? {
						inputAudioTranscription: {
							...(transcription.languages?.length
								? { languageCodes: transcription.languages }
								: {}),
							...(transcription.keywords?.length
								? { customVocabulary: transcription.keywords }
								: {}),
						},
					}
				: {}),
			// The transcript of the spoken reply is OpenAI's `output_audio_transcript`, always present.
			...(nativeText ? {} : { outputAudioTranscription: {} }),
			...(profile?.supportsSessionResumption
				? {
						sessionResumption: resumptionHandle
							? { handle: resumptionHandle }
							: {},
					}
				: {}),
			...(profile?.supportsContextCompression && config.truncation === "auto"
				? { contextWindowCompression: { slidingWindow: {} } }
				: {}),
		},
	};
}

/** One parsed server message. */
export interface GeminiConversationMessage {
	setupComplete: boolean;
	events: CanonicalRealtimeConversationEvent[];
	/** `sessionResumptionUpdate`, when present. */
	resumption?: { handle: string | null; resumable: boolean };
	/** `goAway`: milliseconds until Gemini closes the connection. */
	goAwayMs?: number;
	/** The user started (true) or stopped (false) speaking, per Gemini's activity detection. */
	userSpeaking?: boolean;
	/** The model is mid-turn (generating, or waiting on its function calls). */
	modelBusy?: boolean;
}

function functionArguments(args: unknown): string {
	return JSON.stringify(args ?? {});
}

/** Live API server message -> canonical events plus the session bookkeeping it carries. */
export function parseGeminiConversationMessage(
	raw: unknown,
	options: { nativeText: boolean },
): GeminiConversationMessage {
	const message = record(raw) ?? {};
	const events: CanonicalRealtimeConversationEvent[] = [];
	const parsed: GeminiConversationMessage = {
		setupComplete: message.setupComplete !== undefined,
		events,
	};
	const activity = record(message.voiceActivity)?.type;
	if (activity === "ACTIVITY_START") {
		events.push({ kind: "speech_started" });
		parsed.userSpeaking = true;
	} else if (activity === "ACTIVITY_END") {
		events.push({ kind: "speech_stopped" });
		parsed.userSpeaking = false;
	}
	const content = record(message.serverContent);
	if (content) {
		const interim = record(content.interimInputTranscription)?.text;
		if (typeof interim === "string") {
			events.push({ kind: "input_transcript_interim", text: interim });
		}
		const input = record(content.inputTranscription)?.text;
		if (typeof input === "string" && input !== "") {
			events.push({ kind: "input_transcript", text: input });
		}
		const parts = record(content.modelTurn)?.parts;
		for (const partValue of Array.isArray(parts) ? parts : []) {
			const part = record(partValue);
			if (!part || part.thought === true) {
				continue;
			}
			const inline = record(part.inlineData);
			if (
				typeof inline?.data === "string" &&
				typeof inline.mimeType === "string" &&
				inline.mimeType.startsWith("audio/")
			) {
				events.push({
					kind: "output_audio",
					pcm: Buffer.from(inline.data, "base64"),
				});
				parsed.modelBusy = true;
			} else if (
				options.nativeText &&
				typeof part.text === "string" &&
				part.text !== ""
			) {
				events.push({ kind: "output_text", text: part.text });
				parsed.modelBusy = true;
			}
		}
		const output = record(content.outputTranscription)?.text;
		if (typeof output === "string" && output !== "") {
			events.push({ kind: "output_transcript", text: output });
			parsed.modelBusy = true;
		}
	}
	const usage = geminiLiveUsage(message.usageMetadata);
	if (usage) {
		events.push({ kind: "usage", usage });
	}
	if (content?.interrupted === true) {
		events.push({ kind: "interrupted" });
	}
	if (content?.turnComplete === true) {
		events.push({ kind: "turn_complete" });
		parsed.modelBusy = false;
	}
	const calls = record(message.toolCall)?.functionCalls;
	if (Array.isArray(calls) && calls.length > 0) {
		events.push({
			kind: "function_calls",
			calls: calls.map((callValue) => {
				const call = record(callValue) ?? {};
				return {
					id:
						typeof call.id === "string" && call.id !== ""
							? call.id
							: `call_${randomBytes(12).toString("base64url")}`,
					name: typeof call.name === "string" ? call.name : "",
					arguments: functionArguments(call.args),
				};
			}),
		});
		parsed.modelBusy = true;
	}
	const cancelled = record(message.toolCallCancellation)?.ids;
	if (Array.isArray(cancelled)) {
		events.push({
			kind: "function_calls_cancelled",
			ids: cancelled.filter((id): id is string => typeof id === "string"),
		});
	}
	const resumption = record(message.sessionResumptionUpdate);
	if (resumption) {
		parsed.resumption = {
			handle:
				typeof resumption.newHandle === "string" && resumption.newHandle !== ""
					? resumption.newHandle
					: null,
			resumable: resumption.resumable === true,
		};
	}
	const goAway = record(message.goAway);
	if (goAway) {
		parsed.goAwayMs = durationMs(goAway.timeLeft) ?? 0;
	}
	return parsed;
}

/** A client's function output: a JSON object goes through as is, anything else is wrapped. */
export function geminiFunctionResponse(
	result: RealtimeFunctionResult,
): Record<string, unknown> {
	let response: Record<string, unknown> = { output: result.output };
	try {
		const parsed: unknown = JSON.parse(result.output);
		const object = record(parsed);
		if (object) {
			response = object;
		}
	} catch {
		// Plain text output.
	}
	return { id: result.id, name: result.name, response };
}

export function geminiClientContent(
	turns: RealtimeTurn[],
	complete: boolean,
): Record<string, unknown> {
	return {
		clientContent: {
			turns: turns.map((turn) => ({
				role: turn.role,
				parts: turn.parts.map((part) => {
					if (part.type === "text") {
						return { text: part.text };
					}
					if (part.type === "image") {
						return { inlineData: { mimeType: part.mimeType, data: part.data } };
					}
					return {
						inlineData: {
							mimeType: AUDIO_MIME,
							data: part.pcm.toString("base64"),
						},
					};
				}),
			})),
			turnComplete: complete,
		},
	};
}

interface LiveConnection {
	socket: WebSocket;
	send: (message: Record<string, unknown>) => void;
	/** Set when the session itself closes or replaces this connection. */
	retired: boolean;
}

export function makeGeminiRealtimeConversationHandler(
	deps: LiveDeps,
): RealtimeConversationHandler {
	return {
		async connect(initialConfig, ctx): Promise<RealtimeConversationSession> {
			const c = deps.creds(ctx);
			const profile = realtimeConversationProfileFor(ctx.meta);
			const url = geminiLiveUrl(c.baseUrl);
			const queue = new EventQueue<CanonicalRealtimeConversationEvent>();
			let config = initialConfig;
			let closed = false;
			let current: LiveConnection;
			let handle: string | null = null;
			let resumable = true;
			let userSpeaking = false;
			let modelBusy = false;
			let activityOpen = false;
			/** Messages held while the connection is being replaced. */
			let held: Record<string, unknown>[] | null = null;
			let pending: Buffer[] = [];
			let pendingBytes = 0;
			let capTimer: ReturnType<typeof setTimeout> | undefined;
			let forceTimer: ReturnType<typeof setTimeout> | undefined;
			/** A wanted reconnection: the config to open it with and who waits for it. */
			let wanted: {
				config: CanonicalRealtimeConversationConfig;
				waiters: Array<{ resolve: () => void; reject: (e: unknown) => void }>;
			} | null = null;
			let switching = false;

			const nativeText = () =>
				config.outputModality === "text" &&
				(profile?.outputModalities ?? []).includes("text");

			const fail = (error: unknown) => {
				if (closed) {
					return;
				}
				closed = true;
				clearTimeout(capTimer);
				clearTimeout(forceTimer);
				for (const waiter of wanted?.waiters ?? []) {
					waiter.reject(error);
				}
				wanted = null;
				queue.fail(error);
			};

			const send = (message: Record<string, unknown>) => {
				if (held) {
					held.push(message);
				} else {
					current.send(message);
				}
			};

			const flushAudio = () => {
				if (pendingBytes === 0) {
					return;
				}
				const audio = Buffer.concat(pending);
				pending = [];
				pendingBytes = 0;
				send({
					realtimeInput: {
						audio: { data: audio.toString("base64"), mimeType: AUDIO_MIME },
					},
				});
			};

			/** Opens one connection with `setup` and resolves after `setupComplete`. */
			const open = (
				setup: Record<string, unknown>,
				textOut: boolean,
			): Promise<LiveConnection> =>
				new Promise<LiveConnection>((resolve, reject) => {
					const socket = upstreamWebSocket(ctx, url, {
						headers: { "x-goog-api-key": c.apiKey, ...(c.headers ?? {}) },
					});
					const connection: LiveConnection = {
						socket,
						retired: false,
						send(message) {
							if (socket.readyState === socket.OPEN) {
								socket.send(JSON.stringify(message));
							}
						},
					};
					let ready = false;
					socket.once("open", () => connection.send(setup));
					socket.on("message", (data) => {
						let raw: unknown;
						try {
							raw = JSON.parse(rawText(data));
						} catch (cause) {
							const error = new GatewayError({
								class: "server",
								code: "upstream_protocol_error",
								message: "Gemini Live emitted a message that is not JSON",
								cause,
							});
							if (ready) {
								fail(error);
							} else {
								reject(error);
							}
							return;
						}
						const message = parseGeminiConversationMessage(raw, {
							nativeText: textOut,
						});
						if (message.setupComplete && !ready) {
							ready = true;
							resolve(connection);
						}
						if (connection.retired && connection !== current) {
							return;
						}
						const { events, resumption } = message;
						if (message.userSpeaking !== undefined) {
							({ userSpeaking } = message);
						}
						if (message.modelBusy !== undefined) {
							({ modelBusy } = message);
						}
						for (const event of events) {
							queue.push(event);
						}
						if (resumption) {
							({ resumable } = resumption);
							if (resumption.handle) {
								({ handle } = resumption);
							}
						}
						if (message.goAwayMs !== undefined) {
							wantReconnect(config);
							clearTimeout(forceTimer);
							forceTimer = setTimeout(
								() => void reconnect(),
								Math.max(0, message.goAwayMs - FORCE_BEFORE_GO_AWAY_MS),
							);
							forceTimer.unref?.();
						}
						maybeReconnect();
					});
					socket.on("error", (error) => {
						if (!ready) {
							reject(deps.mapError(error, ctx));
						}
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
						const reason = reasonBuffer.toString();
						const error = deps.mapError(
							{
								status: closeStatus(code, reason),
								body: {
									error: {
										code,
										message: reason || `Gemini Live closed with code ${code}`,
									},
								},
							},
							ctx,
						);
						if (!ready) {
							reject(error);
							return;
						}
						if (connection.retired || closed) {
							return;
						}
						if (connection === current) {
							fail(error);
						}
					});
				});

			/** Replaces the connection before the provider's cap, in case no `goAway` comes. */
			const armCap = () => {
				clearTimeout(capTimer);
				const capSeconds = profile?.maxUpstreamSessionSeconds;
				if (capSeconds === undefined) {
					return;
				}
				capTimer = setTimeout(
					() => wantReconnect(config),
					Math.max(1000, capSeconds * 1000 - ROTATE_EARLY_MS),
				);
				capTimer.unref?.();
			};

			function wantReconnect(
				next: CanonicalRealtimeConversationConfig,
				waiter?: { resolve: () => void; reject: (e: unknown) => void },
			) {
				wanted = {
					config: next,
					waiters: [...(wanted?.waiters ?? []), ...(waiter ? [waiter] : [])],
				};
				maybeReconnect();
			}

			/** Reconnects at a moment Gemini can resume from: nothing in flight on either side. */
			function maybeReconnect() {
				if (!wanted || switching || closed) {
					return;
				}
				const quiet = resumable && !modelBusy && !userSpeaking && !activityOpen;
				if (quiet || !profile?.supportsSessionResumption) {
					void reconnect();
				}
			}

			async function reconnect() {
				if (!wanted || switching || closed) {
					return;
				}
				switching = true;
				clearTimeout(forceTimer);
				const target = wanted;
				wanted = null;
				flushAudio();
				held = [];
				const previous = current;
				try {
					const textOut =
						target.config.outputModality === "text" &&
						(profile?.outputModalities ?? []).includes("text");
					const next = await open(
						geminiConversationSetup(
							target.config,
							ctx.upstreamModel,
							profile,
							profile?.supportsSessionResumption ? handle : null,
						),
						textOut,
					);
					previous.retired = true;
					previous.socket.close(1000);
					current = next;
					({ config } = target);
					modelBusy = false;
					userSpeaking = false;
					const waiting = held;
					held = null;
					for (const message of waiting) {
						current.send(message);
					}
					armCap();
					for (const waiter of target.waiters) {
						waiter.resolve();
					}
				} catch (error) {
					held = null;
					for (const waiter of target.waiters) {
						waiter.reject(error);
					}
					fail(error);
				} finally {
					switching = false;
				}
				maybeReconnect();
			}

			current = await open(
				geminiConversationSetup(config, ctx.upstreamModel, profile, null),
				nativeText(),
			);
			armCap();
			ctx.watchdog?.headers();
			ctx.watchdog?.complete();

			return {
				appendAudio(pcm) {
					if (closed) {
						return;
					}
					pending.push(pcm);
					pendingBytes += pcm.byteLength;
					if (pendingBytes >= CHUNK_BYTES) {
						flushAudio();
					}
				},
				startActivity() {
					if (closed || config.vad || activityOpen) {
						return;
					}
					activityOpen = true;
					send({ realtimeInput: { activityStart: {} } });
				},
				endActivity() {
					if (closed || config.vad || !activityOpen) {
						return;
					}
					flushAudio();
					activityOpen = false;
					send({ realtimeInput: { activityEnd: {} } });
					maybeReconnect();
				},
				flushAudio() {
					if (closed || !config.vad) {
						return;
					}
					flushAudio();
					send({ realtimeInput: { audioStreamEnd: true } });
				},
				sendTurns(turns, complete) {
					if (closed) {
						return;
					}
					flushAudio();
					send(geminiClientContent(turns, complete));
				},
				sendFunctionResults(results) {
					if (closed || results.length === 0) {
						return;
					}
					send({
						toolResponse: {
							functionResponses: results.map(geminiFunctionResponse),
						},
					});
				},
				reconfigure(next) {
					if (closed) {
						return Promise.reject(
							new GatewayError({
								class: "server",
								message: "Gemini Live session is closed",
							}),
						);
					}
					return new Promise<void>((resolve, reject) =>
						wantReconnect(next, { resolve, reject }),
					);
				},
				events: queue.iterate(),
				close() {
					if (closed) {
						return;
					}
					closed = true;
					clearTimeout(capTimer);
					clearTimeout(forceTimer);
					for (const waiter of wanted?.waiters ?? []) {
						waiter.reject(
							new GatewayError({
								class: "server",
								message: "Gemini Live session closed before reconfiguring",
							}),
						);
					}
					wanted = null;
					queue.end();
					current.retired = true;
					current.socket.close(1000);
				},
			};
		},
	};
}
